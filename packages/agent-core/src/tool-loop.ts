/**
 * runToolLoop — the PRODUCTION model-driven execution loop.
 *
 * MODEL -> tool_calls -> validate -> permission -> execute -> persist(event)
 *       -> append tool result -> MODEL again ... until final text response.
 *
 * Safeguards: bounded turns, repeated-call protection, per-tool timeout,
 * cancellation, permission approvals. setStepTools() is NOT used here —
 * the model decides which tools to call.
 */
import type { AgentRun, ChatMessage, ChatRequest, ChatResponse, ModelToolCall, StructuredError } from "@agentmoataz/agent-protocol";
import { AgentError } from "@agentmoataz/agent-protocol";
import type { ModelProvider } from "@agentmoataz/agent-models";
import { zodToJsonSchema } from "zod-to-json-schema";
import { EventBus } from "./events.js";
import { PermissionEngine } from "./permissions.js";
import { ToolRegistry } from "./tools.js";
import { toStructured } from "./runtime.js";
import type { RuntimeStore } from "./store.js";

const DEFAULT_MAX_TURNS = 12;
const MAX_IDENTICAL_CALLS = 2;
const schemaFromZod = zodToJsonSchema as unknown as (
  schema: unknown,
  options: { target: "openApi3"; $refStrategy: "none" }
) => Record<string, unknown>;

export interface ApprovalRequestLite {
  toolCallId: string;
  toolName: string;
  permissionCategory: string;
  reason: string;
}

export interface ToolLoopOptions {
  provider: ModelProvider;
  tools: ToolRegistry;
  permissions: PermissionEngine;
  events?: EventBus;
  maxTurns?: number;
  systemPrompt?: string;
  approvalResolver?: (req: ApprovalRequestLite) => boolean | Promise<boolean>;
  signal?: AbortSignal;
  /** App lifecycle gate, called before every model turn (pause/resume). */
  beforeTurn?: () => Promise<void>;
  runId?: string;
  projectId?: string;
  store?: RuntimeStore;
  workspaceRoot?: string;
  finalReviewer?: (input: { goal: string; text: string; messages: ChatMessage[]; toolCallsExecuted: number }) => Promise<{ approved: boolean; issues: string[] }>;
}

export interface ToolLoopOutcome {
  state: "completed" | "failed" | "cancelled" | "max_turns_exceeded";
  text: string;
  turns: number;
  toolCallsExecuted: number;
  error: StructuredError | null;
  messages: ChatMessage[];
}

export async function runToolLoop(goal: string, opts: ToolLoopOptions): Promise<ToolLoopOutcome> {
  const events = opts.events;
  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;
  const runId = opts.runId ?? "tool-loop";
  const now = new Date().toISOString();
  const existing = await opts.store?.getRun(runId);
  const run: AgentRun = existing
    ? { ...existing, state: "running", maxSteps: maxTurns, updatedAt: now, finishedAt: null, error: null }
    : { id: runId, projectId: opts.projectId ?? "tool-loop", goal, state: "running", currentTaskId: null, maxSteps: maxTurns, stepsTaken: 0, createdAt: now, updatedAt: now, finishedAt: null, error: null };
  await opts.store?.saveRun(run);
  if (!existing) events?.emit({ type: "run_started", runId, payload: { goal } });
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        opts.systemPrompt ??
        "You are an autonomous coding agent. Use the provided tools to accomplish the user's goal, then reply with a final summary.",
    },
    { role: "user", content: goal },
  ];

  const callCounts = new Map<string, number>();
  let turns = 0;
  let executed = 0;

  while (true) {
    await opts.beforeTurn?.();
    if (opts.signal?.aborted) {
      await finishRun(run, opts.store, "cancelled", null);
      events?.emit({ type: "run_cancelled", runId });
      return { state: "cancelled", text: "", turns, toolCallsExecuted: executed, error: null, messages };
    }
    if (turns >= maxTurns) {
      const err = new AgentError({
        code: "TOOL_TIMEOUT",
        category: "tool",
        message: `model loop exceeded ${maxTurns} turns`,
        recoverable: false,
        retryable: false,
      });
      await finishRun(run, opts.store, "failed", err.toJSON());
      events?.emit({ type: "run_failed", runId, payload: { error: err.toJSON() } });
      return { state: "max_turns_exceeded", text: "", turns, toolCallsExecuted: executed, error: err.toJSON(), messages };
    }
    turns++;
    run.stepsTaken = turns;
    run.updatedAt = new Date().toISOString();
    await opts.store?.saveRun(run);

    // 1) ask the model (with available tool schemas)
    let res;
    try {
      res = await chatWithRetry(opts, {
        messages,
        tools: opts.tools.list().map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: schemaFromZod(tool.inputSchema, { target: "openApi3", $refStrategy: "none" }),
        })),
      });
    } catch (error) {
      const structured = toStructured(error);
      await finishRun(run, opts.store, opts.signal?.aborted ? "cancelled" : "failed", structured);
      events?.emit({ type: opts.signal?.aborted ? "run_cancelled" : "run_failed", runId, payload: { error: structured } });
      return { state: opts.signal?.aborted ? "cancelled" : "failed", text: "", turns, toolCallsExecuted: executed, error: structured, messages };
    }

    // 2) no tool calls -> final answer
    if (!res.toolCalls || res.toolCalls.length === 0) {
      messages.push({ role: "assistant", content: res.content });
      if (opts.finalReviewer) {
        let verdict;
        try {
          verdict = await opts.finalReviewer({ goal, text: res.content, messages, toolCallsExecuted: executed });
        } catch (reviewError) {
          const error = toStructured(reviewError);
          await finishRun(run, opts.store, "failed", error);
          events?.emit({ type: "run_failed", runId, payload: { error } });
          return { state: "failed", text: res.content, turns, toolCallsExecuted: executed, error, messages };
        }
        if (!verdict.approved) {
          const error = new AgentError({ code: "BUILD_FAILED", category: "build", message: `final review rejected the run: ${verdict.issues.join("; ")}`, recoverable: true, retryable: false }).toJSON();
          await finishRun(run, opts.store, "failed", error);
          events?.emit({ type: "run_failed", runId, payload: { error, reviewIssues: verdict.issues } });
          return { state: "failed", text: res.content, turns, toolCallsExecuted: executed, error, messages };
        }
      }
      await finishRun(run, opts.store, "completed", null);
      events?.emit({ type: "run_completed", runId, payload: { turns, toolCallsExecuted: executed } });
      return { state: "completed", text: res.content, turns, toolCallsExecuted: executed, error: null, messages };
    }

    messages.push({ role: "assistant", content: res.content || "", toolCalls: res.toolCalls });

    // 3) execute each requested tool through the gated pipeline
    for (const call of res.toolCalls) {
      if (opts.signal?.aborted) {
        await finishRun(run, opts.store, "cancelled", null);
        events?.emit({ type: "run_cancelled", runId });
        return { state: "cancelled", text: "", turns, toolCallsExecuted: executed, error: null, messages };
      }
      events?.emit({ type: "tool_requested", runId, payload: { toolCallId: call.id, toolName: call.name, argumentsJson: call.argumentsJson } });
      const resultText = await executeGated(call, opts, events, callCounts, runId, async (state) => {
        run.state = state;
        run.updatedAt = new Date().toISOString();
        await opts.store?.saveRun(run);
      });
      executed += resultText.ok ? 1 : 0;
      // 4) feed the tool result back into the conversation
      messages.push({ role: "tool", name: call.name, toolCallId: call.id, content: resultText.text });
    }
  }
}

interface GateResult {
  ok: boolean;
  text: string;
}

async function executeGated(
  call: ModelToolCall,
  opts: ToolLoopOptions,
  events: EventBus | undefined,
  callCounts: Map<string, number>,
  runId: string,
  transition: (state: AgentRun["state"]) => Promise<void>
): Promise<GateResult> {
  const started = Date.now();
  try {
    const tool = opts.tools.get(call.name);

    // validate arguments
    let args: unknown;
    try {
      args = JSON.parse(call.argumentsJson || "{}");
    } catch {
      throw new AgentError({
        code: "INVALID_TOOL_ARGUMENT",
        category: "argument",
        message: `tool arguments are not valid JSON`,
        recoverable: false,
        retryable: false,
      });
    }
    const parsed = tool.inputSchema.safeParse(args);
    if (!parsed.success) {
      throw new AgentError({
        code: "INVALID_TOOL_ARGUMENT",
        category: "argument",
        message: `invalid input for ${call.name}: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
        recoverable: false,
        retryable: false,
      });
    }

    // repeated-call protection (same tool + same args)
    const key = `${call.name}:${call.argumentsJson}`;
    const n = (callCounts.get(key) ?? 0) + 1;
    callCounts.set(key, n);
    if (n > MAX_IDENTICAL_CALLS) {
      throw new AgentError({
        code: "INVALID_TOOL_ARGUMENT",
        category: "tool",
        message: `repeated identical model-requested action (${call.name}); stopping safely`,
        recoverable: false,
        retryable: false,
      });
    }

    // permission gate — no bypass
    const decision = opts.permissions.decide(tool.permissionCategory, tool.name);
    if (decision === "ask") {
      await transition("waiting_approval");
      events?.emit({ type: "approval_requested", runId, payload: { toolCallId: call.id, toolName: tool.name, permissionCategory: tool.permissionCategory } });
      const approved = await (opts.approvalResolver?.({ toolCallId: call.id, toolName: tool.name, permissionCategory: tool.permissionCategory, reason: "profile requires confirmation" }) ?? false);
      await transition("running");
      events?.emit({ type: "approval_resolved", runId, payload: { toolCallId: call.id, toolName: tool.name, approved } });
      if (!approved) {
        throw new AgentError({
          code: "PERMISSION_DENIED",
          category: "permission",
          message: `user denied approval for ${tool.name}`,
          recoverable: true,
          retryable: false,
        });
      }
    } else {
      opts.permissions.requireAllowed(tool.permissionCategory, tool.name);
    }

    events?.emit({ type: "tool_started", runId, payload: { toolCallId: call.id, toolName: tool.name } });
    const out = await withTimeout(
      Promise.resolve(tool.execute(parsed.data, { runId, signal: opts.signal, workspaceRoot: opts.workspaceRoot })),
      tool.timeoutMs ?? 30_000,
      tool.name
    );
    const text = summarize(out);
    events?.emit({ type: "tool_completed", runId, payload: { toolCallId: call.id, toolName: tool.name, result: text, durationMs: Date.now() - started } });

    return { ok: true, text };
  } catch (e) {
    const structured = toStructured(e);
    events?.emit({ type: "tool_failed", runId, payload: { toolCallId: call.id, toolName: call.name, error: structured } });
    return {
      ok: false,
      text: `TOOL_ERROR ${structured.code}: ${structured.message}`,
    };
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, name: string): Promise<T> {
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
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer!)) as Promise<T>;
}

function summarize(result: unknown): string {
  if (result === undefined || result === null) return "ok";
  if (typeof result === "string") return result.slice(0, 2000);
  try {
    return JSON.stringify(result).slice(0, 2000);
  } catch {
    return "ok";
  }
}

async function finishRun(run: AgentRun, store: RuntimeStore | undefined, state: AgentRun["state"], error: StructuredError | null): Promise<void> {
  const now = new Date().toISOString();
  run.state = state;
  run.updatedAt = now;
  run.finishedAt = now;
  run.error = error;
  await store?.saveRun(run);
}

async function chatWithRetry(opts: ToolLoopOptions, request: ChatRequest): Promise<ChatResponse> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await opts.provider.chat(request, opts.signal);
    } catch (error) {
      const structured = toStructured(error);
      if (!structured.retryable || attempt === maxAttempts || opts.signal?.aborted) throw error;
      await abortableDelay(250 * 2 ** (attempt - 1), opts.signal);
    }
  }
  throw new AgentError({ code: "MODEL_UNAVAILABLE", category: "model", message: "model retry budget exhausted", recoverable: true, retryable: true });
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new AgentError({ code: "TOOL_CANCELLED", category: "tool", message: "run cancelled", recoverable: true, retryable: false }));
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new AgentError({ code: "TOOL_CANCELLED", category: "tool", message: "run cancelled", recoverable: true, retryable: false }));
    };
    function done() {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
