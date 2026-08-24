# AgentMoataz — Local-First Autonomous AI Agent for Android

AgentMoataz is a phone-first autonomous AI work environment for Android. It combines a model-driven agent loop, project workspaces, file tools, persistent tasks and memory, approval-gated tool execution, artifacts/ZIP export, remote MCP, and an Android foreground service.

The phone remains the controller. Cloud services are optional capability providers rather than the application's source of truth.

## Android release target

The maintained release target is:

- **Android 8.0 and newer** (`minSdkVersion 26`)
- **64-bit ARM only** (`arm64-v8a`)
- application ID: `dev.agentmoataz.app`
- JDK 17 for Android builds
- Expo SDK 52 / React Native 0.76
- no Rust dependency in the Android application MVP

See [`docs/ANDROID_RELEASE.md`](docs/ANDROID_RELEASE.md) for release signing, APK/AAB production workflow, ABI/minSdk verification, and GitHub Actions secrets.

## Architecture

```text
+----------------------------------------------------+
| Expo / React Native Android App (TypeScript)       |
| UI · AppAgentRuntime · SQLite · Workspace          |
| Planner · Tool Loop · Memory · Skills · MCP        |
+---------------------------+------------------------+
                            |
                            v
+----------------------------------------------------+
| Agent Core                                          |
| ModelDrivenPlanner · ToolRegistry · PermissionEngine|
| EventBus · Checkpoints · Artifacts · Reviewer       |
+---------------------------+------------------------+
                            |
                            v
+----------------------------------------------------+
| Kotlin local Expo module                            |
| Foreground service · Android lifecycle integration  |
+----------------------------------------------------+

Optional: remote model APIs / MCP / later cloud sandbox
```

The production execution path is model-driven:

```text
USER GOAL
  -> persisted run
  -> ModelDrivenPlanner
  -> model receives validated tool schemas
  -> model requests tool calls
  -> schema validation
  -> PermissionEngine / approval
  -> local tool execution
  -> persisted events and results
  -> model continues
  -> reviewer gate
  -> completion / failure
```

`setStepTools()` remains only for deterministic fixtures/tests; the Android production path uses model-selected tool calls.

## Main packages

| Package | Responsibility |
|---|---|
| `agent-protocol` | Versioned schemas for runs, tasks, tool calls, approvals, artifacts, providers, events and errors |
| `agent-platform` | Portable filesystem/path/crypto/runtime interfaces with Node and Expo adapters |
| `agent-workspace` | Project-rooted filesystem, traversal protection, search/diff/replace, ZIP + SHA-256 |
| `agent-persistence` | Runtime stores and Android `expo-sqlite` persistence |
| `agent-models` | Deterministic MockProvider plus production OpenAI-compatible provider and routing primitives |
| `agent-core` | Agent runtime, model tool loop, model-driven planner, permissions, events, checkpoints, artifacts |
| `agent-memory` | Persistent layered memory with relevance retrieval |
| `agent-skills` | Bundled and externally loadable procedural skills |
| `agent-mcp` | Remote MCP discovery/calls registered through ToolRegistry |
| `agent-team` | Bounded delegation/reviewer coordination |
| `agent-net` | Bounded HTTP/download tools with private-network SSRF blocking by default |
| `agent-project` | Deterministic fixture workflows and a model-driven project-generation path |

## Local-first Android state

Android uses SQLite and app-owned storage for projects and execution history. API keys are stored through `expo-secure-store`; SQLite stores provider configuration and a secret reference, not the plaintext credential.

On startup, unfinished persisted runs are reconciled as `interrupted` rather than silently replaying potentially destructive work. The Tasks screen can start a new safe retry against the same project and goal.

## Built-in workspace tools

The Android agent can expose, subject to PermissionEngine policy:

```text
read_file
read_range
write_file
create_directory
delete_file
copy_file
move_file
list_tree
search_text
replace_text
file_metadata
hash_file
diff_files
create_zip
http_get
http_request
download_file
```

Remote MCP tools are registered into the same ToolRegistry and do not bypass permissions.

Network tools accept public HTTP(S) destinations by default. Local/private network destinations require an explicit trusted opt-in in code; redirects are rechecked.

## Provider setup

The Android MVP completes one provider path end-to-end: **OpenAI-compatible chat-completions endpoints with tool calling**.

In the app open **Models** and configure:

- display name
- base URL, for example `https://api.openai.com/v1/`
- current model ID supported by your endpoint
- API key

The key is saved in secure storage. Saving settings with the key field blank preserves an existing key for the same secret reference.

A real user task **does not silently fall back to MockProvider**. If no production provider is configured, the app returns `NO_REAL_PROVIDER_CONFIGURED`. MockProvider is reserved for deterministic tests and fixtures.

## Permissions

Every tool call goes through PermissionEngine.

| Profile | Reads | Writes | Deletes | Net GET | Net POST | Git push |
|---|---|---|---|---|---|---|
| SAFE | allow | ask | ask | ask | ask | deny |
| BALANCED | allow | allow | ask | allow | ask | ask |
| AUTONOMOUS | allow | allow | allow | allow | allow | ask |

Unknown MCP tools map conservatively to an approval-gated execution category.

## Development verification

Prerequisites:

- Node.js 20+
- pnpm 11.9.0

Run:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm check:android-imports
pnpm --filter @agentmoataz/app-android build
pnpm test
```

The Android import guard ensures Node-only APIs do not leak into the React Native execution path.

## Android development build

Requires JDK 17 and Android SDK:

```bash
cd apps/android
pnpm exec expo prebuild --platform android --clean
pnpm exec expo run:android
```

## Android release build

Pull-request CI builds an installable **release-mode Android 8+ arm64 APK** signed with a temporary CI test key and verifies:

- `minSdkVersion=26`
- `arm64-v8a` native ABI
- no `armeabi-v7a`, `x86` or `x86_64` native libraries
- APK signature
- SHA-256 checksum

For a stable production/update signature, configure the four signing secrets documented in `docs/ANDROID_RELEASE.md` and run the **Android Production Release** workflow. That workflow builds both APK and AAB.

## Optional / deferred features

The MVP deliberately does not depend on:

- Rust
- embedded Python
- WASM
- llama.cpp/local LLM
- local image/video generation
- Supabase sync
- unrestricted local shell

These can be added behind capability flags after the verified Android release path remains stable.

## Security boundaries

- workspaces reject absolute/traversal escape paths
- ZIP exports exclude `.env`, `.agent`, `.git`, `node_modules` and existing exports by default
- provider credentials are not persisted in project files or SQLite payloads
- external web/MCP content is treated as untrusted data
- model-selected tools cannot bypass schema validation or PermissionEngine
- model/tool turns are bounded; repeated identical tool actions are stopped
- network response/download sizes and redirects are capped
- private-network HTTP destinations are blocked by default

See [`docs/SECURITY.md`](docs/SECURITY.md), [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), and [`docs/BUILD_STATUS.md`](docs/BUILD_STATUS.md) for more detail.
