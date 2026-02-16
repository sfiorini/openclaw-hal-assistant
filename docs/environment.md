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
- `OPENCLAW_APP_NAME` (default `openclaw-hal-assistant`): logical app name used in session key generation.
- `OPENCLAW_GATEWAY_USERNAME` (default `default-user`): logical user handle used in session key generation.
- `OPENCLAW_SESSION_ID` (optional): pre-existing/explicit session UUID for deterministic session continuity across restarts and devices.
- `OPENCLAW_DEFAULT_AGENT_MODEL` (optional): when provided, `/new <model>` bootstrap is auto-prefixed to first message of each new session.
- `OPENCLAW_WAKE_WORD_ENABLED` (default `true`): enables voice wake-word path.
- `OPENCLAW_WAKE_WORD` (default `hey luke`): wake phrase used by the frontend.
- `OPENCLAW_GATEWAY_TIMEOUT_MS` (default `120000`): timeout in ms for Gateway protocol calls.
- `OPENCLAW_GATEWAY_MAX_RETRY_ATTEMPTS` (default `3`): max retry attempts for recoverable Gateway socket failures.

## Chat behavior

- `POST /api/chat` returns a direct `200` completion payload:
  - `text`
  - `sessionId`
  - `conversationHistory`
- `sessionId` is returned by `/api/chat` and reused by the frontend across page reloads (stored in localStorage).

## Using `.env`

Copy and edit:

```bash
cp .env.example .env
```

`verify:env` loads `.env` (if present) and validates required variables before build/start.
