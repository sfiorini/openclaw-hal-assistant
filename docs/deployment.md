# Deployment

## Local development

```bash
pnpm install
pnpm dev
```

## Docker

Use provided scripts:

- `pnpm docker:build`
- `pnpm docker:run`
- `pnpm docker:up`
- `pnpm docker:down`
- `pnpm docker:logs`

## Release

### Local release commands

- `pnpm release:patch` → bumps patch and creates `vX.Y.Z` commit/tag
- `pnpm release:minor` → bumps minor and creates `vX.Y.Z` commit/tag
- `pnpm release:version <x.y.z>` → sets an explicit version
- `pnpm release:major` → bumps major and creates `vX.Y.Z` commit/tag
- Add `--push` to push commit and tags (for example: `pnpm release:patch -- --push`)

### GitHub release workflow

Use GitHub Releases with semantic tags (`vX.Y.Z`) to trigger Docker publishing.

The release workflow:

1. Runs validation (`tests/unit`, `tests/integration`, `tsc`, production build).
2. Builds and pushes Docker images to Docker Hub as:
   - `${{ secrets.DOCKERHUB_USERNAME }}/openclaw-hal-assistant:vX.Y.Z`
   - `${{ secrets.DOCKERHUB_USERNAME }}/openclaw-hal-assistant:latest`

Runtime variables are still supplied by compose or `--env-file`, never baked into images.

### Manual docker workflow

```bash
pnpm docker:build
pnpm docker:run
```

Notes:

- `pnpm docker:build` does not require `.env` at build time. Environment validation is intentionally not run during the image build; pass required variables at runtime (via `docker run --env-file .env` or compose).
- Docker context ignores `.env` via `.dockerignore` as a security default, so set runtime variables via `--env-file .env` (compose) or `docker run --env-file .env`.

When using async chat:

- First API call after startup should handle `202` + `jobId` and poll `/api/chat/jobs/{jobId}`.
- Keep `OPENCLAW_GATEWAY_URL` available before calling chat jobs if your container image pre-validates env during startup.

Compose mode:

```bash
pnpm docker:up
pnpm docker:down
pnpm docker:logs
```

The compose stack maps `3000:3000`, uses `.env`, and includes a container health check on `/api/health/live`.

Run order in compose:

1. Define all required values in `.env` (or export in your shell).
2. Start the stack with `pnpm docker:up`.
3. Validate `docker compose logs -f app` and `/api/health/live`.
