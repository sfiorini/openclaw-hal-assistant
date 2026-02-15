# Review and Gaps

## Reviewed Scope

- Async chat timeout migration items for `2024-02-15` are completed with follow-up verification in-progress.
- Remaining deferred items:
  - CI/CD pipeline
  - monitoring/metrics endpoint

## Notable implementation notes

- Auth is currently optional for backwards compatibility with existing UI callers.
- OpenAPI is statically generated to `public/openapi.json` via `pnpm gen:openapi`.
