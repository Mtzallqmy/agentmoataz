import { describe, it, expect } from "vitest";
import {
  PROTOCOL_VERSION,
  AgentRunSchema,
  TaskStepSchema,
  AgentEventSchema,
  StructuredErrorSchema,
  AgentError,
  FeatureFlagsSchema,
  ArtifactSchema,
  ProviderConfigSchema,
} from "../src/index.js";

const now = new Date().toISOString();

describe("agent-protocol", () => {
  it("exposes a semver protocol version", () => {
    expect(PROTOCOL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("validates a run with defaults", () => {
    const run = AgentRunSchema.parse({
      id: "run-1",
      projectId: "proj-1",
      goal: "build todo app",
      state: "idle",
      createdAt: now,
      updatedAt: now,
    });
    expect(run.maxSteps).toBe(100);
    expect(run.stepsTaken).toBe(0);
    expect(run.finishedAt).toBeNull();
  });

  it("validates step dependencies", () => {
    const step = TaskStepSchema.parse({
      id: "s1",
      taskId: "t1",
      title: "write files",
      status: "pending",
      createdAt: now,
      updatedAt: now,
      dependencies: ["s0"],
    });
    expect(step.dependencies).toEqual(["s0"]);
    expect(step.attempt).toBe(0);
  });

  it("round-trips structured errors through AgentError", () => {
    const err = new AgentError({
      code: "PERMISSION_DENIED",
      category: "permission",
      message: "git push requires approval",
      recoverable: true,
      retryable: false,
      toolCallId: "tc1",
    });
    const parsed = StructuredErrorSchema.parse(err.toJSON());
    expect(parsed.code).toBe("PERMISSION_DENIED");
    expect(parsed.toolCallId).toBe("tc1");
  });

  it("rejects invalid run states and bad timestamps", () => {
    expect(() =>
      AgentRunSchema.parse({
        id: "r",
        projectId: "p",
        goal: "g",
        state: "exploding",
        createdAt: "not-a-date",
        updatedAt: now,
      })
    ).toThrow();
  });

  it("validates events with payload defaults", () => {
    const ev = AgentEventSchema.parse({
      id: "e1",
      type: "step_started",
      runId: "run-1",
      createdAt: now,
    });
    expect(ev.payload).toEqual({});
  });

  it("feature flags default to safe values (cloud off, remote models on)", () => {
    const flags = FeatureFlagsSchema.parse({});
    expect(flags.cloud_sandbox).toBe(false);
    expect(flags.supabase_sync).toBe(false);
    expect(flags.remote_models).toBe(true);
  });

  it("artifact checksum must be 64 hex chars when present", () => {
    expect(() =>
      ArtifactSchema.parse({
        id: "a1",
        projectId: "p1",
        type: "source_zip",
        path: "exports/x.zip",
        checksumSha256: "tooshort",
        createdAt: now,
      })
    ).toThrow();

    const ok = ArtifactSchema.parse({
      id: "a1",
      projectId: "p1",
      type: "source_zip",
      path: "exports/x.zip",
      checksumSha256: "a".repeat(64),
      createdAt: now,
    });
    expect(ok.sizeBytes).toBe(0);
  });

  it("provider config stores secretRef, never raw secrets", () => {
    const p = ProviderConfigSchema.parse({
      id: "prov1",
      kind: "openai_compatible",
      displayName: "OpenRouter",
      capabilities: ["chat"],
    });
    expect(p.secretRef).toBeNull();
    expect(p.enabled).toBe(true);
  });
});
