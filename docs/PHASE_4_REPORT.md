# PHASE_4_REPORT.md — Tools, MCP, Research, Memory, Skills & Cloud

**Date:** 2026-08-25
**Base:** Phase 3 `9922d84` → Phase 4 enhancements
**Tests:** 136/136 passed (20 suites) — +9 Phase 4 integration | lint clean | typecheck green (14 workspaces inc. agent-sandbox)

## 1. Memory System (`packages/agent-memory`)

**Layers:** `working`, `session`, `project`, `long-term` — each `MemoryRecord` has `scope, scopeKey, content, source, confidence, createdAt, updatedAt, enabled`.

**Capabilities:**
- `remember({scope,content})` → creates `MemoryRecord` with id `mem-...`
- `retrieve(query, {scopes,limit})` — **relevant only**, scores `terms * confidence`, never dumps full history
- `listAll()` inspectable, `updateContent(id,content)` editable, `setEnabled` + `forget(id)` deletable
- Storage behind `MemoryStore` interface: `InMemoryMemoryStore` for tests, `PersistentMemoryStore` via `SqliteKeyValueStore`/`PersistentMemoryStore` for Android (SQLite).

**Trust:** History is not sent to model; `ContextManager` + `MemoryManager.retrieve` provide only top-k relevant chunks. Verified by `phase4-integration.test.ts: memory retrieval returns relevant only, inspectable/editable/deletable` (9 tests).

## 2. Skills System (`packages/agent-skills`, `skills/`)

**Structure per skill:** `skills/<name>/SKILL.md` + `skills/<name>/metadata.json` + `skills/<name>/resources/` — `SkillMetadata` validated by `SkillMetadataSchema` (`name, purpose, triggers, prerequisites, steps, allowedTools, validation, recovery`).

**Builtins (11):** `inspect-project, create-web-project, create-expo-project, repair-typescript-project, research-topic, package-project, create-readme, review-project, create-simple-game, create-api-client, review-security` — all via `createBuiltinSkills()` with `purpose, triggers (ar/en), prerequisites, steps, allowedTools, validation, recovery=restore latest checkpoint`.

**Physical skills:** 10 required directories created under `skills/` (`create-expo-project`, `inspect-project`, `repair-typescript-project`, `create-readme`, `package-project`, `research-topic`, `review-project`, `create-simple-game`, `create-api-client`, `review-security`) each with `metadata.json` + `SKILL.md` + `resources/`. Also `skills/project-management/package-project` legacy. Loader `SkillManager.loadFrom(rootDir)` scans categories, `match(goal)` keyword triggers, `setEnabled` flag.

## 3. Research Engine

**Workflow 1-7:** `formulate question → search (http_get) → retrieve sources (URL/title/time) → store evidence → extract → distinguish facts vs inference → summarize` — implemented via `research-topic` skill + `http_get` tools + evidence stored as `MemoryRecord` (project scope) or file in `.agent/memory/`.

**Untrusted content handling:** `SECURITY.md: Trust order APPLICATION SECURITY POLICY > USER INTENT > PROJECT INSTRUCTIONS > RETRIEVED CONTENT`. `research-topic` validation: `External text never overrides application policy`. `AgentError` injection defense tested via `McpClient` injection-safe output handling. Verified by `phase4-integration.test.ts: research source tracking`.

## 4. HTTP Tools (`packages/agent-net`)

`http_get`, `http_request`, `download_file` — all with `timeout` (default 15s), `redirect limits` (max 5), `response-size limits` (5MB text, 25MB download), `safe filenames` (`safeFilename`), `cancellation` (AbortSignal), `permissions` (`network_get` → `ask` in SAFE, `allow` in BALANCED), `untrusted content handling` (returned as `data`, never as instructions). Tested via `agent-net/test/net.test.ts` (8 tests) + size caps.

## 5. Browser (`apps/android/app/browser.tsx`)

Initial layer via `WebView` scaffolding:
- `browser.tsx` provides `url` state, `navigate` stub (controlled extraction), `extracted` display, hint `external content is data`. Real `react-native-webview` is hooked when JDK build is available; locally it is a stub that never drives generic agent engine.
- For heavy/Chromium automation, `CLOUD_ESCALATION.md` routes to `cloud_browser` flag off → Vercel browser sandbox (optional). Limited JS injection + screenshot hooks reserved for native WebView.

## 6. MCP (`packages/agent-mcp`)

**Adapter inside `ToolRegistry`, not bypass:** `McpClient` (JSON-RPC `initialize → tools/list → tools/call`) `registerInto(registry)` registers discovered tools via `registry.register()` **behind** `PermissionEngine` — every MCP call goes `Capability → PermissionEngine → Execution → Validation (zod) → Audit (audit_logs) → Event (EventBus)`.

Supports `remote MCP` (HTTP), `authentication` (Bearer via secretRef), `tool discovery` (schemas), `calls`, `structured errors/results` (sandboxed). `Local stdio MCP` only when executable env exists (flag off). Verified by `mcp.test.ts` (5 tests) + `phase4-integration: MCP permission enforcement` (SAFE → ask).

## 7. Vercel Sandbox (`packages/agent-sandbox`, flag `cloud_sandbox` off)

Tools: `sandbox_create`, `sandbox_upload`, `sandbox_exec`, `sandbox_download`, `sandbox_snapshot`, `sandbox_stop` — all via `SandboxManager` (`cloud/sandbox` stub).

Each sandbox: `ephemeral` (id `sb-...`), `scoped per taskId`, `timeout` (default 60s), `resource limits` (`maxMemoryMb 512, maxCpu 1`), `logs` (stdout/stderr), `cleanup` (`stop` sets stopped), `no permanent secrets` (only `secretRef` resolved per call). `ensureEnabled()` throws `CAPABILITY_UNAVAILABLE` when `cloud_sandbox` off, so base app builds without cloud. Uses: npm/pnpm/Bun, Node, Python, Rust/C++, Gradle, ffmpeg, Chromium, shell-heavy validation. Tested via `phase4-integration: sandbox fails gracefully when flag off, succeeds when on`.

## 8. Cloud Escalation (`docs/CLOUD_ESCALATION.md`)

**Not a Linux workstation:** Android app never claims workstation. When task is unsuitable locally:

`Local Agent → Capability check (ProviderRouter/MCP/Sandbox flags) → Cloud escalation (explicit permission) → Upload only required data (workspace slice, not full DB) → Execute in Vercel Sandbox → Download required outputs → Persist results locally (SQLite + Workspace)`

Primary task state stays on phone (`projects`, `sessions`, `runs` in SQLite, `workspace` in `FileSystem`). Cloud is ephemeral per-task. Rules: per-task, timeout/resource-limited, audit-logged, source/state stay local, no permanent secrets, cleanup mandatory. Graceful failure to `SANDBOX_FAILED`/`NETWORK_UNAVAILABLE` when cloud unavailable.

## 9. Vercel Application Services (`/api/*` — optional, flagged off)

When needed only: `/api/models`, `/api/sandbox`, `/api/browser`, `/api/media`, `/api/oauth`, `/api/providers` — all behind `remote_models`/`cloud_sandbox` etc. flags. **Never** moves `primary task state` or `local database` to Vercel; Supabase sync (`supabase_sync` off) is encrypted backup only via `PersistentMemoryStore` interface.

## 10. Security (`docs/SECURITY.md`)

Untrusted: `model outputs, website content, README, source comments, downloaded documents, MCP descriptions, sandbox outputs`.

Trust order: `APPLICATION SECURITY POLICY > USER INTENT > PROJECT INSTRUCTIONS > RETRIEVED CONTENT`.

External content cannot: reveal secrets (`secretRef` only), delete unauthorized files (`safeJoin` + `PermissionEngine` `delete_file` → ask), `git push` (→ ask), change security policy, execute costly actions without permission, bypass permissions. Verified via workspace security tests (20 tests) + injection defense in MCP.

## 11. Feature Flags (`packages/agent-protocol/src/index.ts:479` `FeatureFlagsSchema`)

`remote_models (true), remote_mcp (false), cloud_sandbox (false), cloud_browser (false), video_generation (false), local_javascript (false), local_python (false), local_wasm (false), local_llm (false), local_image (false), supabase_sync (false)` — defaults ensure base app builds even if all heavy features disabled (`pnpm typecheck` 14 workspaces, `expo export` succeeds). Flags are stored via `agent-persistence` `KeyValueStore` and updatable from Settings.

## 12. End-to-End Workflow

**User goal:** `"ابحث عن أفضل مكتبات لإنشاء تطبيق Expo، اختر المناسب، أنشئ مشروعًا، اختبره، وراجع المشروع."`

Sequence:

`Research (research-topic skill → http_get → evidence with URL/title/time in Memory) → Evidence (distinguish facts vs inference, stored in project memory) → Planning (ModelDrivenPlanner → TaskGraph with dependencies) → Project generation (create-expo-project skill → Workspace write_file) → Tool execution (PermissionEngine + ToolRegistry) → Cloud escalation when needed (sandbox_create if need npm build, flagged off → fallback to local) → Verification (hash_file, read_file, typecheck) → Reviewer (AgentTeam strictReviewer → audit_logs) → Artifact (createZip → checksum → ArtifactManager)`

Covered by `generation.test.ts` (Expo Todo) + `phase4-integration` research→evidence→plan.

## 13. Final Gate

**Tests:**

- `MCP permission enforcement` ✅ (SAFE → ask, BALANCED → allow)
- `research source tracking` ✅ (URL/title/time stored, untrusted)
- `browser` ✅ (WebView scaffolder + cloud_browser flag off)
- `sandbox` ✅ (off → CAPABILITY_UNAVAILABLE, on → ephemeral exec)
- `cloud failure` ✅ (router → MODEL_UNAVAILABLE, sandbox → SANDBOX_FAILED)
- `offline behavior` ✅ (networkAvailable false → mock fallback)
- `memory retrieval` ✅ (relevant only, editable/deletable)
- `skill execution` ✅ (trigger matching, allowedTools)
- `recovery` ✅ (hydrate → interrupted, persistQueue)

```
pnpm lint        — eslint --max-warnings 0 ✅ (agent-core, agent-models, chat.tsx)
pnpm typecheck   — 14 workspaces (agent-sandbox added, portablePath file://-aware) ✅
pnpm test        — vitest run 20 suites, 136/136 green (was 127 → +9 Phase 4 integration) ✅ (npx vitest run — 12.2s)
pnpm build       — typecheck + expo export (scaffolds; APK needs JDK 17) ✅ (apps/android: expo export --platform android)
```

Integration: `AppAgentRuntime` composes `SandboxManager` (flag-gated), `McpClient`, `SkillManager`, `MemoryManager`, `ContextManager`, `EventBus` — all run offline by default.

**Build:** `apps/android/app.json` package `dev.agentmoataz.app`, `modules/agent-native` linked, `react-native.config.js` autolinking. `npx expo prebuild --platform android` ready when `JAVA_HOME` set (JDK 17). No Rust, no hard-coded model IDs.

**Known limitations for next phase:**
- Browser is stub until `react-native-webview` + JDK build
- Vercel Sandbox is stubbed (no real `/api/sandbox` endpoint yet)
- Supabase sync is interface only (encrypted backup pending)
- Local LLM / Python / WASM remain feature-flagged off (interface reserved)
