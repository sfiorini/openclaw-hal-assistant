# Environment Variables

All runtime configuration is loaded from environment variables or `.env` via Next.js.

## Required

- `ELEVENLABS_API_KEY`: ElevenLabs API key for STT/TTS calls.
- `ELEVENLABS_VOICE_ID`: Voice ID used by ElevenLabs TTS.
- `OPENCLAW_GATEWAY_URL`: Base URL of the OpenClaw REST gateway (example: `https://api.example.com`). This must be the HTTP(S) API base, not a WebSocket URL.
- `OPENCLAW_GATEWAY_TOKEN`: Bearer token for OpenClaw APIs.
- `OPENCLAW_AGENT_ID` can be a model/agent identifier.

## Optional

- `OPENCLAW_AGENT_ID` (default `main`): model/agent identifier sent to OpenClaw.
- `OPENCLAW_API_DOCS_ENABLED` (default `false`): enable `/api/docs` and `/api/openapi`.
- `OPENCLAW_API_DOCS_TOKEN`: optional token required as header `x-api-docs-token` when docs are enabled.
- `OPENCLAW_API_KEY`: optional key for best-effort API validation on main routes.
- `OPENCLAW_RATE_LIMIT` (default `60`): requests/minute per IP.
- `LOG_LEVEL` (default `info`): logger level (`error`, `warn`, `info`, `debug`).
- `OPENCLAW_CHAT_REQUEST_TIMEOUT_MS` (default `120000`): timeout in ms for OpenClaw chat completion calls.

## Async chat behavior

- `POST /api/chat` returns `202` and a `jobId`.
- Clients should poll `GET /api/chat/jobs/{jobId}` until terminal state.

## Using `.env`

Copy and edit:

```bash
cp .env.example .env
```

`verify:env` loads `.env` (if present) and validates required variables before build/start.
