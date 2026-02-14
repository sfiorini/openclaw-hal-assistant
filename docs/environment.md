# Environment Variables

All runtime configuration is loaded from environment variables or `.env` via Next.js.

## Required

- `ELEVENLABS_API_KEY`: ElevenLabs API key for STT/TTS calls.
- `ELEVENLABS_VOICE_ID`: Voice ID used by ElevenLabs TTS.
- `OPENCLAW_GATEWAY_URL`: Base URL of OpenClaw gateway (example: `https://api.example.com`).
- `OPENCLAW_GATEWAY_TOKEN`: Bearer token for OpenClaw APIs.

## Optional

- `OPENCLAW_AGENT_ID` (default `main`): model/agent identifier sent to OpenClaw.
- `OPENCLAW_API_DOCS_ENABLED` (default `false`): enable `/api/docs` and `/api/openapi`.
- `OPENCLAW_API_DOCS_TOKEN`: optional token required as header `x-api-docs-token` when docs are enabled.
- `OPENCLAW_API_KEY`: optional key for best-effort API validation on main routes.
- `OPENCLAW_RATE_LIMIT` (default `60`): requests/minute per IP.
- `LOG_LEVEL` (default `info`): logger level (`error`, `warn`, `info`, `debug`).

## Using `.env`

Copy and edit:

```bash
cp .env.example .env
```

`verify:env` validates required variables before build/start.
