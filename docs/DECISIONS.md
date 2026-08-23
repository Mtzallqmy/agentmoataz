# DECISIONS.md (ADR log)

## ADR-001 — No Rust anywhere in the build
Rust is not installed and not required. Agent core is TypeScript; Android-native
responsibilities are Kotlin. Optional native runtimes (llama.cpp, QuickJS, WASM)
are post-MVP feature flags.

## ADR-002 — pnpm workspaces, no Nx/Turbo
Five small TypeScript packages with direct workspace deps do not justify a task
runner. `pnpm -r` covers typecheck/test/build orchestration.

## ADR-003 — Zod for the protocol, hand-written loose types at call sites
Schemas are runtime-validated and versioned (`PROTOCOL_VERSION = 1.0.0`).
Sampling params on `ChatRequest` are optional in the TS type because providers
apply defaults; strict validation happens at the boundary when needed.

## ADR-004 — Deterministic MockProvider is a first-class provider
All tests run offline against scripted/deterministic mock output. No test calls
real AI APIs, Vercel, Supabase or any network service. The router treats Mock as
the lowest-priority fallback so local workflows survive network loss.

## ADR-005 — Linked-retry semantics inside steps
A retry is a NEW ToolCall linked to the original via `retriesOf`, bounded by
MAX_TOOL_ATTEMPTS = 2. Cancelled and permission-denied calls are never retried.
A step whose declared expectedTools have no scheduled/executed calls fails with
INVALID_TOOL_ARGUMENT — verification cannot pass silently.

## ADR-006 — Empty relative path resolves to project root
`Workspace.listTree("")` and friends treat "" / "." as the workspace root;
absolute paths, drive prefixes and `..` segments are rejected with
WORKSPACE_ESCAPE_BLOCKED.

## ADR-007 — Android build deferred on machines without JDK
The Expo app is fully scaffolded (expo-router screens, error boundary,
strict TS). Debug builds require JDK 17 + Android SDK; core packages remain
green everywhere. Recorded rather than faked: BUILD_STATUS marks the APK as
not produced on JDK-less machines.

## ADR-008 — Storage behind interfaces
Memory uses a `MemoryStore` interface (in-memory adapter tested; expo-sqlite
adapter planned). SQLite stays the local source of truth; Supabase sync is an
optional, explicit, encrypted backup path.

## ADR-009 — esbuild build-script approval via pnpm-workspace.yaml
pnpm 11 requires explicit approval for dependency postinstall scripts.
`allowBuilds: esbuild: true` is committed so CI installs are deterministic.

## ADR-010 — vitest run only
Tests always run non-watch (`vitest run`) with per-test timeouts to prevent
hanging agents/CI. Watch mode is developer-opt-in only.
