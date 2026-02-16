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
