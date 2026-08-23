# BUILD_STATUS.md

Last updated: 2026-08-24

## Environment (Phase 1)

| Tool | Status |
|---|---|
| OS | Windows 11 (win32) |
| Node.js | v24.12.0 ✅ |
| pnpm | 11.9.0 ✅ (workspace + lockfile committed) |
| Git | 2.54.0 ✅ |
| JDK / Java | ❌ not installed on build machine |
| Android SDK | present but unusable without JDK |
| Rust | intentionally NOT installed (per directive) |

## Phase checklist

| Phase | Component | Status |
|---|---|---|
| 1–2 | Environment, repo bootstrap, CI | ✅ done |
| 3 | Expo Android app skeleton (11 screens, error boundary, strict TS) | ✅ scaffolded; debug build requires JDK 17+ |
| 4 | agent-protocol (versioned schemas, events, errors, flags) | ✅ done + tested |
| 5 | Persistence | ✅ **done**: `agent-persistence` (KeyValueStore, atomic JsonFileStore, Collections, PersistentMemoryStore); restart-persistence tested. expo-sqlite adapter lands with the Android toolchain phase |
| 6 | Workspace (path security, file tools, ZIP+SHA256) | ✅ done + tested |
| 7 | Kotlin native layer | 🟡 sources written (`native/kotlin/`: foreground service, Keystore secure storage, recovery helpers); Gradle wiring pending JDK |
| 8 | TypeScript Agent Core | ✅ done + tested |
| 9 | Event system (EventBus, typed payloads incl. retriesOf) | ✅ done + tested |
| 10 | Tool registry | ✅ done + tested |
| 11 | Permission engine (4 profiles + audit log) | ✅ done + tested |
| 12 | Checkpoints (manifest, restore round-trip) | ✅ done + tested |
| 13 | Artifacts (checksum verify) | ✅ done + tested |
| 14 | Provider abstraction (Mock deterministic, OpenAI-compatible, router fallback) | ✅ done + tested |
| 15 | Agent loop (pause/resume/cancel, budgets, linked retries) | ✅ done + regression-tested |
| 16 | Planner / TaskGraph (DAG, runWithPlan injection) | ✅ done + tested |
| 17 | Multi-agent | ✅ **done**: `agent-team` (MANAGER/PLANNER/CODER/RESEARCHER/REVIEWER/MEDIA, bounded delegation budget + depth, audit trail, strict Reviewer gate) — tested |
| 18 | Memory (layered, relevance retrieval) | ✅ done + tested; persistent adapter added |
| 19 | Skills | ✅ **done**: `agent-skills` (SKILL.md + metadata.json loader, zod validation, enable/disable, trigger matching) — tested |
| 20 | Project-generation workflow | ✅ **done**: `agent-project` (generate → validate → repair → Reviewer gate → PROJECT_REPORT.md → checkpoint → ZIP → checksum → artifact) — covered by the final acceptance e2e test |
| 21 | JavaScript execution | ⏳ deferred to cloud sandbox / optional QuickJS (flag off) |
| 22–23 | Python / WASM | ⏳ optional flags off by design |
| 24 | Git tools | ⏳ pending |
| 25 | HTTP/download tools | ✅ **done**: `agent-net` (http_get/http_request/download_file with size caps, bounded redirects, timeout, cancellation, safe filenames) — tested against a local server |
| 26 | Research workflow | 🟡 fetch layer ready; extraction/evidence store pending |
| 27 | Browser | ⏳ WebView viewer pending Android build |
| 28 | MCP | ✅ **done**: `agent-mcp` (JSON-RPC client: initialize/tools list/tools call; discovered tools register INTO ToolRegistry behind PermissionEngine; injection-safe output handling) — tested with fake MCP server |
| 29–31 | Vercel Sandbox / app services / Supabase sync | ⏳ flags off; adapters pending |
| 32 | Local LLM (llama.cpp) | ⏳ post-MVP flag off |
| 33 | Image/video | ⏳ provider interface reserved in protocol |
| 34–35 | Foreground service / process recovery | 🟡 Kotlin sources written; runtime.recoverInterrupted() implemented & tested; end-to-end pending JDK |
| 36–37 | UI | 🟡 screens + navigation scaffolded; live-event binding next |
| 38 | ZIP export + checksums (excludes secrets/caches/.agent) | ✅ done + tested |
| 39 | PROJECT_REPORT generation | ✅ done + tested |
| 40–43 | Security model / path-archive security / secrets / injection defense | ✅ enforced and tested where applicable locally |
| 44 | Structured error contract | ✅ done + tested |
| 45–46 | Observability / performance basics | 🟡 structured logs in boundary components; correlation IDs on events |
| 47 | Open-source integration policy | ✅ documented (THIRD_PARTY.md, notices) |
| 48 | Tests | ✅ **76 passing** across 12 suites |
| 49 | CI | ✅ workflow green-path committed |
| 50 | Documentation | ✅ README + 8 docs |

## Final acceptance scenario status

Local mock-agent edition implemented in
`packages/agent-project/test/generation.test.ts`:

1. create project record + workspace ✅
2. Planner builds task graph ✅
3. files written incrementally via tools ✅
4. permission engine controls operations ✅
5. validation + repair (package.json parse check w/ fallback) ✅
6. Reviewer inspects changes and gates completion ✅
7. README + PROJECT_REPORT.md generated ✅
8. checkpoint created before packaging ✅
9. ZIP export excluding `.env`, `.agent/`, `node_modules` ✅
10. SHA-256 checksum + artifact indexed ✅
11. restart flow: artifacts/report/checkpoint re-readable from disk only ✅

## Verification commands

```
pnpm install
pnpm typecheck   # all 11 projects pass
pnpm test        # vitest run — 76/76 green, non-watch mode
```

## Known limitations

- No APK produced here (no JDK). Install JDK 17 → `cd apps/android && npx expo prebuild --platform android && npx expo run:android`.
- Kotlin sources not yet compiled/wired into Gradle.
- expo-sqlite adapter, git tools, research evidence store, cloud sandbox adapters remain open work.
