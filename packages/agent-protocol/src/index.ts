/**
 * @agentmoataz/agent-protocol
 *
 * Versioned, runtime-validated schemas shared by every layer of the
 * agent platform (UI, TypeScript core, Kotlin bridge, cloud adapters).
 *
 * PROTOCOL_VERSION follows semver: breaking changes bump the major.
 */
export const PROTOCOL_VERSION = "1.0.0" as const;

import { z } from "zod";

/* ------------------------------------------------------------------ */
/* IDs & primitives                                                    */
/* ------------------------------------------------------------------ */

export const Id = z.string().min(1).max(128);
export type Id = z.infer<typeof Id>;

export const IsoTimestamp = z.string().datetime({ offset: true });
export type IsoTimestamp = z.infer<typeof IsoTimestamp>;

/* ------------------------------------------------------------------ */
/* Structured errors                                                   */
/* ------------------------------------------------------------------ */

export const ErrorCode = z.enum([
  "CAPABILITY_UNAVAILABLE",
  "PERMISSION_DENIED",
  "WORKSPACE_ESCAPE_BLOCKED",
  "INVALID_TOOL_ARGUMENT",
  "NETWORK_UNAVAILABLE",
  "MODEL_UNAVAILABLE",
  "NO_REAL_PROVIDER_CONFIGURED",
  "MODEL_RATE_LIMITED",
  "TOOL_TIMEOUT",
  "TOOL_CANCELLED",
  "BUILD_FAILED",
  "SANDBOX_FAILED",
  "CHECKPOINT_FAILED",
  "DATABASE_FAILED",
  "SECRET_UNAVAILABLE",
  "APP_RESTARTED",
  "UNEXPECTED_ERROR",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ErrorCategory = z.enum([
  "capability",
  "permission",
  "workspace",
  "argument",
  "network",
  "model",
  "tool",
  "build",
  "sandbox",
  "checkpoint",
  "database",
  "secret",
  "runtime",
]);
export type ErrorCategory = z.infer<typeof ErrorCategory>;

export const StructuredErrorSchema = z.object({
  code: ErrorCode,
  category: ErrorCategory,
  message: z.string(),
  recoverable: z.boolean(),
  retryable: z.boolean(),
  taskId: Id.optional(),
  stepId: Id.optional(),
  toolCallId: Id.optional(),
  technicalCause: z.string().optional(),
});
export type StructuredError = z.infer<typeof StructuredErrorSchema>;

export class AgentError extends Error implements StructuredError {
  readonly code: ErrorCode;
  readonly category: ErrorCategory;
  readonly recoverable: boolean;
  readonly retryable: boolean;
  readonly taskId?: string;
  readonly stepId?: string;
  readonly toolCallId?: string;
  readonly technicalCause?: string;

  constructor(init: Omit<StructuredError, never>) {
    super(init.message);
    this.name = "AgentError";
    this.code = init.code;
    this.category = init.category;
    this.recoverable = init.recoverable;
    this.retryable = init.retryable;
    if (init.taskId !== undefined) this.taskId = init.taskId;
    if (init.stepId !== undefined) this.stepId = init.stepId;
    if (init.toolCallId !== undefined) this.toolCallId = init.toolCallId;
    if (init.technicalCause !== undefined) this.technicalCause = init.technicalCause;
  }

  toJSON(): StructuredError {
    return {
      code: this.code,
      category: this.category,
      message: this.message,
      recoverable: this.recoverable,
      retryable: this.retryable,
      ...(this.taskId ? { taskId: this.taskId } : {}),
      ...(this.stepId ? { stepId: this.stepId } : {}),
      ...(this.toolCallId ? { toolCallId: this.toolCallId } : {}),
      ...(this.technicalCause ? { technicalCause: this.technicalCause } : {}),
    };
  }
}

/* ------------------------------------------------------------------ */
/* Core entities                                                       */
/* ------------------------------------------------------------------ */

export const ProjectSchema = z.object({
  id: Id,
  name: z.string().min(1).max(256),
  description: z.string().default(""),
  rootPath: z.string(),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
});
export type Project = z.infer<typeof ProjectSchema>;

export const SessionSchema = z.object({
  id: Id,
  projectId: Id,
  title: z.string().default("Untitled session"),
  createdAt: IsoTimestamp,
});
export type Session = z.infer<typeof SessionSchema>;

export const MessageRole = z.enum(["user", "assistant", "system", "tool"]);
export type MessageRole = z.infer<typeof MessageRole>;

export const MessageSchema = z.object({
  id: Id,
  sessionId: Id,
  role: MessageRole,
  content: z.string(),
  createdAt: IsoTimestamp,
});
export type Message = z.infer<typeof MessageSchema>;

/* ------------------------------------------------------------------ */
/* Runs / tasks / steps                                                */
/* ------------------------------------------------------------------ */

export const RunState = z.enum([
  "idle",
  "planning",
  "running",
  "waiting_approval",
  "paused",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);
export type RunState = z.infer<typeof RunState>;

export const StepState = z.enum([
  "pending",
  "running",
  "waiting_approval",
  "completed",
  "failed",
  "skipped",
  "cancelled",
]);
export type StepState = z.infer<typeof StepState>;

export const AgentRunSchema = z.object({
  id: Id,
  projectId: Id,
  goal: z.string().min(1),
  state: RunState,
  currentTaskId: Id.nullable().default(null),
  maxSteps: z.number().int().positive().default(100),
  stepsTaken: z.number().int().nonnegative().default(0),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
  finishedAt: IsoTimestamp.nullable().default(null),
  error: StructuredErrorSchema.nullable().default(null),
});
export type AgentRun = z.infer<typeof AgentRunSchema>;

export const TaskSchema = z.object({
  id: Id,
  runId: Id,
  title: z.string().min(1),
  status: StepState,
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
});
export type Task = z.infer<typeof TaskSchema>;

export const TaskStepSchema = z.object({
  id: Id,
  taskId: Id,
  title: z.string().min(1),
  goal: z.string().default(""),
  dependencies: z.array(Id).default([]),
  expectedTools: z.array(z.string()).default([]),
  acceptanceCriteria: z.array(z.string()).default([]),
  status: StepState,
  attempt: z.number().int().nonnegative().default(0),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
});
export type TaskStep = z.infer<typeof TaskStepSchema>;

/* ------------------------------------------------------------------ */
/* Tools                                                               */
/* ------------------------------------------------------------------ */

export const PermissionCategory = z.enum([
  "read_project_file",
  "write_project_file",
  "delete_file",
  "bulk_delete",
  "network_get",
  "network_post",
  "download",
  "git_local",
  "git_push",
  "install_package",
  "cloud_execution",
  "external_file_access",
  "camera_microphone",
  "secret_access",
  "destructive_db",
  "execute_code",
]);
export type PermissionCategory = z.infer<typeof PermissionCategory>;

export const ToolCallStatus = z.enum([
  "requested",
  "awaiting_approval",
  "approved",
  "denied",
  "running",
  "completed",
  "failed",
  "cancelled",
  "timed_out",
]);
export type ToolCallStatus = z.infer<typeof ToolCallStatus>;

export const ToolCallSchema = z.object({
  id: Id,
  runId: Id,
  stepId: Id.nullable().default(null),
  toolName: z.string().min(1),
  input: z.unknown(),
  status: ToolCallStatus,
  permissionCategory: PermissionCategory,
  result: z.unknown().nullable().default(null),
  error: StructuredErrorSchema.nullable().default(null),
  startedAt: IsoTimestamp.nullable().default(null),
  finishedAt: IsoTimestamp.nullable().default(null),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

/* ------------------------------------------------------------------ */
/* Approvals                                                           */
/* ------------------------------------------------------------------ */

export const ApprovalDecision = z.enum(["pending", "approved", "denied"]);
export const ApprovalSchema = z.object({
  id: Id,
  runId: Id,
  toolCallId: Id,
  reason: z.string(),
  decision: ApprovalDecision,
  createdAt: IsoTimestamp,
  decidedAt: IsoTimestamp.nullable().default(null),
});
export type Approval = z.infer<typeof ApprovalSchema>;

/* ------------------------------------------------------------------ */
/* Artifacts & checkpoints                                             */
/* ------------------------------------------------------------------ */

export const ArtifactType = z.enum([
  "source_zip",
  "image",
  "video",
  "report",
  "build_output",
  "apk",
  "aab",
  "document",
  "log_bundle",
  "other",
]);
export type ArtifactType = z.infer<typeof ArtifactType>;

export const ArtifactSchema = z.object({
  id: Id,
  projectId: Id,
  taskId: Id.nullable().default(null),
  type: ArtifactType,
  path: z.string(),
  mime: z.string().default("application/octet-stream"),
  provider: z.string().default("local"),
  checksumSha256: z.string().length(64).nullable().default(null),
  sizeBytes: z.number().int().nonnegative().default(0),
  createdAt: IsoTimestamp,
});
export type Artifact = z.infer<typeof ArtifactSchema>;

export const CheckpointSchema = z.object({
  id: Id,
  projectId: Id,
  runId: Id.nullable().default(null),
  reason: z.string(),
  manifest: z.array(
    z.object({
      relativePath: z.string(),
      sha256: z.string().length(64),
      sizeBytes: z.number().int().nonnegative(),
    })
  ),
  createdAt: IsoTimestamp,
});
export type Checkpoint = z.infer<typeof CheckpointSchema>;

/* ------------------------------------------------------------------ */
/* Memory & skills                                                     */
/* ------------------------------------------------------------------ */

export const MemoryScope = z.enum(["working", "session", "project", "long_term"]);
export type MemoryScope = z.infer<typeof MemoryScope>;

export const MemoryRecordSchema = z.object({
  id: Id,
  scope: MemoryScope,
  scopeKey: z.string().default(""),
  content: z.string().min(1),
  source: z.string().default("agent"),
  confidence: z.number().min(0).max(1).default(0.8),
  enabled: z.boolean().default(true),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
});
export type MemoryRecord = z.infer<typeof MemoryRecordSchema>;

export const SkillRecordSchema = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/),
  purpose: z.string(),
  triggers: z.array(z.string()).default([]),
  allowedTools: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
});
export type SkillRecord = z.infer<typeof SkillRecordSchema>;

/* ------------------------------------------------------------------ */
/* Providers & capabilities                                            */
/* ------------------------------------------------------------------ */

export const ProviderCapability = z.enum([
  "chat",
  "coding",
  "tool_calling",
  "structured_output",
  "vision",
  "embeddings",
  "image_generation",
  "video_generation",
  "long_context",
]);
export type ProviderCapability = z.infer<typeof ProviderCapability>;

export const ProviderConfigSchema = z.object({
  id: Id,
  kind: z.enum(["mock", "openai_compatible", "anthropic", "google"]),
  displayName: z.string(),
  baseUrl: z.string().url().nullable().default(null),
  modelId: z.string().nullable().default(null),
  capabilities: z.array(ProviderCapability).min(1),
  /** Secret reference — the actual key lives in secure storage, never here. */
  secretRef: z.string().nullable().default(null),
  enabled: z.boolean().default(true),
  priority: z.number().int().default(50),
});
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

export const ModelToolCallSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  argumentsJson: z.string(),
});
export type ModelToolCall = z.infer<typeof ModelToolCallSchema>;

export const ChatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string(),
  name: z.string().optional(),
  /** Required by OpenAI-compatible APIs when role is tool. */
  toolCallId: z.string().optional(),
  /** Preserves the assistant's requested calls in multi-turn conversations. */
  toolCalls: z.array(ModelToolCallSchema).optional(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

/** Hand-written (looser) type: sampling params are optional at call sites;
 *  the zod schema applies defaults when strict validation is needed. */
export interface ChatRequest {
  messages: Array<z.infer<typeof ChatMessageSchema>>;
  temperature?: number;
  maxTokens?: number;
  /** Tool schemas offered to the model (OpenAI function-calling fields). */
  tools?: ProviderToolSchema[];
}

/** Schema describing one callable tool for the model. */
export interface ProviderToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatResponse {
  content: string;
  finishReason: "stop" | "length" | "error" | "cancelled";
  /** Present when the model requested tool invocations. */
  toolCalls?: ModelToolCall[];
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

export const AgentEventType = z.enum([
  "run_started",
  "planning_started",
  "plan_updated",
  "step_started",
  "step_completed",
  "step_failed",
  "tool_requested",
  "approval_requested",
  "approval_resolved",
  "tool_started",
  "tool_progress",
  "tool_completed",
  "tool_failed",
  "artifact_created",
  "checkpoint_created",
  "run_paused",
  "run_resumed",
  "run_completed",
  "run_failed",
  "run_cancelled",
]);
export type AgentEventType = z.infer<typeof AgentEventType>;

export const AgentEventSchema = z.object({
  id: Id,
  type: AgentEventType,
  runId: Id,
  taskId: Id.nullable().default(null),
  stepId: Id.nullable().default(null),
  payload: z.record(z.unknown()).default({}),
  createdAt: IsoTimestamp,
});
export type AgentEvent = z.infer<typeof AgentEventSchema>;

/* ------------------------------------------------------------------ */
/* Feature flags                                                       */
/* ------------------------------------------------------------------ */

export const FeatureFlagName = z.enum([
  "local_javascript",
  "local_python",
  "local_wasm",
  "local_llm",
  "local_image",
  "remote_models",
  "remote_mcp",
  "cloud_sandbox",
  "cloud_browser",
  "supabase_sync",
  "video_generation",
]);

export const FeatureFlagsSchema = z.object({
  local_javascript: z.boolean().default(false),
  local_python: z.boolean().default(false),
  local_wasm: z.boolean().default(false),
  local_llm: z.boolean().default(false),
  local_image: z.boolean().default(false),
  remote_models: z.boolean().default(true),
  remote_mcp: z.boolean().default(false),
  cloud_sandbox: z.boolean().default(false),
  cloud_browser: z.boolean().default(false),
  supabase_sync: z.boolean().default(false),
  video_generation: z.boolean().default(false),
});
export type FeatureFlags = z.infer<typeof FeatureFlagsSchema>;
