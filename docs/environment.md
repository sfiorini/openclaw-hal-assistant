# Environment Variables

All runtime configuration is loaded from environment variables or `.env` via Next.js.

## Required

- `ELEVENLABS_API_KEY`: ElevenLabs API key for STT/TTS calls.
- `ELEVENLABS_VOICE_ID`: Voice ID used by ElevenLabs TTS.
- `OPENCLAW_GATEWAY_URL`: Base URL of the OpenClaw Gateway WebSocket endpoint (example: `ws://liberty:18789`). This must be `ws://` or `wss://` (optional `/v1` suffix is supported and stripped automatically).
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
- `OPENCLAW_WAKE_WORD_ACCESS_KEY` (required for wake functionality): Picovoice AccessKey used by the browser wake engine.
- `OPENCLAW_WAKE_WORD_MODEL_PATH` (required for wake functionality, example `/porcupine_params.pv`): public path to Porcupine `.pv` model.
- `OPENCLAW_WAKE_WORD_KEYWORD_PATH` (optional): public path to custom Porcupine `.ppn` keyword model (required for non-built-in wake phrases such as `hey luke`).
- `OPENCLAW_WAKE_WORD_SENSITIVITY` (optional, `0..1`, default `0.6`): Porcupine wake sensitivity.
- `OPENCLAW_TEXT_TRANSLATIONS_ENABLED` (default `true`): controls transcript/response panel visibility feature in the UI.
- `OPENCLAW_GATEWAY_TIMEOUT_MS` (default `120000`): timeout in ms for Gateway protocol calls.
- `OPENCLAW_GATEWAY_MAX_RETRY_ATTEMPTS` (default `3`): max retry attempts for recoverable Gateway socket failures.

## Chat behavior

- `POST /api/chat` returns a direct `200` completion payload:
  - `text`
  - `sessionId`
  - `conversationHistory`
- `sessionId` is returned by `/api/chat` and reused by the frontend across page reloads (stored in localStorage).
- Session selection precedence:
  - `newSession=true` or `/new`/`/reset` command starts a fresh session.
  - Otherwise, request `sessionId` is used when present.
  - Otherwise, `OPENCLAW_SESSION_ID` is used when configured.
  - Otherwise, a generated UUID session is created.
- Wake-word mode is Porcupine-only.
- Porcupine wake requires:
  - Picovoice account and AccessKey (`OPENCLAW_WAKE_WORD_ACCESS_KEY`): https://console.picovoice.ai/
  - Porcupine model `.pv` (`OPENCLAW_WAKE_WORD_MODEL_PATH`)
  - custom keyword `.ppn` when using non-built-in wake phrases (`OPENCLAW_WAKE_WORD_KEYWORD_PATH`)
- If AccessKey/model path are missing, wake-word is disabled and manual mode remains active.
- Deprecated variable notice:
  - `OPENCLAW_WAKE_ENGINE` is ignored and should be removed from existing `.env` files.
- Picovoice free/developer usage details can change over time; check official pricing and terms:
  - https://picovoice.ai/pricing/
- In some browsers, wake-word listening/audio playback require one initial user interaction. Any first click/tap/key press now unlocks this automatically.
- Recording now auto-stops after silence (or max duration) for wake/manual flows.
- Translation panel behavior:
  - when `OPENCLAW_TEXT_TRANSLATIONS_ENABLED=true`, users can show/hide transcript/response panels via UI toggle (preference saved in localStorage)
  - when `OPENCLAW_TEXT_TRANSLATIONS_ENABLED=false`, transcript/response panels are never shown.

## Using `.env`

Copy and edit:

```bash
cp .env.example .env
```

`verify:env` loads `.env` (if present) and validates required variables before build/start.
