# package-project

Prepare a clean project artifact without secrets or caches.

## Steps
- Verify contents
- Exclude secrets/caches
- Create ZIP
- Record checksum

## Validation
- No .env, node_modules, .agent or .git data is exported
