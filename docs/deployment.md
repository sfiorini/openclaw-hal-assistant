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
