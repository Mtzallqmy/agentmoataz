# CLOUD_ESCALATION.md

## Runs locally (always, offline-capable)
App startup, projects/workspaces, file tools, tasks/runs history, SQLite state,
approvals, checkpoints, memory, skills registry, artifacts + ZIP export,
MockProvider chat, agent loop orchestration.

Internet loss must never corrupt local work. The phone is the master controller.

## May escalate to cloud (explicit config + permission gate only)
| Workload | Service | Flag (default) |
|---|---|---|
| npm/pnpm/Bun installs & builds of generated projects | Vercel Sandbox | cloud_sandbox (off) |
| Python environments | Vercel Sandbox | local_python off / sandbox |
| Rust/C++ compilation for user-generated targets | Vercel Sandbox | cloud_sandbox (off) |
| Chromium/headless browsing automation | Cloud browser sandbox | cloud_browser (off) |
| ffmpeg-heavy media jobs | Vercel Sandbox | video_generation (off) |
| Remote MCP servers | MCP adapter | remote_mcp (off) |
| Encrypted backup/sync | Supabase | supabase_sync (off) |

## Rules
- Escalation is per-task, ephemeral, timeout/resource-limited and audit-logged.
- Source/state/checkpoints stay local; only explicit tool transfers leave.
- No permanent secrets in sandboxes; cleanup is mandatory.
- Every optional component must fail gracefully to a clear structured error
  (`CAPABILITY_UNAVAILABLE`, `SANDBOX_FAILED`, `NETWORK_UNAVAILABLE`).
