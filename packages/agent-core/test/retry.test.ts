/**
 * Regression tests for the linked-retry architecture.
 * Rules under test:
 *  - a retry is a NEW ToolCall linked to the original via retriesOf
 *  - retries are bounded (MAX_TOOL_ATTEMPTS); exhaustion -> TOOL_TIMEOUT
 *  - steps never verify successfully when a required call did not execute
 *  - cancelled calls are NEVER retried
 *  - permission-denied calls are NEVER retried automatically
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { AgentRuntime, EventBus, ToolRegistry } from "../src/index.js";
import { MockProvider } from "@agentmoataz/agent-models";
import { AgentError } from "@agentmoataz/agent-protocol";

function makeTools() {
  const events = new EventBus();
  const tools = new ToolRegistry();
  const runtime = new AgentRuntime({
    providers: [new MockProvider()],
    events,
    tools,
    perToolTimeoutMs: 5_000,
  });
  return { events, tools, runtime };
}

const startedEvents = (events: EventBus) =>
  events.all().filter((e) => e.type === "tool_started");
const failedEvents = (events: EventBus) =>
  events.all().filter((e) => e.type === "tool_failed");

describe("linked retry architecture", () => {
  it("1. timeout then successful retry: second attempt links to original via retriesOf", async () => {
    const { events, tools, runtime } = makeTools();
    let attempts = 0;
    tools.register({
      name: "flaky",
      description: "fails once then succeeds",
      permissionCategory: "read_project_file",
      inputSchema: z.object({}),
      execute: async () => {
        attempts++;
        if (attempts === 1) {
          throw new AgentError({
            code: "TOOL_TIMEOUT",
            category: "tool",
            message: "simulated transient timeout",
            recoverable: true,
            retryable: true,
          });
        }
        return { done: true };
      },
    });
    runtime.setStepTools("Work", [{ name: "flaky", input: {} }]);
    const result = await runtime.runWithPlan([{ title: "Work" }], "retry once");

    expect(result.state).toBe("completed");
    expect(attempts).toBe(2);

    const starts = startedEvents(events);
    expect(starts).toHaveLength(2);
    const firstId = starts[0]!.payload["toolCallId"] as string;
    const secondId = starts[1]!.payload["toolCallId"] as string;
    // NEW ToolCall id for the retry...
    expect(secondId).not.toBe(firstId);
    // ...explicitly linked back to the original.
    expect(starts[1]!.payload["retriesOf"]).toBe(firstId);
    expect(starts[0]!.payload["attempt"]).toBe(1);
    expect(starts[1]!.payload["attempt"]).toBe(2);
  });

  it("2. timeout until max attempts then TOOL_TIMEOUT", async () => {
    const { events, tools, runtime } = makeTools();
    let executions = 0;
    tools.register({
      name: "always_slow",
      description: "always times out",
      permissionCategory: "read_project_file",
      inputSchema: z.object({}),
      timeoutMs: 30,
      execute: async () => {
        executions++;
        await new Promise((r) => setTimeout(r, 500));
        return {};
      },
    });
    runtime.setStepTools("Work", [{ name: "always_slow", input: {} }]);
    const result = await runtime.runWithPlan([{ title: "Work" }], "never succeeds");

    expect(result.state).toBe("failed");
    expect(result.error?.code).toBe("TOOL_TIMEOUT");
    expect(executions).toBeGreaterThanOrEqual(2); // initial + bounded retry
    const starts = startedEvents(events);
    expect(starts.length).toBe(2);
    expect(starts[1]!.payload["retriesOf"]).toBe(starts[0]!.payload["toolCallId"]);
  }, 10_000);

  it("3. step declaring expected tools but missing scheduled calls must fail", async () => {
    const { runtime } = makeTools();
    // plan declares expectedTools but we schedule NO concrete calls
    const result = await runtime.runWithPlan(
      [{ title: "Ghost work", expectedTools: ["write_file"] }],
      "missing calls"
    );
    expect(result.state).toBe("failed");
    expect(result.error?.code).toBe("INVALID_TOOL_ARGUMENT");
    expect(result.error?.message).toContain("no tool call was scheduled");
  });

  it("4. cancelled tool is executed at most once and NEVER retried", async () => {
    const { events, tools, runtime } = makeTools();
    let executions = 0;
    let sawAbort = false;
    tools.register({
      name: "abortable",
      description: "waits until aborted",
      permissionCategory: "read_project_file",
      inputSchema: z.object({}),
      execute: async (_input, ctx) => {
        executions++;
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, 5_000);
          ctx.signal?.addEventListener("abort", () => {
            sawAbort = true;
            clearTimeout(t);
            resolve();
          });
        });
        return {};
      },
    });
    runtime.setStepTools("Work", [{ name: "abortable", input: {} }]);
    const promise = runtime.runWithPlan([{ title: "Work" }], "cancel me");
    await new Promise((r) => setTimeout(r, 100));
    runtime.cancel(runtime.allRuns()[0]!.id);
    const result = await promise;

    expect(sawAbort).toBe(true);
    expect(executions).toBe(1);
    // no attempt-2 events exist at all
    const attempts = startedEvents(events).map((e) => e.payload["attempt"]);
    expect(attempts).toEqual([1]);
    expect(["cancelled", "failed"]).toContain(result.state);
  }, 10_000);

  it("5. permission-denied tool fails immediately and is NEVER retried", async () => {
    const { events, tools, runtime } = makeTools();
    let executions = 0;
    tools.register({
      name: "delete_file",
      description: "delete something sensitive-ish",
      permissionCategory: "delete_file",
      inputSchema: z.object({ path: z.string() }),
      execute: async () => {
        executions++;
        return {};
      },
    });
    // default approvalResolver denies; BALANCED profile routes delete_file to "ask"
    runtime.setStepTools("Work", [{ name: "delete_file", input: { path: "x.txt" } }]);
    const result = await runtime.runWithPlan([{ title: "Work" }], "denied op");

    expect(result.state).toBe("failed");
    expect(result.error?.code).toBe("PERMISSION_DENIED");
    expect(executions).toBe(0); // never reached execution
    expect(startedEvents(events)).toHaveLength(0);
    const requested = events.all().filter((e) => e.type === "tool_requested");
    expect(requested).toHaveLength(1); // exactly one logical call, zero retries
    expect(failedEvents(events)).toHaveLength(1);
    expect(failedEvents(events)[0]!.payload["error"]).toMatchObject({ code: "PERMISSION_DENIED" });
  });
});
