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
    - `conversationHistory` (optional, max 20 messages)
  - Success: `202` with async job descriptor
    - `jobId`: UUID
    - `status`: `"queued"`
    - `pollAfterMs`: minimum delay before first poll (ms)
    - `maxPollAttempts`: max polling attempts
    - `maxWaitMs`: max wall-clock wait for a response

- `GET /api/chat/jobs/{jobId}`
  - Polling endpoint for async completion.
  - States:
    - `queued` / `running` while in progress
    - `completed` includes `response.text` and `response.conversationHistory`
    - `failed` / `cancelled` include `error.code` + `error.message`
  - Always returns `pollAfterMs` guidance.

- `DELETE /api/chat/jobs/{jobId}`
  - Cancels queued/running jobs.
  - Returns `200` when cancelled (and for already-cancelled jobs),
    `409` when completed/failed, `404` when unknown.
  - Errors: `400`, `502`, `429`, `500`

### OpenAPI/docs

- `GET /api/openapi`
  - Returns generated OpenAPI JSON when docs are enabled.
- `GET /api/docs`
  - Serves Swagger UI for `/api/openapi` when docs are enabled.
  - Returns `404` when docs are disabled.
