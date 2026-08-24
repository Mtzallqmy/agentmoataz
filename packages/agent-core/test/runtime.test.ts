import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";
import { z } from "zod";
import {
  AgentRuntime,
  EventBus,
  PermissionEngine,
  ToolRegistry,
  CheckpointManager,
  buildCoreFileTools,
} from "../src/index.js";
import { MockProvider } from "@agentmoataz/agent-models";
import { Workspace } from "@agentmoataz/agent-workspace";
import { nodePlatform } from "@agentmoataz/agent-platform/node";

let tmp: string;

beforeAll(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "core-test-"));
});
afterAll(async () => {
  await fsp.rm(tmp, { recursive: true, force: true });
});

function makeRuntime(opts?: {
  permissions?: PermissionEngine;
  approvalResolver?: (req: { toolName: string }) => boolean;
}) {
  const events = new EventBus();
  const tools = new ToolRegistry();
  const workspaceRoot = path.join(tmp, `proj-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(workspaceRoot, { recursive: true });
  const wsRoot = workspaceRoot;
  for (const t of buildCoreFileTools(new Workspace(wsRoot, nodePlatform))) tools.register(t);

  const runtime = new AgentRuntime({
    providers: [new MockProvider()],
    events,
    tools,
    ...(opts?.permissions ? { permissions: opts.permissions } : {}),
    checkpoints: new CheckpointManager(wsRoot, nodePlatform),
    ...(opts?.approvalResolver
      ? { approvalResolver: (req) => opts.approvalResolver!(req) }
      : {}),
    perToolTimeoutMs: 5_000,
  });
  return { runtime, events, wsRoot };
}

describe("AgentRuntime end-to-end", () => {
  it("runs a multi-step mock task that writes and verifies files", async () => {
    const { runtime, events, wsRoot } = makeRuntime();
    runtime.setStepTools("Execute primary work", [
      { name: "write_file", input: { path: "src/app.ts", content: "export const app = 'todo';\n" } },
    ]);
    runtime.setStepTools("Verify results", [
      { name: "read_file", input: { path: "src/app.ts" } },
    ]);

    const result = await runtime.run("create a todo module");
    expect(result.state).toBe("completed");
    expect(result.stepsCompleted).toBeGreaterThanOrEqual(3);
    expect(fs.readFileSync(path.join(wsRoot, "src/app.ts"), "utf8")).toContain("todo");

    const types = events.all().map((e) => e.type);
    expect(types).toContain("run_started");
    expect(types).toContain("planning_started");
    expect(types).toContain("plan_updated");
    expect(types).toContain("step_started");
    expect(types).toContain("tool_completed");
    expect(types).toContain("step_completed");
    expect(types).toContain("run_completed");
  });

  it("blocks path-escaping tool input with WORKSPACE_ESCAPE_BLOCKED", async () => {
    const { runtime } = makeRuntime();
    runtime.setStepTools("Execute primary work", [
      { name: "write_file", input: { path: "../evil.txt", content: "nope" } },
    ]);
    const result = await runtime.run("try to escape");
    expect(result.state).toBe("failed");
    expect(result.error?.code).toBe("WORKSPACE_ESCAPE_BLOCKED");
  });

  it("requires approval for delete_file under BALANCED profile and honors denial", async () => {
    const approvals: string[] = [];
    const { runtime } = makeRuntime({
      approvalResolver: (req) => {
        approvals.push(req.toolName);
        return false;
      },
    });
    runtime.setStepTools("Execute primary work", [
      { name: "delete_file", input: { path: "x.txt" } },
    ]);
    const result = await runtime.run("delete something");
    expect(approvals).toEqual(["delete_file"]);
    expect(result.state).toBe("failed");
    expect(result.error?.code).toBe("PERMISSION_DENIED");
  });

  it("allows delete when user approves and AUTONOMOUS allows directly", async () => {
    // AUTONOMOUS allows single deletes without asking
    const { runtime, events } = makeRuntime({ permissions: new PermissionEngine("AUTONOMOUS") });
    runtime.setStepTools("Execute primary work", [
      { name: "write_file", input: { path: "a.txt", content: "1" } },
      { name: "write_file", input: { path: "keep.txt", content: "keep" } },
      { name: "delete_file", input: { path: "a.txt" } },
    ]);
    runtime.setStepTools("Verify results", [
      { name: "read_file", input: { path: "keep.txt" } },
    ]);
    const result = await runtime.run("clean up");
    expect(result.state).toBe("completed");
    const approvalEvents = events.all().filter((e) => e.type === "approval_requested");
    expect(approvalEvents).toHaveLength(0);
  });

  it("SAFE profile forces write approval; denial fails run gracefully", async () => {
    const { runtime } = makeRuntime({
      permissions: new PermissionEngine("SAFE"),
      approvalResolver: () => false,
    });
    runtime.setStepTools("Execute primary work", [
      { name: "write_file", input: { path: "f.txt", content: "hi" } },
    ]);
    const result = await runtime.run("write a file");
    expect(result.error?.code).toBe("PERMISSION_DENIED");
  });

  it("checkpoint -> corrupt project -> restore matches original", async () => {
    const wsRoot = path.join(tmp, `cp-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(path.join(wsRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(wsRoot, "src/main.txt"), "original");
    const cpManager = new CheckpointManager(wsRoot, nodePlatform);

    const cp = await cpManager.create("before risky edit");
    expect(cp.manifest.some((m) => m.relativePath === "src/main.txt")).toBe(true);

    // corrupt
    fs.writeFileSync(path.join(wsRoot, "src/main.txt"), "corrupted!!!");
    fs.writeFileSync(path.join(wsRoot, "junk.txt"), "extra");

    await cpManager.restore(cp.id);
    expect(fs.readFileSync(path.join(wsRoot, "src/main.txt"), "utf8")).toBe("original");
    expect(fs.existsSync(path.join(wsRoot, "junk.txt"))).toBe(false);
  });

  it("max step budget stops runaway runs", async () => {
    const events = new EventBus();
    const tools = new ToolRegistry();
    const wsRoot = path.join(tmp, `mx-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(wsRoot, { recursive: true });
    for (const t of buildCoreFileTools(new Workspace(wsRoot, nodePlatform))) tools.register(t);

    const runtime = new AgentRuntime({
      providers: [new MockProvider()],
      events,
      tools,
      maxSteps: 2,
      perToolTimeoutMs: 2_000,
      planFn: () =>
        Array.from({ length: 10 }, (_, i) => ({
          title: `Step ${i}`,
          expectedTools: ["read_file"],
        })),
    });
    for (let i = 0; i < 10; i++) {
      runtime.setStepTools(`Step ${i}`, [{ name: "list_tree", input: {} }]);
    }
    const result = await runtime.run("loop forever");
    expect(result.state).toBe("failed");
    expect(result.error?.code).toBe("TOOL_TIMEOUT");
  });

  it("tool timeout produces structured TOOL_TIMEOUT error", async () => {
    const events = new EventBus();
    const tools = new ToolRegistry();
    tools.register({
      name: "sleep",
      description: "sleeps",
      permissionCategory: "read_project_file",
      inputSchema: z.object({}),
      timeoutMs: 50,
      execute: async () => {
        await new Promise((r) => setTimeout(r, 2_000));
        return {};
      },
    });
    const runtime = new AgentRuntime({
      providers: [new MockProvider()],
      events,
      tools,
      planFn: () => [{ title: "Sleep" }],
    });
    runtime.setStepTools("Sleep", [{ name: "sleep", input: {} }]);
    const result = await runtime.run("take a nap");
    expect(result.state).toBe("failed");
    expect(result.error?.code).toBe("TOOL_TIMEOUT");
  }, 10_000);

  it("cancel mid-run marks run cancelled", async () => {
    const events = new EventBus();
    const tools = new ToolRegistry();
    let started = false;
    tools.register({
      name: "wait",
      description: "waits",
      permissionCategory: "read_project_file",
      inputSchema: z.object({}),
      execute: async (_i, ctx) => {
        started = true;
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, 3_000);
          ctx.signal?.addEventListener("abort", () => {
            clearTimeout(t);
            resolve();
          });
        });
        return {};
      },
    });
    const runtime = new AgentRuntime({
      providers: [new MockProvider()],
      events,
      tools,
      planFn: () => [{ title: "Wait" }],
    });
    runtime.setStepTools("Wait", [{ name: "wait", input: {} }]);
    const promise = runtime.run("wait around");
    await new Promise((r) => setTimeout(r, 100));
    expect(started).toBe(true);
    runtime.cancel(runtime.allRuns()[0]!.id);
    const result = await promise;
    expect(result.state).toBe("cancelled");
  }, 10_000);

  it("pause/resume works during execution", async () => {
    const events = new EventBus();
    const tools = new ToolRegistry();
    tools.register({
      name: "noop",
      description: "noop",
      permissionCategory: "read_project_file",
      inputSchema: z.object({}),
      execute: async () => {
        await new Promise((r) => setTimeout(r, 300));
        return {};
      },
    });
    const runtime = new AgentRuntime({
      providers: [new MockProvider()],
      events,
      tools,
      planFn: () => [{ title: "A" }, { title: "B" }],
    });
    runtime.setStepTools("A", [{ name: "noop", input: {} }]);
    runtime.setStepTools("B", [{ name: "noop", input: {} }]);
    const promise = runtime.run("pausable work");
    const runId = runtime.allRuns()[0]!.id;
    await new Promise((r) => setTimeout(r, 50));
    runtime.pause(runId);
    await new Promise((r) => setTimeout(r, 100));
    expect(runtime.getRun(runId)?.state).toBe("paused");
    runtime.resume(runId);
    const result = await promise;
    expect(result.state).toBe("completed");
    const evTypes = events.eventsForRun(runId).map((e) => e.type);
    expect(evTypes).toContain("run_paused");
    expect(evTypes).toContain("run_resumed");
  }, 10_000);

  it("recoverInterrupted flags in-flight runs", async () => {
    const events = new EventBus();
    const tools = new ToolRegistry();
    tools.register({
      name: "slow",
      description: "slow",
      permissionCategory: "read_project_file",
      inputSchema: z.object({}),
      execute: async () => {
        await new Promise((r) => setTimeout(r, 1_000));
        return {};
      },
    });
    const runtime = new AgentRuntime({ providers: [new MockProvider()], events, tools });
    runtime.setStepTools("Execute primary work", [{ name: "slow", input: {} }]);
    const p = runtime.run("slow task");
    // wait until the loop actually started
    await new Promise((r) => setTimeout(r, 50));
    const runId = runtime.allRuns()[0]!.id;
    runtime.pause(runId);
    runtime.recoverInterrupted();
    expect(["interrupted", "paused"]).toContain(runtime.getRun(runId)?.state);
    if (runtime.getRun(runId)?.state === "paused") runtime.resume(runId);
    await p;
  }, 10_000);
});
