# STORAGE.md

## Local source of truth
SQLite on Android (expo-sqlite adapter; `MemoryStore`/store interfaces in core).
Planned tables: projects, sessions, messages, agent_runs, tasks, task_steps,
tool_calls, approvals, artifacts, checkpoints, memories, skills, providers,
capabilities, settings, audit_logs — with transactions, foreign keys, indexes
and schema versioning.

## Layout per project
```
projects/<id>/
├── workspace/            # agent file tools operate here (root-locked)
├── artifacts/
├── exports/
└── .agent/
    ├── project.json
    ├── checkpoints/<id>/ # file snapshot + manifest (sha256)
    ├── memory/
    └── logs/
```

## Rules
- Provider secrets live in secure storage, referenced by `secretRef`.
- ZIP exports exclude `.env`, `.agent/`, `.git/`, `node_modules`; SHA-256
  checksums recorded in artifact metadata.
- Checkpoints: list / inspect / restore / delete with retention policy;
  restore verified by round-trip test.
- Supabase sync (optional flag): encrypted backup of metadata/artifacts,
  RLS-enforced ownership; conflicts resolved explicitly; service-role keys
  never ship in the app.
