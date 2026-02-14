# OpenClaw HAL Assistant

OpenClaw HAL Assistant is a HAL 9000-inspired voice assistant API built with Next.js App Router. It exposes speech-to-text, text-to-speech, and chat endpoints backed by ElevenLabs and OpenClaw services.

## Presentation

- **Persona**: conversational assistant with HAL 9000 style responses
- **Runtime**: Next.js server with route handlers in `app/api/*`
- **Dependencies**: ElevenLabs (STT/TTS), OpenClaw chat gateway
- **Deployment**: Container-ready with standalone server output and Docker stack

## Quick Start

1. Install dependencies

```bash
pnpm install
```

2. Create environment file

```bash
cp .env.example .env
```

3. Fill required variables in `.env`:

- `ELEVENLABS_API_KEY`
- `ELEVENLABS_VOICE_ID`
- `OPENCLAW_GATEWAY_URL`
- `OPENCLAW_GATEWAY_TOKEN`

4. Start the app

```bash
pnpm dev
```

5. Call endpoints (examples)

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello HAL"}'
```

```bash
curl -X POST http://localhost:3000/api/tts \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello from HAL"}' \
  --output response.mp3
```

## Documentation

- [Environment Variables](./docs/environment.md)
- [API Reference](./docs/api.md)
- [Deployment](./docs/deployment.md)
- [Testing](./docs/testing.md)
- [Review and Gaps](./docs/review-and-gaps.md)

## OpenAPI and docs UI

- `/api/openapi` serves generated OpenAPI JSON (writes to `public/openapi.json`)
- `/api/docs` serves Swagger UI when docs are enabled via `OPENCLAW_API_DOCS_ENABLED`

## Available Scripts

- `pnpm dev` – run development server
- `pnpm build` – build Next.js app (prebuild verifies env)
- `pnpm start` – run production server
- `pnpm test` – run unit/integration tests
- `pnpm test:e2e` – run Playwright E2E (if configured)
- `pnpm gen:openapi` – generate OpenAPI spec
- `pnpm docker:build` – build container image
- `pnpm docker:run` – run single container with `.env`
- `pnpm docker:up` / `pnpm docker:down` – compose control
