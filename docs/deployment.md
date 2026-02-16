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
   - `${DOCKERHUB_USERNAME}/openclaw-hal-assistant:vX.Y.Z`
   - `${DOCKERHUB_USERNAME}/openclaw-hal-assistant:latest`

3. GitHub workflow controls:
   - Trigger: `release` event (published)
   - Manual trigger: `workflow_dispatch` with `release_tag` input
   - Required secrets:
     - `DOCKERHUB_USERNAME`
     - `DOCKERHUB_TOKEN`

Runtime variables are still supplied by compose or `--env-file`, never baked into images.

### Manual docker workflow

```bash
pnpm docker:build
pnpm docker:run
```

Notes:

- `pnpm docker:build` does not require `.env` at build time. Environment validation is intentionally not run during the image build; pass required variables at runtime (via `docker run --env-file .env` or compose).
- Docker context ignores `.env` via `.dockerignore` as a security default, so set runtime variables via `--env-file .env` (compose) or `docker run --env-file .env`.

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

### Release operations and rollback

Recommended release flow:

1. Merge your changes to `main`.
2. Run `pnpm release:<patch|minor|major>` locally.
3. Push commit and tag (`git push && git push --tags`) or use `--push`.
4. Create a GitHub release with the exact tag (for example `v1.2.3`).
5. CI validates and publishes Docker tags:
   - `${DOCKERHUB_USERNAME}/openclaw-hal-assistant:latest`
   - `${DOCKERHUB_USERNAME}/openclaw-hal-assistant:v1.2.3`

Rollback option:

- If a release is bad, republish the previous good version by rerunning the release command for that target version and creating a new release/tag.
- Docker tags are immutable by default in registries; keep the previous tag/published manifests for rollback planning.
