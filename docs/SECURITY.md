# SECURITY.md

## Threat model — treated as untrusted
Model output, website content, README files, source comments, downloaded
documents, MCP descriptions/results, cloud sandbox output.

Trust order: APPLICATION SECURITY POLICY > USER INTENT > PROJECT INSTRUCTIONS >
RETRIEVED CONTENT. External content can never override permissions, reveal
secrets, push Git, delete unrelated files or change security settings.

## Workspace isolation
- Every path resolves through `safeJoin(root, rel)`: absolute paths, drive
  prefixes and `..` segments are rejected (`WORKSPACE_ESCAPE_BLOCKED`).
- ZIP export excludes `.env`, `node_modules`, `.agent/`, `.git/`; ZIP extraction
  must guard against zip-slip (planned hardening for extract_zip).
- Per-file size limits (25 MB) prevent memory exhaustion.

## Secrets
- Stored only in Android secure storage (Keystore). Config carries `secretRef`.
- Never committed, never logged, never included in exports, never sent to the
  model unless a specific scoped tool requires it.

## Permission engine
Every tool call is validated → capability-checked → permission-gated →
executed. Denials are structured (`PERMISSION_DENIED`) and audit-logged with
tool-call correlation IDs. User-denied approvals are never auto-retried.

## Prompt-injection defense
Retrieved web/repo content is data, not instructions. A page saying "ignore
previous rules" has no authority over the permission engine.

## Structured errors
Errors carry code/category/message/recoverable/retryable + task/step/toolCall
correlation. Raw crashes are never surfaced as normal UX (ErrorBoundary in the
app; structured errors in the core).
