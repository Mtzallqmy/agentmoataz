# ARCHITECTURE.md

```
+---------------------------------------------------+
|        Expo / React Native Android App            |
|                (TypeScript)                       |
|                                                   |
|  UI screens (expo-router)                         |
|    Home Chat Projects Tasks Files Artifacts       |
|    Models Tools Memory Skills Settings            |
|                                                   |
|  Agent Core (packages/agent-core)                 |
|    AgentRuntime · Planner/TaskGraph · ToolRegistry|
|    PermissionEngine · Checkpoints · Artifacts     |
|    EventBus (single structured event stream)      |
|                                                   |
|  Models (agent-models)   Memory (agent-memory)    |
|  Protocol (agent-protocol) Workspace (workspace)  |
+------------------------+--------------------------+
                         v
+---------------------------------------------------+
|              Kotlin Android Layer                 |
|  Foreground service · lifecycle recovery ·        |
|  secure storage · notifications · file/share ·    |
|  native bridge (async, cancellable, typed errors) |
+------------------------+--------------------------+
               optional only (feature-flagged, off by default)
+---------------------------------------------------+
|  Local runtimes: QuickJS | CPython | WASM | llama |
+---------------------------------------------------+

Cloud (optional tools, never the foundation):
  Vercel Sandbox (heavy builds) · Supabase (encrypted sync) ·
  remote MCP · cloud browser · model APIs
```

## TypeScript / Kotlin boundary
TypeScript owns all agent logic; Kotlin owns Android platform concerns.
The bridge is asynchronous and cancellable with structured errors and event
streams; it never blocks the JS thread.

## Data flow
1. User goal enters a Session → AgentRun.
2. Planner builds a TaskGraph (DAG); steps declare expectedTools + criteria.
3. Each step consults the model (router picks provider by capability), then
   executes concrete tool calls through the registry.
4. Every tool call is schema-validated, permission-gated, timeout-bounded,
   retried via linked attempts, and emitted on the EventBus.
5. UI renders the event timeline live; durable state updates after each step.
6. Verification gates completion; artifacts/checkpoints/ZIPs are produced only
   after verification.

## Local vs cloud routing
See CLOUD_ESCALATION.md. Default posture: everything local, MockProvider
fallback, every optional capability behind an off-by-default flag that fails
gracefully.
