# Review and Gaps

## Reviewed Scope

- Legacy async `/api/chat/jobs` migration items from earlier milestones are completed.
- Remaining deferred items:
  - CI/CD pipeline
  - monitoring/metrics endpoint

## Notable implementation notes

- Auth is currently optional for backwards compatibility with existing UI callers.
- OpenAPI is statically generated to `public/openapi.json` via `pnpm gen:openapi`.
