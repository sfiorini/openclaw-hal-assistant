# API Reference

## Base URL

`http://localhost:3000`

## UI behavior note

- Transcript/response display is a frontend behavior controlled by `OPENCLAW_TEXT_TRANSLATIONS_ENABLED`.
- This flag does not change API request/response contracts.

## Cross-Origin and auth behavior

- CORS headers are applied for API routes.
- `x-api-key` is optional:
  - absent: request is accepted (compatibility mode)
  - present: must match `OPENCLAW_API_KEY` when configured

## Endpoints

### Health

- `GET /api/health/live`
  - Returns `{ status: "ok", timestamp }`.

- `GET /api/health/startup`
  - Checks ElevenLabs (`GET /v1/user`) and OpenClaw gateway availability (`ws://`/`wss://` handshake with HTTP `/v1/models` fallback).
  - Returns `200` when healthy.
  - Returns `503` when any dependency is unhealthy.

### STT

- `POST /api/stt`
  - Multipart request: field `audio`
  - Success: `200` `{ "text": "..." }`
  - Errors: `400`, `502`, `429`, `500`

### TTS

- `POST /api/tts`
  - JSON request: `{ "text": string }`
  - Limit: max 5000 characters
  - Success: `200` binary `audio/mpeg`
  - Errors: `400`, `502`, `429`, `500`

### Chat

- Legacy async polling (`/api/chat/jobs/*`) is no longer supported.
- `/api/chat` is now synchronous only.

- `POST /api/chat`
  - JSON request:
    - `message`: string (1-4000 chars)
    - `sessionId` (optional, UUID) to continue an existing conversation
    - `newSession` (optional, default `false`) starts a new session
    - `conversationHistory` (optional, max 20 messages) used when `sessionId` is not valid/unknown
      - ignored when the session can be resolved server-side
  - Session precedence:
    - if `newSession=true` or message starts with `/new` or `/reset`: create a fresh session
    - else if request `sessionId` is provided: reuse that session
    - else if `OPENCLAW_SESSION_ID` is configured: reuse that configured session
    - else: create a generated session
  - Success: `200` with synchronous response
    - `text`: assistant text
    - `sessionId`: UUID associated with this conversation context
    - `conversationHistory`: resolved conversation history after this turn
  - Commands:
    - `"/new <message>"` starts a new session and strips the command
    - `"/reset"` starts a new empty session (with any remainder text removed)
    - `/NEW` and `/RESET` are treated as normal text (case-sensitive)
  - Errors: `400`, `401`, `429`, `502`, `503`, `504`
    - `400` includes `code: "invalid_message"` when normalized user message is empty.

### OpenAPI/docs

- `GET /api/openapi`
  - Returns generated OpenAPI JSON when docs are enabled.
- `GET /api/docs`
  - Serves Swagger UI for `/api/openapi` when docs are enabled.
  - Returns `404` when docs are disabled.
