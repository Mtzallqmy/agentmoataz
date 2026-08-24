# PHASE_3_REPORT.md — AI Providers, Planner, Agent Loop & Multi-Agent

**Date:** 2026-08-25
**Base:** Phase 2 `71a2d42` → Phase 3 enhancements
**Tests:** 127/127 passed (19 suites) | lint clean (eslint --max-warnings 0) | typecheck green (13 workspaces)

## 1. Provider Abstraction (`packages/agent-models`)

**Capabilities** (protocol `ProviderCapability`): `chat, coding, tool_calling, structured_output, vision, embeddings, image_generation, video_generation, long_context` — all validated via zod.

**Providers:**
- `MockProvider` deterministic scripted (fallback, priority 0, offline)
- `OpenAICompatibleProvider` (fetch `chat/completions`, handles 429 → `MODEL_RATE_LIMITED`, `SECRET_UNAVAILABLE`, `NETWORK_UNAVAILABLE`, `MODEL_UNAVAILABLE`)
- `AnthropicProvider` (kind `anthropic`, maps to `https://api.anthropic.com`, capabilities + vision/long_context)
- `GoogleProvider` (kind `google`, `https://generativelanguage.googleapis.com`, + vision/long_context/embeddings)
- `VercelGatewayProvider` (kind `openai_compatible`, `https://api.vercel.ai`, + vision/image/video)
- `LocalModelProvider` stub (future llama.cpp, kind `mock`, `enabled` flag, delegates to Mock when enabled, otherwise `MODEL_UNAVAILABLE`)

Model configuration is **not hard-coded**: `ProviderConfig { id, kind, baseUrl, modelId, capabilities, secretRef, priority, enabled }` is stored via `agent-persistence`/`KeyValueStore` and updatable from the Settings UI (`AppAgentRuntime.configureProvider`). Docs instruct to validate `modelId` from provider's official docs.

## 2. Provider Router

`ProviderRouter` in `packages/agent-models/src/index.ts:259`

Routes by:
- `requiredCapability` (must support)
- `privacy` (`localOnly` vs `cloudAllowed`) + `preferLocal`
- `networkAvailable` (when false → only mock/local, else throw `MODEL_UNAVAILABLE`)
- `costPreference` (`low` → low priority first, `quality/balanced` → high priority first)
- `contextSizeTokens` (>8000 → requires `long_context`)
- `latencyMaxMs` (priority as proxy, low latency prefers local)
- `userPreferredProviderId` (explicit override if capable)

Graceful fallback via `chatWithFallback(pref, req, signal)` — tries candidates in rank order, retries only on `retryable` errors, surfaces last `MODEL_RATE_LIMITED` if all rate-limited, otherwise `MODEL_UNAVAILABLE`. All decisions throw structured `AgentError` with `MODEL_UNAVAILABLE`/`MODEL_RATE_LIMITED`/`CAPABILITY_UNAVAILABLE` per spec.

## 3. Agent Loop

`packages/agent-core/src/runtime.ts:221` implements:

`GOAL → CONTEXT (via ContextManager) → PLAN (ModelDrivenPlanner) → STEP (TaskGraph.nextRunnable/getRunnableBatch) → MODEL (router.route) → TOOL (ToolRegistry) → PERMISSION (PermissionEngine) → EXECUTE (withTimeout) → VERIFY (expectedTools must have executed) → RETRY (linked ToolCall via retriesOf, MAX_TOOL_ATTEMPTS=2) / REPLAN (TaskGraph.replan) → NEXT → FINAL REVIEW (AgentTeam REVIEWER) → ARTIFACT (ArtifactManager + CheckpointManager)`

Verification mandatory: step fails with `INVALID_TOOL_ARGUMENT` if declared `expectedTools` have no scheduled call.

## 4. Safeguards

- `maxSteps` (default 100, configurable) → `TOOL_TIMEOUT` on exhaustion
- `repeated-action detection` (`runtime.ts:607`): same `runId:tool:input` >2 → `INVALID_TOOL_ARGUMENT`
- `repeated-error detection` (`noteError`): same `code:message` >3 → force replan/fail
- `per-tool timeout` (`withTimeout`, default 30s, per-tool `timeoutMs` overrides)
- `cancellation` via `AbortSignal` threaded through `provider.chat` and `tool.execute`; `cancel()` aborts controller, marks `cancelled`, emits `run_cancelled`
- `context budget` via `ContextManager` (8000 tokens, maxFiles 8, maxMessages 12, heuristic 4 chars/token, relevance scoring)
- `durable update after every step`: `persistRun` void-called after `step_started`/`step_completed`/`step_failed`, plus `persistEvent` queue; hydration via `SqliteRuntimeStore`/`JsonRuntimeStore`

## 5. Planner

`packages/agent-core/src/planner.ts:9`

Each `TaskStep` carries `id,title,goal,dependencies,expectedTools,acceptanceCriteria,status,attempt,createdAt,updatedAt` (protocol `TaskStepSchema`).

Planner APIs:
- `addStep(init)` — append
- `splitStep(stepId, parts)` — splits pending step into sequential sub-steps, preserves original dependencies, cancels original without erasing history
- `reorderPending(newOrderIds)` — reorders only pending steps, completed history immutable
- `replan(afterStepId, additions)` — inserts future steps after a point, cancels superseded pending
- `setStatus` prevents resetting `completed` → `pending`

`ModelDrivenPlanner` (`model-planner.ts:99`) asks model for JSON `{steps:[]}`, repairs via `repairPlan` (schema-validate, dedupe titles, drop dangling deps, cycle detection via `findCycle`), falls back to `defaultPlan` (3 steps).

## 6. Task Graph

Real DAG with `TaskGraph`:
- `nextRunnable()` and `getRunnableBatch(limit=3)` enforce `dependencies.every(dep.status===completed||skipped)` → prevents `step dependency not completed`
- `parallelizable` via `getRunnableBatch`, `sequential` via dependencies chain, `retries` via attempt increment, `failed branches` via `failed` status, `replanning` via `replan`/`splitStep` with bounded depth.

Limits: `MAX_PLAN_STEPS=15`, `maxDelegationsPerRun=12`/`maxDepth=2` in team, `MAX_TOOL_ATTEMPTS=2`.

## 7. Reviewer

`AgentTeam.strictReviewer()` (`packages/agent-team/src/index.ts:152`) inspects diff/changes: substantive length, `acceptanceCriteria` with `FAIL:` markers, `TODO/FIXME`. Used in `AppAgentRuntime.runGoal:258` as `finalReviewer`: delegates `MANAGER→REVIEWER`, calls `team.review({changes, acceptanceCriteria})`, records delegation in `audit_logs`, approves via `team.complete` else `team.reject`. Failure triggers `repair` path via next run (replan).

## 8. Multi-Agent

Roles `MANAGER, PLANNER, CODER, RESEARCHER, REVIEWER, MEDIA` (`agent-team/src/index.ts:14`). `Manager` owns objective, delegates (`delegate(from,to,instruction,depth)`), integrates, finalizes; `Planner` owns TaskGraph; `Coder` mutates via `buildCoreFileTools`; `Researcher` read-only (enforced via PermissionEngine, mutation only on explicit delegation); `Reviewer` gate; `Media` routing (post-MVP). Bounded concurrency (`maxDelegationsPerRun`), bounded depth (`maxDepth`), no uncontrolled spawning. Every delegation appended to `auditTrail` and persisted via `AppAgentRuntime.upsertRecord("audit_logs", ...)`.

## 9. Context Management

`packages/agent-core/src/context.ts:1` `ContextManager` (budget `maxTokens 8000`, `maxFiles 8`, `maxMessages 12`):

Retrieves only: relevant files (scored by keyword overlap with goal), relevant messages (last 12), task context, relevant memory, project instructions, tool schemas. Controls `context budget` via `estimateTokens` (4 chars/token) and relevance sort, truncates to budget. Used in `AppAgentRuntime.runGoal` to build `workspaceSummary` and in `ModelDrivenPlanner` via `PlannerContext {memory,skills,capabilities,workspaceSummary}`.

## 10. Agent Events

`packages/agent-core/src/events.ts:1` `EventBus` single source of truth. All state mutations emit event + `persistEvent` → `SqliteRuntimeStore`. Events: `run_started, planning_started, plan_updated, step_started, step_completed, step_failed, tool_requested, approval_requested, approval_resolved, tool_started, tool_progress, tool_completed, tool_failed, artifact_created, checkpoint_created, run_paused, run_resumed, run_completed, run_failed, run_cancelled`. UI consumes via `AppAgentContext` `useRun().events` rendered by `EventTimeline`; no inference from chat prose.

## 11. First Real AI Workflow

Goal `"Create a simple Expo + TypeScript Todo application"`:

1. `AppAgentRuntime.createProject` → `projects/<id>/workspace` + `.agent/*`
2. `ModelDrivenPlanner` analyzes requirements → TaskGraph (DAG)
3. `AgentRuntime.run` executes steps incrementally, `ContextManager` + `workspaceSummary`
4. `buildCoreFileTools` + `buildHttpTools` write files, `write_file`/`read_file` etc.
5. `Verification` via `expectedTools` and `fileMetadata`/`hashFile`
6. `Retry` via linked ToolCalls on `TOOL_TIMEOUT`/`NETWORK_UNAVAILABLE`
7. `Reviewer` (`AgentTeam.strictReviewer`) inspects diff before completion
8. `CheckpointManager` + `ArtifactManager` + `createZip` → `PROJECT_REPORT.md` + SHA256

Local mock edition covered by `packages/agent-project/test/generation.test.ts:25` (creates `todo-app`, validates `package.json`, checks `PROJECT_REPORT.md`, ZIP excludes `.env/.agent/node_modules`, checksum, restart).

## 12. Debugging & Recovery

Every tool failure → `toStructured` → `StructuredError` `{code,category,message,recoverable,retryable,taskId,stepId,toolCallId,technicalCause}`. Core codes: `CAPABILITY_UNAVAILABLE, PERMISSION_DENIED, INVALID_TOOL_ARGUMENT, NETWORK_UNAVAILABLE, MODEL_UNAVAILABLE, MODEL_RATE_LIMITED, TOOL_TIMEOUT, TOOL_CANCELLED, BUILD_FAILED, DATABASE_FAILED` (plus `SECRET_UNAVAILABLE, WORKSPACE_ESCAPE_BLOCKED, CHECKPOINT_FAILED, SANDBOX_FAILED`). Recovery: `recoverable` → retry bounded, `retryable` → `chatWithFallback` next provider, else `replan` or fail run with `run_failed`.

## 13. UI

- `apps/android/app/chat.tsx:6` — conversation + `PlanView` (plan steps, status: running/completed/failed), `ArtifactsView`, `EventTimeline`, approval card, pause/resume/cancel, error banner
- `apps/android/app/tasks.tsx:6` — tasks list with state, `stepsTaken/maxSteps`, persisted runs, retry, live `EventTimeline`
- `apps/android/components/AppUI.tsx` — `Screen, Card, Button, Field, Title, EventTimeline` (event stream rendering)

Chat is **not** just a message interface; it renders live plan/steps/tool calls/permissions/errors/artifacts/progress.

## 14. Acceptance Test

**Real task:** `"Create an Expo + TypeScript Todo app with local persistence, tests and documentation."`

System via `generateProject` (`packages/agent-project/src/index.ts`) does:

- `plan` (ModelDrivenPlanner or defaultPlan, 3–7 steps with dependencies)
- `execute` (file writes via Workspace, 25MB cap, path security)
- `verify` (hash, metadata, read-back)
- `repair` (package.json parse repair fallback)
- `review` (strictReviewer, TODO/FIXME detection)
- `produce artifact` (ZIP + `checksumSha256`, `Artifact` record, `CHECKPOINT`)

Test `generation.test.ts:25` passes 30s, checks 9 files, `reviewApproved`, `report` contains objective/validation, ZIP integrity, and restart flow (`generation.test.ts:72`). Generic projects also pass `generic-projects.test.ts`.

Additional safeguards tested: `model unavailable` (no provider → `CAPABILITY_UNAVAILABLE`), `tool timeout` (slow tool → `TOOL_TIMEOUT` retry), `permission denied` (SAFE profile → `PERMISSION_DENIED`), `retry` (linked `retriesOf`), `replan` (TaskGraph.replan + cancelled superseded), `reviewer rejection` (strictReviewer), `recovery` (hydrate → `interrupted`).

## 15. Final Gate

```
pnpm lint        — eslint --max-warnings 0 ✅
pnpm typecheck   — 13 workspaces (agent-platform portablePath file://-aware) ✅
pnpm test        — vitest run 19 suites, 127/127 green (net, workspace security, runtime, planner, models, etc.) ✅
pnpm build       — typecheck + expo export (scaffolds; APK needs JDK 17) ✅
```

Integration: `AppAgentRuntime` composes `SqliteRuntimeStore`, `ModelDrivenPlanner`, `ContextManager`, `AgentTeam`, `McpClient`, `SkillManager`, `PermissionEngine`; events persisted via `persistenceQueue`.

Android build: `apps/android/app.json` (package `dev.agentmoataz.app`, permissions `POST_NOTIFICATIONS,FOREGROUND_SERVICE`), `modules/agent-native` (Expo native module, `AgentNativeModule.kt`, `AgentForegroundService.kt`), `npx expo prebuild --platform android && npx expo run:android` pending JDK.

**Known limitations for Phase 4:**
- Local LLM (`LocalModelProvider` stub, flag off), embeddings/image/video generation routed but not locally executed
- Browser/WebView viewer, Python/WASM sandboxes flagged off
- Streaming ZIP for >100MB not yet implemented (100MB cap enforced)
- Git tools, research evidence store pending
- Supabase encrypted sync flagged off (localFirst)

**Next:** Phase 4 — persistence hardening, cloud escalation, security audit.
