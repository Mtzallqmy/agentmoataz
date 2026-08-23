# TOOL_PROTOCOL.md

## Tool definition

```ts
interface Tool<I, O> {
  name: string;
  description: string;
  permissionCategory: PermissionCategory;
  inputSchema: z.ZodType<I>;     // validated before execution
  timeoutMs?: number;            // default 30s
  execute(input: I, ctx: ToolContext): Promise<O>;
}
```

## Flow (no bypasses)

```
MODEL -> VALIDATE -> CAPABILITY -> PERMISSION -> EXECUTE -> VALIDATE RESULT -> PERSIST -> EVENT
```

## Built-in tools (implemented)

- `write_file` (write_project_file)
- `read_file` / `list_tree` / `search_text` (read_project_file)
- `delete_file` (delete_file)

## Built-in tools (designed, next phases)

git_init/status/diff/log/add/commit/branch (git_local), git_fetch/pull/push
(git_push, ask-gated), http_get/http_request/download_file, run_javascript,
run_python, run_wasm, sandbox_create/upload/exec/download/stop, MCP adapters.

## Events

Every state change emits a typed `AgentEvent` (see agent-protocol):
`tool_requested → tool_started → tool_completed | tool_failed`, plus
`approval_requested/resolved`, step/run lifecycle events. Payloads include
`toolCallId`, `attempt`, and `retriesOf` on linked retry attempts.

## Errors

`StructuredError = { code, category, message, recoverable, retryable,
taskId?, stepId?, toolCallId?, technicalCause? }` with codes such as
CAPABILITY_UNAVAILABLE, PERMISSION_DENIED, WORKSPACE_ESCAPE_BLOCKED,
INVALID_TOOL_ARGUMENT, TOOL_TIMEOUT, TOOL_CANCELLED.
