# Skill: package-project

- purpose: Package a verified project into a checksummed source ZIP.
- triggers: ["export project", "package as zip", "create deliverable"]
- prerequisites:
  - project workspace exists
  - validation/verification step already completed
- steps:
  1. Run Reviewer over recent changes; abort if unverified.
  2. Generate README.md and PROJECT_REPORT.md if missing.
  3. Create checkpoint (reason: "before packaging").
  4. create_zip excluding .env, .agent/, .git/, node_modules/.
  5. Compute SHA-256 checksum and index Artifact (type: source_zip).
- allowed_tools: ["write_file", "read_file", "list_tree", "search_text"]
- validation: artifact checksum matches file on disk; zip contains README.md and PROJECT_REPORT.md and no excluded paths.
- recovery: on failure, restore checkpoint and report structured error.
