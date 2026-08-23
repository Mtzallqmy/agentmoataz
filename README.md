# AgentMoataz — Local-First Autonomous AI Agent (Android)

One Android application that acts as a personal autonomous AI work environment:
coding agent, project builder, research agent, artifact manager, file editor and
multi-step task executor. The phone is the master controller; cloud services are
optional tools, never the foundation.

## Architecture summary

```
+--------------------------------------------------+
|   Expo / React Native Android App  (TypeScript)  |
|   UI · Agent Core · Planner · Tools · Memory     |
|   Permission Engine · Model Router · Events      |
+------------------------+-------------------------+
                         v
+--------------------------------------------------+
|        Kotlin Android Layer (lifecycle,          |
|        foreground service, secure storage)       |
+------------------------+-------------------------+
              optional only: C/C++ | Python | WASM
```

Core packages (`packages/`, TypeScript strict):

| Package | Responsibility |
|---|---|
| `agent-protocol` | Versioned zod schemas: runs, tasks, steps, tool calls, approvals, artifacts, checkpoints, memory, providers, events, structured errors, feature flags |
| `agent-workspace` | Project-rooted file tools with path-traversal defense, search/diff/patch, ZIP export + SHA-256 |
| `agent-models` | `ModelProvider` abstraction, deterministic `MockProvider`, OpenAI-compatible adapter, capability-based router with fallback |
| `agent-core` | AgentRuntime loop, TaskGraph/Planner, ToolRegistry, PermissionEngine (SAFE/BALANCED/AUTONOMOUS/CUSTOM), CheckpointManager, ArtifactManager, EventBus |
| `agent-memory` | Layered memory (working/session/project/long-term) with relevance retrieval behind a swappable store interface |

Execution model:

```
USER GOAL -> CONTEXT -> PLAN -> TASK GRAPH -> STEP ->
MODEL DECISION -> TOOL REQUEST -> PERMISSION CHECK -> EXECUTION ->
VERIFICATION -> RETRY (linked attempts) / REPLAN -> FINAL REVIEW ->
ARTIFACTS + REPORT
```

## Prerequisites

- Node.js ≥ 20, pnpm ≥ 9
- For the Android build only: JDK 17+, Android SDK (`ANDROID_HOME`)

## Install

```bash
pnpm install
pnpm typecheck
pnpm test          # vitest run (non-watch)
```

## Run / Build

```bash
# core packages (no device needed)
pnpm typecheck && pnpm test

# Android app (requires JDK 17+ and ANDROID_HOME)
cd apps/android
pnpm install
npx expo run:android          # debug build on device/emulator
```

If no JDK is available, everything above the native layer still builds and all
tests pass; the app layer builds once a JDK is present.

## Provider setup

1. Settings → Models in the app (or edit provider config).
2. API keys are stored **only** in secure storage (Android Keystore via
   expo-secure-store). Config records keep a `secretRef`, never the key.
3. Supported adapters: any OpenAI-compatible endpoint (OpenAI, OpenRouter,
   Groq, LM Studio…), Anthropic, Google, plus the built-in offline MockProvider.
4. Model IDs are user-configured; validate current IDs from your provider's
   official docs — nothing is hard-coded.

Model calls without network fall back to `MockProvider` so local workflows
never break.

## Permissions model

Every tool call passes the PermissionEngine — no exceptions.

| Profile | Reads | Writes | Deletes | Net GET | Net POST | Git push |
|---|---|---|---|---|---|---|
| SAFE | allow | ask | ask | ask | ask | deny |
| BALANCED | allow | allow | ask | allow | ask | ask |
| AUTONOMOUS | allow | allow | allow | allow | allow | ask |

All decisions are audit-logged and tied to tool-call IDs.

## Optional cloud

Vercel Sandbox (heavy builds), Supabase (encrypted sync/backup), remote MCP and
cloud browser are all behind feature flags that default to **off**. The app is
fully functional with every optional flag disabled.

## Troubleshooting

- `pnpm install` blocked build scripts → ensure `allowBuilds: esbuild: true`
  in `pnpm-workspace.yaml`.
- Android build fails on Java version → install JDK 17 and set `JAVA_HOME`.
- Tests hang → they shouldn't; all suites run via `vitest run` with explicit
  per-test timeouts and deterministic mocks. Never use watch mode in CI.

See [docs/](./docs) for architecture, security, runtime design, tool protocol,
cloud escalation policy, decisions log and third-party notices.
