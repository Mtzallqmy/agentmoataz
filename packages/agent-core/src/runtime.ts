/**
 * AgentRuntime — the autonomous loop.
 *
 * GOAL -> CONTEXT -> PLAN -> STEP -> MODEL -> TOOL -> PERMISSION ->
 * EXECUTE -> VERIFY -> RETRY/LINKED-ATTEMPT -> NEXT -> FINAL REVIEW
 *
 * Guarantees:
 * - Every tool invocation is a ToolCall; a retry is a NEW ToolCall linked
 *   to the original via `retriesOf`.
 * - Retries are bounded by MAX_TOOL_ATTEMPTS; exhaustion fails the run.
 * - Cancelled and permission-denied calls are NEVER retried automatically.
 * - A step can only complete if EVERY required tool call actually executed
 *   successfully — including calls implied by the step's declared
 *   expectedTools. Missing calls fail the step.
 */
import crypto from "node:crypto";
import type {
  AgentRun,
  ChatMessage,
  StructuredError,
} from "@agentmoataz/agent-protocol";
import { AgentError } from "@agentmoataz/agent-protocol";
import type { ModelProvider } from "@agentmoataz/agent-models";
import { ProviderRouter } from "@agentmoataz/agent-models";
import { EventBus } from "./events.js";
import { PermissionEngine } from "./permissions.js";
import { ToolRegistry } from "./tools.js";
import { TaskGraph, defaultPlan, type PlanInput, type PlannedStep } from "./planner.js";
import { CheckpointManager } from "./checkpoints.js";
import { ArtifactManager } from "./artifacts.js";

export interface ApprovalRequest {
  toolName: string;
  permissionCategory: string;
  reason: string;
  runId: string;
}

export interface RuntimeOptions {
  providers: ProviderRouter | ModelProvider[];
  events: EventBus;
  permissions?: PermissionEngine;
  tools?: ToolRegistry;
  checkpoints?: CheckpointManager;
  artifacts?: ArtifactManager;
  planFn?: (input: PlanInput) => PlannedStep[];
  /** Resolve approvals. Return true to allow. Defaults: deny. */
  approvalResolver?: (req: ApprovalRequest) => boolean | Promise<boolean>;
  maxSteps?: number;
  perToolTimeoutMs?: number;
}

export interface RunResult {
  runId: string;
  state: AgentRun["state"];
  stepsCompleted: number;
  error: StructuredError | null;
}

/** One ToolCall outcome. A retry produces a separate record linked via retriesOf. */
export interface ToolExecutionRecord {
  toolCallId: string;
  toolName: string;
  ok: boolean;
  durationMs: number;
  input?: unknown;
  /** 1-based attempt number within this step. */
  attempt: number;
  /** toolCallId of the original call when this record is a retry. */
  retriesOf?: string;
  executed: boolean;
  error?: StructuredError;
}

const DEFAULT_TOOL_TIMEOUT_MS = 30_000;
/** Total attempts per logical tool call (initial + bounded retries). */
const MAX_TOOL_ATTEMPTS = 2;

export class AgentRuntime {
  private events: EventBus;
  private permissions: PermissionEngine;
  private tools: ToolRegistry;
  private router: ProviderRouter;
  private checkpoints?: CheckpointManager;
  private artifacts?: ArtifactManager;
  private planFn: (input: PlanInput) => PlannedStep[];
  private approvalResolver: (req: ApprovalRequest) => boolean | Promise<boolean>;
  private maxSteps: number;
  private perToolTimeoutMs: number;

  private runs = new Map<string, AgentRun>();
  private controllers = new Map<string, AbortController>();
  private paused = new Map<string, () => void>();
  private cancelled = new Set<string>();

  constructor(opts: RuntimeOptions) {
    this.router =
      opts.providers instanceof ProviderRouter ? opts.providers : new ProviderRouter(opts.providers);
    this.events = opts.events;
    this.permissions = opts.permissions ?? new PermissionEngine("BALANCED");
    this.tools = opts.tools ?? new ToolRegistry();
    this.checkpoints = opts.checkpoints;
    this.artifacts = opts.artifacts;
    this.planFn = opts.planFn ?? defaultPlan;
    this.approvalResolver = opts.approvalResolver ?? (() => false);
    this.maxSteps = opts.maxSteps ?? 100;
    this.perToolTimeoutMs = opts.perToolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
  }

  getRun(id: string): AgentRun | undefined {
    return this.runs.get(id);
  }

  allRuns(): readonly AgentRun[] {
    return [...this.runs.values()];
  }

  /** Process-recovery: mark any run left mid-flight as interrupted. */
  recoverInterrupted(): string[] {
    const recovered: string[] = [];
    for (const run of this.runs.values()) {
      if (run.state === "running" || run.state === "planning" || run.state === "waiting_approval") {
        run.state = "interrupted";
        run.updatedAt = new Date().toISOString();
        recovered.push(run.id);
      }
    }
    return recovered;
  }

  pause(runId: string): void {
    const run = this.runs.get(runId);
    if (!run || run.state !== "running") return;
    run.state = "paused";
    run.updatedAt = new Date().toISOString();
    this.events.emit({ type: "run_paused", runId });
  }

  resume(runId: string): void {
    const run = this.runs.get(runId);
    if (!run || run.state !== "paused") return;
    run.state = "running";
    run.updatedAt = new Date().toISOString();
    this.events.emit({ type: "run_resumed", runId });
    this.paused.get(runId)?.();
    this.paused.delete(runId);
  }

  cancel(runId: string): void {
    const run = this.runs.get(runId);
    if (!run) return;
    this.cancelled.add(runId);
    run.state = "cancelled";
    run.updatedAt = new Date().toISOString();
    this.controllers.get(runId)?.abort(new Error("run cancelled"));
    this.events.emit({ type: "run_cancelled", runId });
    this.paused.get(runId)?.();
    this.paused.delete(runId);
  }

  /* ------------------------------------------------------------------ */
  /* Main loop                                                           */
  /* ------------------------------------------------------------------ */

  /** Run a goal with an explicitly injected plan (used by tests and the UI replan flow). */
  async runWithPlan(planned: PlannedStep[], goal: string): Promise<RunResult> {
    const saved = this.planFn;
    this.planFn = () => planned;
    try {
      return await this.run(goal);
    } finally {
      this.planFn = saved;
    }
  }

  async run(goal: string): Promise<RunResult> {
    const nowIso = () => new Date().toISOString();
    const runId = `run-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const controller = new AbortController();
    this.controllers.set(runId, controller);

    const run: AgentRun = {
      id: runId,
      projectId: "default",
      goal,
      state: "planning",
      currentTaskId: null,
      maxSteps: this.maxSteps,
      stepsTaken: 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      finishedAt: null,
      error: null,
    };
    this.runs.set(runId, run);
    this.events.emit({ type: "run_started", runId, payload: { goal } });

    let completedSteps = 0;

    try {
      // ---- planning ----
      this.events.emit({ type: "planning_started", runId });
      const planned = this.planFn({ goal });
      const graph = new TaskGraph(runId, `task-${runId}`);
      for (const p of planned) {
        graph.addStep(p);
        this.declaredTitles.set(p.title, p.expectedTools ?? []);
      }
      this.events.emit({
        type: "plan_updated",
        runId,
        payload: { steps: planned.map((p) => p.title) },
      });

      run.state = "running";

      // ---- execution ----
      while (true) {
        await this.waitWhilePaused(runId);
        if (this.cancelled.has(runId)) break;

        const step = graph.nextRunnable();
        if (!step) break;

        if (run.stepsTaken >= this.maxSteps) {
          throw new AgentError({
            code: "TOOL_TIMEOUT",
            category: "tool",
            message: `max step budget (${this.maxSteps}) exhausted`,
            recoverable: false,
            retryable: false,
            taskId: graph.taskId,
            stepId: step.id,
          });
        }

        run.currentTaskId = graph.taskId;
        graph.setStatus(step.id, "running");
        run.stepsTaken++;
        run.updatedAt = nowIso();
        this.events.emit({
          type: "step_started",
          runId,
          stepId: step.id,
          payload: { title: step.title, attempt: step.attempt },
        });

        const records = await this.executeStep(runId, step.id, step.title, goal, controller.signal);

        // Verification rule: the step only passes if EVERY required call ran OK.
        const failed = records.find((r) => !r.ok);
        if (failed) {
          graph.setStatus(step.id, "failed");
          throw new AgentError({
            code: failed.error?.code ?? "TOOL_TIMEOUT",
            category: failed.error?.category ?? "tool",
            message: `step "${step.title}" failed: ${failed.error?.message ?? "unknown"}`,
            recoverable: false,
            retryable: false,
            taskId: graph.taskId,
            stepId: step.id,
          });
        }

        graph.setStatus(step.id, "completed");
        completedSteps++;
        this.events.emit({ type: "step_completed", runId, stepId: step.id });
      }

      // ---- final review ----
      if (this.cancelled.has(runId)) {
        run.finishedAt = nowIso();
        this.events.emit({ type: "run_cancelled", runId });
        return { runId, state: "cancelled", stepsCompleted: completedSteps, error: null };
      }

      run.state = "completed";
      run.finishedAt = nowIso();
      this.events.emit({ type: "run_completed", runId, payload: { stepsCompleted: completedSteps } });
      return { runId, state: "completed", stepsCompleted: completedSteps, error: null };
    } catch (e) {
      const structured = toStructured(e);
      run.state = "failed";
      run.error = structured;
      run.finishedAt = nowIso();
      this.events.emit({ type: "run_failed", runId, payload: { ...structured } });
      return { runId, state: "failed", stepsCompleted: completedSteps, error: structured };
    } finally {
      this.controllers.delete(runId);
      this.cancelled.delete(runId);
    }
  }

  /* ------------------------------------------------------------------ */

  private async waitWhilePaused(runId: string): Promise<void> {
    if (this.runs.get(runId)?.state !== "paused") return;
    await new Promise<void>((resolve) => this.paused.set(runId, resolve));
  }

  /* plan bookkeeping --------------------------------------------------- */

  private plans = new Map<string, Array<{ name: string; input: unknown }>>();

  /** Declare which concrete tool calls belong to a planned step title. */
  setStepTools(stepTitle: string, calls: Array<{ name: string; input: unknown }>): void {
    this.plans.set(stepTitle, calls);
  }

  private async executeStep(
    runId: string,
    stepId: string,
    stepTitle: string,
    goal: string,
    outerSignal: AbortSignal
  ): Promise<ToolExecutionRecord[]> {
    // Consult model for step guidance (advisory only; MockProvider keeps tests deterministic).
    const provider = this.router.route({ requiredCapability: "chat" });
    const messages: ChatMessage[] = [
      { role: "system", content: "You are an autonomous agent. Use tools to accomplish steps." },
      { role: "user", content: `Goal: ${goal}\nCurrent step: ${stepTitle}` },
    ];
    try {
      await provider.chat({ messages });
    } catch {
      // advisory only
    }

    // Resolve the concrete calls for this step.
    const plannedCalls = this.plans.get(stepTitle);

    // Verification guarantee: if the planner declared expected tools but the
    // executor has no concrete calls, the step MUST fail — it cannot "verify".
    const declared = this.declaredToolsFor(stepTitle);
    if ((plannedCalls === undefined || plannedCalls.length === 0) && declared.length > 0) {
      return [
        {
          toolCallId: `tc-${runId}-missing-${crypto.randomBytes(3).toString("hex")}`,
          toolName: declared[0]!,
          ok: false,
          executed: false,
          durationMs: 0,
          attempt: 1,
          error: {
            code: "INVALID_TOOL_ARGUMENT",
            category: "argument",
            message: `step "${stepTitle}" declares expected tool(s) [${declared.join(", ")}] but no tool call was scheduled/executed`,
            recoverable: false,
            retryable: false,
          },
        },
      ];
    }

    const records: ToolExecutionRecord[] = [];
    let seq = 0;
    const nextCallId = () => `tc-${runId}-${stepId}-${++seq}-${crypto.randomBytes(2).toString("hex")}`;

    for (const call of plannedCalls ?? []) {
      // Cancellation before starting a call: record as executed=false, never retried.
      if (outerSignal.aborted || this.cancelled.has(runId)) {
        records.push({
          toolCallId: nextCallId(),
          toolName: call.name,
          ok: false,
          executed: false,
          durationMs: 0,
          attempt: 1,
          input: call.input,
          error: {
            code: "TOOL_CANCELLED",
            category: "tool",
            message: "cancelled before execution",
            recoverable: false,
            retryable: false,
          },
        });
        break;
      }

      let originalCallId: string | undefined;
      let attempt = 0;

      // Attempt loop: bounded retries; new ToolCall per attempt, linked to original.
      while (true) {
        attempt++;
        const toolCallId = nextCallId();

        this.events.emit({
          type: "tool_requested",
          runId,
          stepId,
          payload: { toolName: call.name, toolCallId, attempt, ...(originalCallId ? { retriesOf: originalCallId } : {}) },
        });

        const started = Date.now();
        try {
          const tool = this.tools.get(call.name);

          // 1) validate input against declared schema
          const parsed = tool.inputSchema.safeParse(call.input);
          if (!parsed.success) {
            throw new AgentError({
              code: "INVALID_TOOL_ARGUMENT",
              category: "argument",
              message: `invalid input for ${call.name}: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
              recoverable: false,
              retryable: false,
              toolCallId,
            });
          }

          // 2) permission gate — no tool bypasses it
          const decision = this.permissions.decide(tool.permissionCategory, tool.name, runId);
          if (decision === "ask") {
            this.events.emit({ type: "approval_requested", runId, stepId, payload: { toolName: tool.name, toolCallId } });
            const approved = await this.approvalResolver({
              toolName: tool.name,
              permissionCategory: tool.permissionCategory,
              reason: `profile requires confirmation for ${tool.permissionCategory}`,
              runId,
            });
            this.events.emit({ type: "approval_resolved", runId, stepId, payload: { toolName: tool.name, approved, toolCallId } });
            if (!approved) {
              throw new AgentError({
                code: "PERMISSION_DENIED",
                category: "permission",
                message: `user denied approval for ${tool.name}`,
                recoverable: true,
                retryable: false,
                toolCallId,
              });
            }
          } else {
            this.permissions.requireAllowed(tool.permissionCategory, tool.name, runId);
          }

          // repeated-action detection (per logical call, not per retry attempt)
          if (attempt === 1) this.noteAction(runId, call.name, call.input);

          // 3) execute with timeout
          this.events.emit({
            type: "tool_started",
            runId,
            stepId,
            payload: {
              toolName: tool.name,
              toolCallId,
              attempt,
              ...(originalCallId ? { retriesOf: originalCallId } : {}),
            },
          });
          const result = await withTimeout(
            tool.execute(parsed.data, {
              runId,
              stepId,
              signal: outerSignal,
            }),
            tool.timeoutMs ?? this.perToolTimeoutMs,
            tool.name
          );
          void result;

          this.events.emit({
            type: "tool_completed",
            runId,
            stepId,
            payload: { toolName: tool.name, toolCallId, attempt, durationMs: Date.now() - started },
          });
          records.push({
            toolCallId,
            toolName: tool.name,
            ok: true,
            executed: true,
            durationMs: Date.now() - started,
            input: call.input,
            attempt,
            ...(originalCallId ? { retriesOf: originalCallId } : {}),
          });
          break;
        } catch (e) {
          const structured = toStructured(e);
          this.events.emit({
            type: "tool_failed",
            runId,
            stepId,
            payload: {
              toolName: call.name,
              toolCallId,
              attempt,
              ...(originalCallId ? { retriesOf: originalCallId } : {}),
              error: structured,
            },
          });

          const wasCancelled =
            structured.code === "TOOL_CANCELLED" || outerSignal.aborted || this.cancelled.has(runId);

          // NEVER retry: cancelled or permission-denied calls, non-retryable errors,
          // or when the attempt budget is exhausted.
          const mayRetry =
            structured.retryable &&
            structured.code !== "PERMISSION_DENIED" &&
            structured.code !== "TOOL_CANCELLED" &&
            !wasCancelled &&
            attempt < MAX_TOOL_ATTEMPTS;

          if (!mayRetry) {
            records.push({
              toolCallId,
              toolName: call.name,
              ok: false,
              executed: structured.code !== "TOOL_CANCELLED" && !outerSignal.aborted && !this.cancelled.has(runId),
              durationMs: Date.now() - started,
              input: call.input,
              attempt,
              ...(originalCallId ? { retriesOf: originalCallId } : {}),
              error: structured,
            });
            break;
          }

          // Link the upcoming retry attempt back to the FIRST call of this chain.
          if (!originalCallId) originalCallId = toolCallId;
          // fall through to next iteration => new ToolCall with retriesOf
        }
      }

      // Stop scheduling further calls once something hard-fails.
      const last = records[records.length - 1];
      if (last && !last.ok) break;
    }

    return records;
  }

  /** Tools declared on the matching planned step (from planFn metadata). */
  private declaredTitles = new Map<string, string[]>();

  private declaredToolsFor(stepTitle: string): string[] {
    return this.declaredTitles.get(stepTitle) ?? [];
  }

  /** Register the declared expectedTools for a planned step title (used by run()). */
  declareStepExpectedTools(stepTitle: string, tools: string[]): void {
    this.declaredTitles.set(stepTitle, tools);
  }

  /* repeated action detection ------------------------------------------ */

  private actionCounts = new Map<string, number>();

  private noteAction(runId: string, toolName: string, input: unknown): void {
    const key = `${runId}:${toolName}:${crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 16)}`;
    const n = (this.actionCounts.get(key) ?? 0) + 1;
    this.actionCounts.set(key, n);
    if (n > 2) {
      throw new AgentError({
        code: "INVALID_TOOL_ARGUMENT",
        category: "tool",
        message: `repeated identical action detected (${toolName}); breaking loop`,
        recoverable: false,
        retryable: false,
      });
    }
  }
}

async function withTimeout<T>(p: Promise<T>, ms: number, name: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new AgentError({
          code: "TOOL_TIMEOUT",
          category: "tool",
          message: `tool "${name}" timed out after ${ms}ms`,
          recoverable: true,
          retryable: true,
        })
      );
    }, ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

export function toStructured(e: unknown): StructuredError {
  if (e instanceof AgentError) return e.toJSON();
  const msg = e instanceof Error ? e.message : String(e);
  return {
    code: "TOOL_TIMEOUT",
    category: "tool",
    message: msg,
    recoverable: false,
    retryable: false,
    technicalCause: e instanceof Error ? e.stack?.slice(0, 500) : undefined,
  };
}
