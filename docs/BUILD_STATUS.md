# BUILD_STATUS.md

Last updated: 2026-08-23

## Environment (Phase 1)

| Tool | Status |
|---|---|
| OS | Windows 11 (win32) |
| Node.js | v24.12.0 ✅ |
| pnpm | 11.9.0 ✅ (workspace + lockfile committed) |
| Git | 2.54.0 ✅ |
| JDK / Java | ❌ not installed on build machine |
| Android SDK | present at `C:\Users\lenovo\AppData\Local\Android\Sdk` but unusable without JDK |
| Rust | intentionally NOT installed (per directive) |
| C++/NDK / Python / WASM | intentionally deferred (optional flags off) |

## Phase checklist

| Phase | Component | Status |
|---|---|---|
| 1 | Environment inspection | ✅ done |
| 2 | Repo bootstrap (pnpm workspace, scripts, .gitignore, CI) | ✅ done |
| 3 | Expo Android app skeleton (expo-router screens, error boundary) | ✅ scaffolded — debug build **not run here** (no JDK); builds via `pnpm android` on a machine with JDK 17+ |
| 4 | agent-protocol: versioned zod schemas for all entities/events/errors/flags | ✅ done + tested |
| 5 | SQLite persistence | ⚠️ interface designed (`MemoryStore` adapter pattern); expo-sqlite adapter lands with the Android app phase. In-memory store fully tested. |
| 6 | agent-workspace: file tools, path security, ZIP export w/ checksum | ✅ done + tested (traversal, zip-slip exclusions, diff, search) |
| 7 | Kotlin native layer (foreground service, secure storage, bridge) | ⏳ pending (requires Android toolchain to verify) |
| 8 | TypeScript Agent Core (runtime, planner, task graph, permissions, checkpoints, artifacts, events) | ✅ done + tested |
| 9 | Event system | ✅ done (EventBus; UI consumes events, never chat prose) |
| 10 | Tool registry (validate → capability → permission → execute) | ✅ done + tested |
| 11 | Permission engine (SAFE/BALANCED/AUTONOMOUS/CUSTOM + audit log) | ✅ done + tested |
| 12 | Checkpoints (manifest + SHA-256, restore) | ✅ done + tested (checkpoint→corrupt→restore round-trip) |
| 13 | Artifacts (types, checksums, verify) | ✅ done + tested |
| 14 | Provider abstraction (MockProvider deterministic, OpenAI-compatible, router w/ fallback) | ✅ done + tested |
| 15 | Agent loop (pause/resume/cancel, max steps, repeated-action detection, per-tool timeouts, linked retries) | ✅ done + tested |
| 16 | Planner / TaskGraph (DAG, replan without deleting history) | ✅ done + tested |
| 17 | Multi-agent roles | ⏳ pending |
| 18 | Memory (working/session/project/long-term, relevance retrieval) | ✅ core done + tested; retrieval ranking basic |
| 19 | Skills registry | ⏳ structure documented; loader pending |
| 20–35 | Project-generation workflow, MCP, Vercel sandbox, research/browser, foreground service, recovery | ⏳ pending |
| 36 | UI wiring to live events | 🟡 screens scaffolded; runtime binding next |
| 38 | ZIP export + SHA-256 (excludes `.env`, `node_modules`, `.agent`) | ✅ done + tested |
| 48 | Tests | ✅ **51 passing** (protocol, workspace, models, memory, runtime e2e, retry regressions) |
| 49 | CI | ✅ workflow committed (lint/typecheck/test) |

## Verification commands

```
pnpm install
pnpm typecheck   # all 5 packages pass
pnpm test        # vitest run — 51/51 green, non-watch mode
```

## Retry architecture (regression-tested)

1. timeout → successful retry (new ToolCall linked via `retriesOf`) ✅
2. timeout until max attempts → run fails `TOOL_TIMEOUT` ✅
3. declared expectedTools with no scheduled calls → step fails ✅
4. cancelled tools never retried ✅
5. permission-denied tools never retried ✅

## Known gaps / remaining work

- Android debug/APK build requires JDK 17+ (documented in README).
- Kotlin bridge + foreground service implementation.
- expo-sqlite persistence adapter.
- MCP, Vercel Sandbox, Supabase sync (all behind disabled feature flags).
