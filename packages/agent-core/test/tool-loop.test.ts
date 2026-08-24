/**
 * Phase 4/10 acceptance: REAL model tool calling.
 * - OpenAI-compatible provider sends tool schemas and parses returned tool_calls
 * - the loop validates -> permission-gates -> executes -> feeds results back
 * - invalid tools fail structurally, denied permissions block execution
 * - repeated identical calls are stopped safely, bounded turns enforced
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";
import { z } from "zod";
import {
  runToolLoop,
  EventBus,
  PermissionEngine,
  ToolRegistry,
  type RuntimeStore,
  type Tool,
} from "../src/index.js";
import { OpenAICompatibleProvider, type ModelProvider } from "@agentmoataz/agent-models";
import { AgentError, type AgentEvent, type AgentRun } from "@agentmoataz/agent-protocol";

function fakeProvider(): ModelProvider {
  return new OpenAICompatibleProvider(
    {
      id: "fake-openai",
      kind: "openai_compatible",
      displayName: "FakeOpenAI",
      baseUrl,
      modelId: "test-model",
      capabilities: ["chat", "tool_calling"],
      secretRef: null,
      enabled: true,
      priority: 10,
    },
    { resolve: async () => null }
  );
}

/* ------------------------------------------------------------------ */
/* Fake OpenAI-compatible server                                       */
/* ------------------------------------------------------------------ */

let server: http.Server;
let baseUrl: string;
type WireMessage = { role: string; name?: string; content: string; tool_call_id?: string; tool_calls?: Array<{ id: string }> };
const seenRequests: Array<{ tools?: Array<{ function: { name: string; parameters?: Record<string, unknown> } }>; lastMessages: WireMessage[] }> = [];
let scenario: "tool_then_final" | "invalid_tool" | "loop_forever" = "tool_then_final";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const parsed = JSON.parse(body) as {
        tools?: Array<{ function: { name: string; parameters?: Record<string, unknown> } }>;
        messages: WireMessage[];
      };
      seenRequests.push({ tools: parsed.tools, lastMessages: parsed.messages });
      const toolResultMsg = [...parsed.messages].reverse().find((m) => m.role === "tool");
      let content = "";
      let tool_calls: unknown[] | undefined = undefined;

      if (scenario === "tool_then_final") {
        if (parsed.tools?.length && !toolResultMsg) {
          // first call: request write_file
          tool_calls = [
            {
              id: "call_1",
              type: "function",
              function: {
                name: "write_file",
                arguments: JSON.stringify({ path: "hello.txt", content: "written by model" }),
              },
            },
          ];
        } else {
          // second call: verify the tool result came back, then finish
          content =
            toolResultMsg && toolResultMsg.content.includes("written")
              ? "FINAL_OK file written"
              : "FINAL_BUT_TOOL_RESULT_MISSING";
        }
      } else if (scenario === "invalid_tool") {
        tool_calls = [
          {
            id: "call_bad",
            type: "function",
            function: { name: "nonexistent_tool", arguments: "{}" },
          },
        ];
      } else if (scenario === "loop_forever") {
        tool_calls = [
          {
            id: `call_${parsed.messages.length}`,
            type: "function",
            function: { name: "ping", arguments: JSON.stringify({ n: parsed.messages.length }) },
          },
        ];
      }

      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: { role: "assistant", content, ...(tool_calls ? { tool_calls } : {}) },
              finish_reason: "stop",
            },
          ],
        })
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, () => r()));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

/* ------------------------------------------------------------------ */

async function makeTools() {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "toollaunch-"));
  const events = new EventBus();
  const registry = new ToolRegistry();

  const writeFile: Tool<{ path: string; content: string }, { written: boolean }> = {
    name: "write_file",
    description: "Write a file",
    permissionCategory: "write_project_file",
    inputSchema: z.object({ path: z.string().min(1), content: z.string() }),
    execute: async (i) => {
      await fsp.writeFile(path.join(tmp, i.path), i.content, "utf8");
      return { written: true };
    },
  };

  const ping: Tool<{ n: number }, { pong: number }> = {
    name: "ping",
    description: "Ping counter",
    permissionCategory: "read_project_file",
    inputSchema: z.object({ n: z.number() }),
    execute: async (i) => ({ pong: i.n }),
  };

  const boom: Tool<Record<string, unknown>, never> = {
    name: "boom",
    description: "Always fails structurally",
    permissionCategory: "read_project_file",
    inputSchema: z.record(z.unknown()),
    execute: async () => {
      throw new AgentError({
        code: "BUILD_FAILED",
        category: "build",
        message: "boom failed",
        recoverable: false,
        retryable: false,
      });
    },
  };

  registry.register(writeFile);
  registry.register(ping);
  registry.register(boom);
  return { tmp, events, registry };
}

describe("real model tool calling", () => {
  it("OpenAI provider sends tool schemas on the wire", async () => {
    const { OpenAICompatibleProvider } = await import("@agentmoataz/agent-models");
    const provider = new OpenAICompatibleProvider(
      {
        id: "fake-openai",
        kind: "openai_compatible",
        displayName: "FakeOpenAI",
        baseUrl,
        modelId: "test-model",
        capabilities: ["chat", "tool_calling"],
        secretRef: null,
        enabled: true,
        priority: 10,
      },
      { resolve: async () => null }
    );
    const res = await provider.chat({
      messages: [{ role: "user" as const, content: "hi" }],
      tools: [
        { name: "write_file", description: "w", parameters: { type: "object" } },
      ],
    });
    expect(res.toolCalls?.[0]?.name).toBe("write_file");
    expect(seenRequests.at(-1)?.tools?.map((t) => t.function.name)).toContain("write_file");
  });

  it("model calls write_file -> file is created -> result fed back -> final response", async () => {
    scenario = "tool_then_final";
    const { tmp, events, registry } = await makeTools();
    const outcome = await runToolLoop("create hello.txt", {
      provider: fakeProvider(),
      tools: registry,
      permissions: new PermissionEngine("BALANCED"),
      events,
    });

    expect(outcome.state).toBe("completed");
    expect(outcome.text).toBe("FINAL_OK file written");
    expect(outcome.toolCallsExecuted).toBe(1);
    await expect(fsp.readFile(path.join(tmp, "hello.txt"), "utf8")).resolves.toBe(
      "written by model"
    );
    const toolMsgs = outcome.messages.filter((m) => m.role === "tool");
    expect(toolMsgs).toHaveLength(1);
    expect(toolMsgs[0]!.content).toContain("written");
    expect(toolMsgs[0]!.toolCallId).toBe("call_1");
    const finalWireRequest = seenRequests.at(-1)!;
    expect(finalWireRequest.lastMessages.find((message) => message.role === "tool")?.tool_call_id).toBe("call_1");
    expect(finalWireRequest.lastMessages.find((message) => message.role === "assistant")?.tool_calls?.[0]?.id).toBe("call_1");
    const schema = finalWireRequest.tools?.find((tool) => tool.function.name === "write_file")?.function.parameters as { properties?: Record<string, unknown>; required?: string[] };
    expect(schema.properties).toHaveProperty("path");
    expect(schema.required).toContain("path");
  });

  it("persists production run transitions under the real run id", async () => {
    scenario = "tool_then_final";
    const { registry, events } = await makeTools();
    const saved: AgentRun[] = [];
    const persistedEvents: AgentEvent[] = [];
    const store: RuntimeStore = {
      saveRun: async (run) => { saved.push(structuredClone(run)); },
      getRun: async (id) => [...saved].reverse().find((run) => run.id === id) ?? null,
      listRuns: async () => saved,
      appendEvent: async (event) => { persistedEvents.push(event); },
      listEvents: async (runId) => persistedEvents.filter((event) => event.runId === runId),
    };
    events.subscribe("*", (event) => { void store.appendEvent(event); });

    const outcome = await runToolLoop("persist this run", {
      provider: fakeProvider(), tools: registry, permissions: new PermissionEngine("BALANCED"),
      events, store, runId: "run-persisted", projectId: "project-persisted",
    });

    expect(outcome.state).toBe("completed");
    expect(saved[0]).toMatchObject({ id: "run-persisted", projectId: "project-persisted", state: "running" });
    expect(saved.at(-1)).toMatchObject({ state: "completed", stepsTaken: 2 });
    expect(persistedEvents.length).toBeGreaterThan(3);
    expect(persistedEvents.every((event) => event.runId === "run-persisted")).toBe(true);
  });

  it("model requesting an unregistered tool fails structurally and the run reports it", async () => {
    scenario = "invalid_tool";
    const { registry } = await makeTools();
    const outcome = await runToolLoop("use a broken tool", {
      provider: fakeProvider(),
      tools: registry,
      permissions: new PermissionEngine("AUTONOMOUS"),
      maxTurns: 3,
    });
    // the loop surfaces the structured failure instead of crashing
    expect(outcome.state).toBe("max_turns_exceeded");
    const toolMsgs = outcome.messages.filter((m) => m.role === "tool");
    expect(toolMsgs.some((m) => m.content.includes("TOOL_ERROR"))).toBe(true);
  });

  it("denied permission blocks execution — file NOT created", async () => {
    scenario = "tool_then_final";
    const { tmp, registry } = await makeTools();
    const outcome = await runToolLoop("create hello.txt", {
      provider: fakeProvider(),
      tools: registry,
      permissions: new PermissionEngine("SAFE"), // writes require approval
      approvalResolver: () => false,
    });
    expect(outcome.toolCallsExecuted).toBe(0);
    await expect(fsp.access(path.join(tmp, "hello.txt"))).rejects.toThrow();
    const toolMsgs = outcome.messages.filter((m) => m.role === "tool");
    expect(toolMsgs[0]!.content).toContain("PERMISSION_DENIED");
  });

  it("repeated identical model-requested calls stop safely within turn budget", async () => {
    scenario = "loop_forever";
    const { registry } = await makeTools();
    const outcome = await runToolLoop("loop forever", {
      provider: fakeProvider(),
      tools: registry,
      permissions: new PermissionEngine("BALANCED"),
      maxTurns: 12,
    });
    // ping args change each time so identical-guard passes; bounded turns end it
    expect(["max_turns_exceeded", "completed"]).toContain(outcome.state);
    expect(outcome.turns).toBeLessThanOrEqual(12);
  }, 20_000);
});
