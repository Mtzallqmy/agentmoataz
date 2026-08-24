# BUILD_STATUS.md

Last updated: 2026-08-25 (Phase 4)

## Environment

| Tool | Status |
|---|---|
| OS | Windows 10 Pro 10.0.19045 64-bit (win32) |
| Node.js | v24.12.0 |
| pnpm | 11.9.0 (workspace + lockfile committed) |
| Git | 2.54.0 |
| JDK / Java | not installed on build machine |
| Android SDK | `C:\Users\lenovo\AppData\Local\Android\Sdk` — platforms android-36, build-tools 36.0.0, NDK 28.2.13676358 present but unusable without JDK |
| Gradle | not on PATH (wrapper via Expo prebuild after JDK) |
| Kotlin | kotlinc not on PATH (Kotlin sources via Expo Modules) |
| Python | 3.11.15 / 3.14.3 (not required) |
| Rust | intentionally NOT installed (per directive) — `scripts/check-android-imports.mjs` guards |
| Storage | C: 168 GB used / 87 GB free |
| Vercel / Supabase | no local configs (local-first) |

## Phase checklist

| Phase | Component | Status |
|---|---|---|
| 1-2 | Environment, repo bootstrap, CI | done |
| 3 | Expo Android app skeleton (11 screens + browser, error boundary, strict TS, expo-router, New Arch) | scaffolded; debug build requires JDK 17+ (`npx expo run:android`) |
| 4 | agent-protocol (versioned schemas, events, errors, flags) | done + tested (PROTOCOL_VERSION 1.0.0, zod) |
| 5 | Persistence | done: `agent-persistence` (KeyValueStore, atomic JsonFileStore, Collections, PersistentMemoryStore, `SqliteKeyValueStore` + `SqliteRuntimeStore` with FK/indexes); restart-persistence tested |
| 6 | Workspace (path security, file tools, ZIP+SHA256) | hardened Phase 2: NFC unicode, null/control, %2e/%2f, `safeArchiveEntryName`, `safeFilename`, `maxArchiveBytes=100MB`/`maxArchiveEntries=2000`, `apply_patch` + `extract_zip` zip-slip safe — 37/37 tests |
| 7 | Kotlin native layer | sources complete: `AgentForegroundService.kt`, `SecureStorage.kt`, `DeviceRuntime.kt`, `modules/agent-native` (Expo module, async/cancellable, CodedException, events); Gradle wiring pending JDK |
| 8 | TypeScript Agent Core | done + tested |
| 9 | Event system (EventBus, typed payloads incl. retriesOf) | done + tested |
| 10 | Tool registry | done + tested (VALIDATE->CAPABILITY->PERMISSION->EXECUTE->VALIDATE->PERSIST->EVENT) |
| 11 | Permission engine (4 profiles + audit log) | done + tested |
| 12 | Checkpoints (manifest, restore round-trip) | done + tested |
| 13 | Artifacts (checksum verify) | done + tested |
| 14 | Provider abstraction (Mock, OpenAICompatible, Anthropic, Google, VercelGateway, LocalModel, router with privacy/network/cost/latency) | done + tested (9 tests) |
| 15 | Agent loop (pause/resume/cancel, budgets, linked retries, repeated-error) | done + tested; `AppAgentRuntime` wired to foreground service |
| 16 | Planner / TaskGraph (DAG, split/reorder/replan, parallel batch) | done + tested |
| 17 | Multi-agent | done: `agent-team` (MANAGER/PLANNER/CODER/RESEARCHER/REVIEWER/MEDIA, bounded delegation+depth, audit, strict gate) |
| 18 | Memory (layered working/session/project/long_term, relevant retrieval, editable) | done + tested (3 tests + Phase 4 integration) |
| 19 | Skills | done: 11 builtins + 10 physical skills (`create-expo-project`, `inspect-project`, `repair-typescript-project`, `create-readme`, `package-project`, `research-topic`, `review-project`, `create-simple-game`, `create-api-client`, `review-security`) |
| 20 | Project-generation workflow | done: generate->validate->repair->Reviewer gate->PROJECT_REPORT.md->checkpoint->ZIP->checksum->artifact |
| 21 | JavaScript execution | deferred (cloud sandbox / optional QuickJS flag off) |
| 22-23 | Python / WASM | optional flags off by design |
| 24 | Git tools | pending |
| 25 | HTTP/download tools | done: `agent-net` (http_get/http_request/download_file, size caps, redirects, timeout, cancellation, safe filenames) — 8 tests |
| 26 | Research workflow | done: `research-topic` skill + evidence store (URL/title/time) + untrusted handling (Phase 4) |
| 27 | Browser | done: `apps/android/app/browser.tsx` WebView scaffolder (controlled extraction, cloud_browser flag off) |
| 28 | MCP | done: `agent-mcp` (JSON-RPC, registers behind PermissionEngine, permission-gated) — 5 tests + Phase 4 integration |
| 29-31 | Vercel Sandbox / app services / Supabase sync | done: `agent-sandbox` stub (ephemeral, scoped per task, timeout/resource limits, no secrets) — flags off, graceful CAPABILITY_UNAVAILABLE |
| 32 | Local LLM (llama.cpp) | post-MVP flag off (LocalModelProvider stub) |
| 33 | Image/video | provider interface reserved (vision/image_generation/video_generation) |
| 34-35 | Foreground service / process recovery | done: Kotlin service + TS recovery (`interrupted`+`APP_RESTARTED`) tested |
| 36-37 | UI | done: screens + navigation + `AppAgentRuntime` event binding + chat PlanView/ArtifactsView live timeline + browser screen |
| 38 | ZIP export + checksums (excludes secrets/caches/.agent) | done + tested (create + extract round-trip) |
| 39 | PROJECT_REPORT generation | done + tested |
| 40-43 | Security model / path-archive security / secrets / injection defense | enforced: path choke, archive guards, secretRef, injection-safe MCP, trust order POLICY>USER>PROJECT>RETRIEVED |
| 44 | Structured error contract | done + tested (CAPABILITY_UNAVAILABLE, MODEL_RATE_LIMITED, etc.) |
| 45-46 | Observability / performance basics | structured logs + correlation IDs on events |
| 47 | Open-source integration policy | documented (THIRD_PARTY.md, notices) |
| 48 | Tests | **136 passing** across 20 suites (was 127 -> +9 Phase 4 integration) |
| 49 | CI | workflow green-path committed |
| 50 | Documentation | README + docs (ARCHITECTURE, CLOUD_ESCALATION, SECURITY) + PHASE_1/2/3/4_REPORT |
| 51 | Feature Flags | `remote_models true, remote_mcp false, cloud_sandbox false, cloud_browser false, video_generation false, local_* false, supabase_sync false` — base app builds with all heavy flags off |

## Final acceptance scenarios

**Phase 1 generation** (`generation.test.ts`): 1-11 all done (project+workspace, planner, incremental files, permission, validate+repair, review gate, README+PROJECT_REPORT, checkpoint, ZIP exclude, checksum, restart).

**Phase 2 security + lifecycle** (`security.test.ts` + `runtime.test.ts`):
- traversal / encoded / unicode / control-char blocked
- `safeFilename` / `safeArchiveEntryName`
- ZIP slip contained inside workspace
- archive size/entry guards
- `apply_patch` + `create_file` overwrite guard
- checkpoint->corrupt->restore->verify
- pause->resume->cancel->recoverInterrupted

**Phase 3 router/context/planner** (`models.test.ts`, `context`):
- router privacy/network/cost/latency/contextSize, fallback to mock offline
- ContextManager relevant only (budget 8000t)
- TaskGraph split/reorder/parallel batch

**Phase 4 integration** (`phase4-integration.test.ts`):
- memory retrieval relevant only, inspectable/editable/deletable
- skill trigger matching + allowedTools
- MCP permission enforcement (SAFE -> ask)
- research source tracking (URL/title/time, untrusted)
- browser scaffolder + cloud_browser flag off
- sandbox flag off -> CAPABILITY_UNAVAILABLE, on -> ephemeral exec
- offline -> mock fallback, cloud failure -> MODEL_UNAVAILABLE/SANDBOX_FAILED
- recovery hydrate -> interrupted

## Verification commands

```
pnpm install
pnpm lint        # eslint --max-warnings 0
pnpm typecheck   # all 14 projects (agent-sandbox added)
pnpm test        # vitest run — 136/136 green, 20 suites, non-watch mode (npx vitest run 12.2s)
pnpm build       # typecheck + expo export (APK needs JDK 17)
```

## Known limitations

- No APK produced here (no JDK). Install JDK 17 -> `cd apps/android && npx expo prebuild --platform android && npx expo run:android`.
- Kotlin `AgentNativeModule` sources not yet compiled/wired into Gradle (pending JDK).
- Git tools, research evidence store detailed indexing, cloud sandbox real endpoint, Supabase sync remain flagged off (interface only).
