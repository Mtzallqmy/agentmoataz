# THIRD_PARTY.md

| Dependency | License | Used by | Notes |
|---|---|---|---|
| zod | MIT | agent-protocol, agent-core | runtime schema validation |
| jszip | MIT/GPLv3 dual | agent-workspace | ZIP export (MIT option applicable) |
| vitest | MIT | dev/tests | test runner, non-watch mode |
| typescript | Apache-2.0 | all packages | strict mode compiler |
| esbuild | MIT | vitest dep | build script explicitly approved |
| expo / react-native / expo-router | MIT | apps/android | Android app shell |
| expo-secure-store / expo-sqlite | MIT | apps/android | secrets + local DB |

## Studied for architecture (not vendored)
Goose, OpenCode, OpenHands, MCP SDKs, llama.cpp, QuickJS — ideas only; licenses
reviewed; no repository trees merged. No Rust-derived components are used.

Full notices: see THIRD_PARTY_NOTICES.md at repo root.
