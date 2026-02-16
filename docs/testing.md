# Testing

## Unit + Integration

```bash
pnpm test
```

## Coverage

```bash
pnpm test:coverage
```

## Playwright E2E

```bash
pnpm test:e2e
```

Prerequisite:
- Ensure port `3000` is free before running E2E because Playwright starts its own dev server.

## Build and verification

```bash
pnpm test:all
pnpm build
```

## Coverage expectations for current wake/UI behavior

- Wake-word flow is validated through Porcupine-focused unit tests.
- Manual recording fallback is validated when wake config is missing.
- Translation panel behavior is validated for:
  - env-enabled default visible state
  - show/hide toggle persistence
  - env-disabled forced hidden behavior.
