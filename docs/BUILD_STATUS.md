# BUILD_STATUS.md

Last updated: 2026-08-24 (Phase 2)

## Environment

| Tool | Status |
|---|---|
| OS | Windows 10 Pro 10.0.19045 64-bit (win32) |
| Node.js | v24.12.0 ظ£à |
| pnpm | 11.9.0 ظ£à (workspace + lockfile committed) |
| Git | 2.54.0 ظ£à |
| JDK / Java | ظإî not installed on build machine |
| Android SDK | `C:\Users\lenovo\AppData\Local\Android\Sdk` ظ¤ platforms android-36, build-tools 36.0.0, NDK 28.2.13676358 present but unusable without JDK |
| Gradle | not on PATH (wrapper via Expo prebuild after JDK) |
| Kotlin | kotlinc not on PATH (Kotlin sources via Expo Modules) |
| Python | 3.11.15 / 3.14.3 (not required) |
| Rust | intentionally NOT installed (per directive) ظ¤ `scripts/check-android-imports.mjs` guards |
| Storage | C: 168 GB used / 87 GB free |
| Vercel / Supabase | no local configs (local-first) |

## Phase checklist

| Phase | Component | Status |
|---|---|---|
| 1ظô2 | Environment, repo bootstrap, CI | ظ£à done |
| 3 | Expo Android app skeleton (11 screens, error boundary, strict TS, expo-router, New Arch) | ظ£à scaffolded; debug build requires JDK 17+ (`npx expo run:android`) |
| 4 | agent-protocol (versioned schemas, events, errors, flags) | ظ£à done + tested (PROTOCOL_VERSION 1.0.0, zod) |
| 5 | Persistence | ظ£à done: `agent-persistence` (KeyValueStore, atomic JsonFileStore, Collections, PersistentMemoryStore, `SqliteKeyValueStore` + `SqliteRuntimeStore` with FK/indexes/migrations); restart-persistence tested |
| 6 | Workspace (path security, file tools, ZIP+SHA256) | ظ£à **hardened Phase 2**: NFC unicode, null/control, %2e/%2f, `safeArchiveEntryName`, `safeFilename`, `maxArchiveBytes=100MB`/`maxArchiveEntries=2000`, `apply_patch` + `extract_zip` zip-slip safe ظ¤ 37/37 tests |
| 7 | Kotlin native layer | ظ£à sources complete: `AgentForegroundService.kt`, `SecureStorage.kt`, `DeviceRuntime.kt`, `bridge/AgentNativeModule.kt` + `apps/android/modules/agent-native` (Expo module, async/cancellable, CodedException, events); Gradle wiring pending JDK |
| 8 | TypeScript Agent Core | ظ£à done + tested |
| 9 | Event system (EventBus, typed payloads incl. retriesOf) | ظ£à done + tested |
| 10 | Tool registry | ظ£à done + tested (VALIDATEظْCAPABILITYظْPERMISSIONظْEXECUTEظْVALIDATEظْPERSISTظْEVENT) |
| 11 | Permission engine (4 profiles + audit log) | ظ£à done + tested |
| 12 | Checkpoints (manifest, restore round-trip) | ظ£à done + tested |
| 13 | Artifacts (checksum verify) | ظ£à done + tested |
| 14 | Provider abstraction (Mock deterministic, OpenAI-compatible, router fallback) | ظ£à done + tested |
| 15 | Agent loop (pause/resume/cancel, budgets, linked retries) | ظ£à done + regression-tested; `AppAgentRuntime` pause/resume/cancel wired to foreground service (best-effort) |
| 16 | Planner / TaskGraph (DAG, runWithPlan injection) | ظ£à done + tested |
| 17 | Multi-agent | ظ£à done: `agent-team` (MANAGER/PLANNER/CODER/RESEARCHER/REVIEWER/MEDIA, bounded delegation+depth, audit, strict Reviewer gate) |
| 18 | Memory (layered, relevance retrieval) | ظ£à done + tested; persistent adapter via `SqliteKeyValueStore` |
| 19 | Skills | ظ£à done: `agent-skills` (SKILL.md+metadata.json, zod, enable/disable, trigger) |
| 20 | Project-generation workflow | ظ£à done: generateظْvalidateظْrepairظْReviewer gateظْPROJECT_REPORT.mdظْcheckpointظْZIPظْchecksumظْartifact |
| 21 | JavaScript execution | ظ│ deferred (cloud sandbox / optional QuickJS flag off) |
| 22ظô23 | Python / WASM | ظ│ optional flags off by design |
| 24 | Git tools | ظ│ pending |
| 25 | HTTP/download tools | ظ£à done: `agent-net` (http_get/http_request/download_file, size caps, redirects, timeout, cancellation, safe filenames) |
| 26 | Research workflow | ≡ااة fetch layer ready; extraction/evidence store pending |
| 27 | Browser | ظ│ WebView viewer pending Android build |
| 28 | MCP | ظ£à done: `agent-mcp` (JSON-RPC client, registers into ToolRegistry behind PermissionEngine) |
| 29ظô31 | Vercel Sandbox / app services / Supabase sync | ظ│ flags off; adapters pending |
| 32 | Local LLM (llama.cpp) | ظ│ post-MVP flag off |
| 33 | Image/video | ظ│ provider interface reserved |
| 34ظô35 | Foreground service / process recovery | ظ£à Kotlin service + TS recovery (`recoverInterrupted`ظْ`interrupted`+`APP_RESTARTED`) tested; end-to-end pending JDK |
| 36ظô37 | UI | ظ£à screens + navigation + `AppAgentRuntime`/`AppAgentContext` event binding (live timeline via `useAgentRuntime`/`useRun`); native picker/share wiring pending JDK |
| 38 | ZIP export + checksums (excludes secrets/caches/.agent) | ظ£à done + tested (create + extract round-trip) |
| 39 | PROJECT_REPORT generation | ظ£à done + tested |
| 40ظô43 | Security model / path-archive security / secrets / injection defense | ظ£à enforced: path choke, archive guards, secretRef, injection-safe MCP output |
| 44 | Structured error contract | ظ£à done + tested |
| 45ظô46 | Observability / performance basics | ≡ااة structured logs + correlation IDs on events |
| 47 | Open-source integration policy | ظ£à documented (THIRD_PARTY.md, notices) |
| 48 | Tests | ظ£à **127 passing** across 19 suites (was 76 -> +20 security + HEAD audits)
| 49 | CI | ظ£à workflow green-path committed |
| 50 | Documentation | ظ£à README + 8 docs + PHASE_1_REPORT + PHASE_2_REPORT |

## Final acceptance scenarios

**Phase 1 generation** (`packages/agent-project/test/generation.test.ts`): 1-11 all ظ£à (project+workspace, planner, incremental files, permission, validate+repair, review gate, README+PROJECT_REPORT, checkpoint, ZIP exclude, checksum, restart).

**Phase 2 security + lifecycle** (`packages/agent-workspace/test/security.test.ts` + `packages/agent-core/test/runtime.test.ts`):
- traversal / encoded / unicode / control-char blocked ظ£à
- `safeFilename` / `safeArchiveEntryName` ظ£à
- ZIP slip contained inside workspace ظ£à
- archive size/entry guards ظ£à
- `apply_patch` + `create_file` overwrite guard ظ£à
- checkpointظْcorruptظْrestoreظْverify ظ£à (core)
- pauseظْresumeظْcancelظْrecoverInterrupted ظ£à

## Verification commands

```
pnpm install
pnpm lint        # eslint --max-warnings 0
pnpm typecheck   # all 13 projects (portablePathظْexpoPath fix included)
pnpm test        # vitest run ظ¤ 115/115 green, non-watch mode
pnpm build       # typecheck + expo export (APK needs JDK 17)
```

## Known limitations

- No APK produced here (no JDK). Install JDK 17 ظْ `cd apps/android && npx expo prebuild --platform android && npx expo run:android`.
- Kotlin `AgentNativeModule` sources not yet compiled/wired into Gradle (pending JDK).
- Git tools, research evidence store, cloud sandbox adapters remain open work (flags off).

