# API Reference

## Base URL

`http://localhost:3000`

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
  - Checks ElevenLabs (`GET /v1/user`) and OpenClaw (`GET /v1/models`).
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

- `POST /api/chat`
  - JSON request:
    - `message`: string (1-4000 chars)
    - `sessionId` (optional, UUID) to continue an existing conversation
    - `newSession` (optional, default `false`) starts a new session
    - `conversationHistory` (optional, max 20 messages) used when `sessionId` is not valid/unknown
      - ignored when the session can be resolved server-side
  - Success: `200` with synchronous response
    - `text`: assistant text
    - `sessionId`: UUID associated with this conversation context
    - `conversationHistory`: resolved conversation history after this turn
  - Commands:
    - `"/new <message>"` starts a new session and strips the command
    - `"/reset"` starts a new empty session (with any remainder text removed)
    - `/NEW` and `/RESET` are treated as normal text (case-sensitive)

### OpenAPI/docs

- `GET /api/openapi`
  - Returns generated OpenAPI JSON when docs are enabled.
- `GET /api/docs`
  - Serves Swagger UI for `/api/openapi` when docs are enabled.
  - Returns `404` when docs are disabled.
