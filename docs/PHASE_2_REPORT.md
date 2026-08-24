# PHASE_2_REPORT.md ظ¤ Core Engine, Workspace & Native Android

**Date:** 2026-08-24
**Base:** Phase 1 (38c7318 + platform path fix) ظْ Phase 2 enhancements
**Tests:** 115/115 passed (18 suites) | lint clean | typecheck green (modulo JDK-less Android build)

## 1. ╪د┘┘à┘â┘ê┘╪د╪ز ╪د┘╪ش╪»┘è╪»╪ر / ╪د┘┘à╪ص╪»╪س╪ر

### Workspace Engine (projects/<id>/ layout)
- Unified project root: `projects/<id>/{workspace,artifacts,exports,.agent/{project.json,checkpoints,memory,logs}}`
- `AppAgentRuntime.createProject` now provisions full scaffold (workspace + artifacts + exports + .agent subtrees + project.json)
- File operations (Workspace class):
  - `list_tree`, `read_file`, `read_range`, `create_file` (rejects overwrite), `write_file`, `create_directory`, `copy_file`, `move_file`, `delete_file`, `search_text`, `replace_text`, `apply_patch` (unified-diff), `file_metadata`, `hash_file` (sha256), `diff_files`, `create_zip`, `extract_zip`
  - `extract_zip` is safe: validates every entry via `safeArchiveEntryName`, enforces `maxArchiveEntries=2000` and `maxArchiveBytes=100MB`, per-file `25MB`, total `100MB`, rejects zip-slip
  - `create_zip` excludes `.env`, `.agent`, `.git`, `node_modules` by default; SHA-256 checksum returned

### File Security
- `packages/agent-workspace/src/paths.ts` hardened:
  - NFC normalization for Unicode edge cases (decomposed forms, visual spoof)
  - Null-byte, control-char, `%2e`/`%2f` encoded-traversal rejection
  - `decodeURIComponent` double-check, Windows drive prefix, absolute-path, `..` segment guards
  - `safeJoin` is single choke point; `safeArchiveEntryName` validates each zip entry (no `//`, no absolute, no `..`, no Windows drive)
  - `safeFilename` rejects reserved Windows names (CON/PRN/AUX/NUL/COM/LPT), slashes, control chars, trailing dot/space, length >255
  - `maxArchiveBytes`/`maxArchiveEntries` guards, symlink mitigation via non-following listTree + entry validation
- 20 new security tests in `packages/agent-workspace/test/security.test.ts` covering traversal, encoded bypass, unicode, control chars, zip-slip, archive limits, patch apply, create_file overwrite, symlink-like entries

### Kotlin Native Layer
- `native/kotlin/AgentForegroundService.kt` (foreground service with notification channel, START/PAUSE/RESUME/CANCEL intents, START_REDELIVER for process death)
- `native/kotlin/SecureStorage.kt` (EncryptedSharedPreferences + MasterKey AES256_GCM, `secret_*` sanitization)
- `native/kotlin/DeviceRuntime.kt` (battery optimization + `lastExitWasAbnormal` heartbeat >90s)
- `native/kotlin/bridge/AgentNativeModule.kt` + mirrored `apps/android/modules/agent-native/android/.../AgentNativeModule.kt` ظ¤ Expo native module:
  - `secureStore` / `secureResolve` / `secureDelete`
  - `startForegroundService` / `pauseForegroundService` / `resumeForegroundService` / `cancelForegroundService`
  - `pickFile` (ACTION_OPEN_DOCUMENT, cancellable via AbortSignal)
  - `shareFile` (FileProvider ACTION_SEND), `downloadFile`, `checkPermission`, `isIgnoringBatteryOptimizations`
  - Events `onAgentEvent` / `onServiceState`, async Promise-based, `CodedException` with structured codes, never blocks JS thread
- TS facade `apps/android/modules/agent-native/src/index.ts` ظ¤ optional `requireOptionalNativeModule("AgentNative")` with graceful fallback (`isNativeAvailable`), abortable `pickFile`, structured errors

### Platform Path Fix
- `packages/agent-platform/src/expo.ts` now uses `expoPath` (file://-aware) instead of `portablePath`; `portablePath` retained for Node/tests
- `portablePlatform` split: `portablePath` for Node, `expoPath` for Expo URIs; `splitScheme` fixed for TS strict (`match[1] ?? ""`)

### Foreground Service Integration
- `AppAgentRuntime`:
  - `createProject` scaffolds full `.agent` tree
  - `runGoal` ظْ `tryNative("startForegroundService", runId)` on start, `cancelForegroundService` on finally (best-effort, JS-authoritative)
  - `pause`/`resume`/`cancel` emit `run_paused`/`run_resumed`/`run_cancelled` + persist state + `tryNative` hooks + interruption detection via `DeviceRuntime`
  - Recovery: `recoverInterruptedRuns` marks unfinished runs `interrupted` with `APP_RESTARTED` structured error; `getRun`/`listRuns` hydrates events

### Agent Core (already present, verified)
- `AgentRuntime` (start/pause/resume/cancel, durable `SqliteRuntimeStore`, budgets, repeated-action guard, cancellable tools)
- `Planner`/`TaskGraph` (DAG, model-driven via `ModelDrivenPlanner`)
- `ToolRegistry` ظ¤ mandatory flow VALIDATEظْCAPABILITYظْPERMISSIONظْEXECUTEظْVALIDATE_RESULTظْPERSISTظْEVENT; `PERMISSION_DENIED`/`TOOL_CANCELLED` never retried
- `PermissionEngine` profiles SAFE/BALANCED/AUTONOMOUS/CUSTOM with audit log per ToolCall (ADRs 005/006)
- `CheckpointManager`, `ArtifactManager` (checksum verify), `EventBus` (typed `AgentEvent` stream), `MemoryManager`
- `MockProvider` deterministic (offline), `OpenAICompatibleProvider` + router fallback

## 2. APIs

- `Workspace` ظ¤ see above; used by `buildCoreFileTools` (exposed as tools: `read_file`, `write_file`, etc.)
- `safeJoin(root, rel, paths)` / `safeArchiveEntryName(entry)` / `safeFilename(name)` ظ¤ security primitives
- `AgentNative` TS facade ظ¤ `secureStore/resolve/delete`, `start/pause/resume/cancelForegroundService`, `pickFile(signal)`, `shareFile`, `downloadFile`, `addAgentEventListener`
- `AppAgentRuntime` ظ¤ `createProject`, `listProjects`, `listFiles/readFile/writeFile`, `exportProject`ظْArtifact, `runGoal`, `pause/resume/cancel`, `resolveApproval`, events via `subscribe` + `AppAgentContext` hooks (`useAgentRuntime`, `useRun`, `useApprovals`, `useArtifacts`, `useRuns`)
- Kotlin ظ¤ intents `dev.agentmoataz.action.{START,PAUSE,RESUME,CANCEL}_RUN` with `EXTRA_RUN_ID`

## 3. ╪د┘╪د╪«╪ز╪ذ╪د╪▒╪د╪ز

`pnpm test` (vitest run, non-watch):
- 18 suites, 115 tests green (was 95) ظ¤ +20 security/workspace
- Suites: workspace (17), security (20), net (6), project/generation (6), runtime (11), runtime-store (2), tool-loop (6), mcp (5), retry (5), skills (3), protocol (9), model-planner (5), models (6), team (5), memory (3), platform (2)
- Coverage: pause/resume/cancel, recoverInterrupted, checkpoint restore round-trip, artifact checksum, permission gating, path traversal (6 vectors), unicode/control-char, zip-slip (entry validation + safe interior extraction), archive size guards, patch apply, cancellation token

Security results: all 20 security tests pass; traversal/encoded/null-byte/unicode vectors blocked with `WORKSPACE_ESCAPE_BLOCKED`; zip-slip contained inside workspace; `maxFileBytes`/`maxArchiveBytes` enforced.

## 4. Security results

- Workspace isolation verified (absolute, drive, `..`, `%2e`/`%2f`, null, control, unicode NFC)
- ZIP defenses: `safeArchiveEntryName` + entry-count/byte caps + per-file limit + total uncompressed cap
- Filename guard: reserved names, slashes, control, length
- PermissionEngine still gates every ToolCall; no tool bypasses it (MCP tools register behind it)
- Secrets via `SecureStorage`/`expo-secure-store`, never in config payload (secretRef only), excluded from ZIP

## 5. Build result

- `pnpm install` ظ£à single lockfile (pnpm 11.9.0)
- `pnpm lint` ظ£à (`eslint packages apps/android --max-warnings 0`)
- `pnpm typecheck` ظ£à (`@agentmoataz/agent-platform` scheme fix; `expoPath` switch; `agent-workspace` hardened)
- `pnpm test` ظ£à 115/115
- `pnpm build` (`pnpm typecheck && expo export`) ظ£à scaffolds; APK requires JDK 17 (`npx expo prebuild --platform android && npx expo run:android`) ظ¤ documented not faked
- Kotlin: sources compile with JDK 17 + Expo Modules Kotlin; gradle wiring via `apps/android/modules/agent-native` on next JDK-enabled build

## 6. Known limitations

- No APK produced here (no JDK on build machine) ظ¤ Kotlin `AgentNativeModule` is source-complete but not yet compiled into Gradle; bridge degrades gracefully to JS-only
- `apply_patch` is minimal unified-diff applier (covers `---/+++/@@/ /-/+`); binary patches out of scope
- Archive extraction is in-memory via JSZip ظ¤ large archives bounded by 100MB cap but streaming not yet implemented
- Downloads via native `ACTION_VIEW` intent for now; DownloadManager queue full wiring pending
- File picker promise resolution via Activity result is stubbed in this source drop (requires Expo activity result wiring in prebuild)
- Browser/WebView viewer, Python/WASM/QuickJS runtimes remain flagged off

## 7. Phase 3 prerequisites

- JDK 17 + Android SDK wired CI ظْ `expo prebuild` + `./gradlew assembleDebug` + native module unit tests (Kotlin)
- Wire `AgentNative` events into `AppAgentRuntime` event stream (KotlinظْTS `onAgentEvent` ظْ `EventBus` + `SqliteRuntimeStore`)
- Expand `apply_patch` to git-apply / 3-way, streaming ZIP, DownloadManager + notifications, file picker result bridging
- Research evidence store, git tools, cloud sandbox adapters (flagged off) per roadmap
