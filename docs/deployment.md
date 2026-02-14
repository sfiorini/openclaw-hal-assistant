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

Compose mode:

```bash
pnpm docker:up
pnpm docker:down
pnpm docker:logs
```

The compose stack maps `3000:3000`, uses `.env`, and includes a container health check on `/api/health/live`.
