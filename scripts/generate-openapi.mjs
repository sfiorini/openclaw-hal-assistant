import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

const resolveSpec = () => ({
  openapi: "3.0.0",
  info: {
    title: "OpenClaw HAL Assistant API",
    version: "1.0.0",
    description:
      "HAL 9000-style voice assistant and health endpoints with async chat job polling.",
  },
  paths: {
    "/api/chat": {
      post: {
        summary: "Submit a chat request and receive job metadata",
        tags: ["Chat"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ChatJobRequest" },
            },
          },
        },
        responses: {
          "202": {
            description: "Accepted and queued for asynchronous processing",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ChatJobSubmissionResponse" },
              },
            },
          },
          "400": { description: "Validation failed" },
          "401": { description: "Invalid API key" },
          "409": { description: "Idempotency conflict" },
          "429": { description: "Rate limit exceeded" },
          "500": { description: "Internal server error" },
          "503": { description: "Server has reached concurrent job capacity" },
        },
      },
    },
    "/api/chat/jobs/{jobId}": {
      get: {
        summary: "Get chat job status and terminal response",
        tags: ["Chat"],
        parameters: [
          {
            in: "path",
            name: "jobId",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "200": {
            description: "Chat job status",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ChatJobStatusResponse" },
              },
            },
          },
          "404": { description: "Job not found" },
        },
      },
      delete: {
        summary: "Cancel chat job while queued/running",
        tags: ["Chat"],
        parameters: [
          {
            in: "path",
            name: "jobId",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
        "200": {
            description: "Job cancelled",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/ChatJobBase" },
                    {
                      type: "object",
                      required: ["error"],
                      properties: {
                        error: { $ref: "#/components/schemas/ChatJobError" },
                      },
                    },
                  ],
                },
              },
            },
          },
          "404": { description: "Job not found" },
          "409": { description: "Terminal job cannot be cancelled" },
        },
      },
    },
    "/api/chat/jobs": {
      get: {
        summary: "Debug list of chat jobs (in-memory)",
        tags: ["Chat"],
        responses: {
          "200": {
            description: "Debug job list",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ChatJobListResponse" },
              },
            },
          },
          "401": { description: "Invalid API key" },
        },
      },
    },
    "/api/stt": {
      post: {
        summary: "Transcribe speech audio into text",
        tags: ["Speech"],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["audio"],
                properties: {
                  audio: {
                    type: "string",
                    format: "binary",
                    description: "Audio file in multipart form data field 'audio'.",
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Transcription returned",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/STTResponse" },
              },
            },
          },
          "400": { description: "Validation failed" },
          "401": { description: "Invalid API key" },
          "429": { description: "Rate limit exceeded" },
          "502": { description: "STT upstream unavailable" },
          "500": { description: "Internal server error" },
        },
      },
    },
    "/api/tts": {
      post: {
        summary: "Convert text to speech audio",
        tags: ["Speech"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/TTSRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Generated speech audio",
            content: {
              "audio/mpeg": {
                schema: {
                  type: "string",
                  format: "binary",
                },
              },
            },
          },
          "400": { description: "Validation failed" },
          "401": { description: "Invalid API key" },
          "429": { description: "Rate limit exceeded" },
          "502": { description: "TTS upstream unavailable" },
          "500": { description: "Internal server error" },
        },
      },
    },
    "/api/health/live": {
      get: {
        summary: "Liveness probe",
        tags: ["Health"],
        responses: {
          "200": {
            description: "Service is alive",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["status", "timestamp"],
                  properties: {
                    status: { type: "string", enum: ["ok"] },
                    timestamp: { type: "string", format: "date-time" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/health/startup": {
      get: {
        summary: "Startup readiness probe including dependency checks",
        tags: ["Health"],
        responses: {
          "200": {
            description: "All dependencies are healthy",
          },
          "503": { description: "One or more dependencies are unhealthy" },
        },
      },
    },
  },
  components: {
    schemas: {
      ChatMessage: {
        type: "object",
        required: ["role", "content"],
        properties: {
          role: { type: "string", enum: ["user", "assistant"] },
          content: { type: "string", maxLength: 4000 },
        },
      },
      ChatJobRequest: {
        type: "object",
        required: ["message"],
        properties: {
          message: { type: "string", maxLength: 4000 },
          conversationHistory: {
            type: "array",
            maxItems: 20,
            items: { $ref: "#/components/schemas/ChatMessage" },
          },
        },
      },
      ChatJobSubmissionResponse: {
        type: "object",
        required: ["jobId", "status", "pollAfterMs", "maxPollAttempts", "maxWaitMs"],
        properties: {
          jobId: { type: "string", format: "uuid" },
          status: { type: "string", enum: ["queued"] },
          pollAfterMs: { type: "integer", minimum: 0 },
          maxPollAttempts: { type: "integer", minimum: 1 },
          maxWaitMs: { type: "integer", minimum: 1 },
        },
      },
      ChatJobProgress: {
        type: "string",
        enum: [
          "accepted",
          "dispatching_to_openclaw",
          "waiting_for_upstream",
          "tool_execution",
          "finalizing",
          "awaiting_client_poll",
          "cancel_pending",
        ],
      },
      ChatJobBase: {
        type: "object",
        required: ["jobId", "status", "pollAfterMs", "createdAt"],
        properties: {
          jobId: { type: "string", format: "uuid" },
          status: {
            type: "string",
            enum: ["queued", "running", "completed", "failed", "cancelled"],
          },
          pollAfterMs: { type: "integer", minimum: 0 },
          progress: { $ref: "#/components/schemas/ChatJobProgress" },
          attemptCount: { type: "integer", minimum: 0 },
          createdAt: { type: "string", format: "date-time" },
          startedAt: { type: "string", format: "date-time" },
          finishedAt: { type: "string", format: "date-time" },
        },
      },
      ChatJobError: {
        type: "object",
        required: ["code", "message"],
        properties: {
          code: {
            type: "string",
            enum: [
              "validation_error",
              "idempotency_conflict",
              "upstream_error",
              "tool_error",
              "cancelled",
              "timeout",
              "concurrency_error",
              "server_error",
            ],
          },
          message: { type: "string" },
          details: { type: "object", additionalProperties: true },
        },
      },
      ChatJobResponse: {
        type: "object",
        required: ["text", "conversationHistory"],
        properties: {
          text: { type: "string" },
          conversationHistory: {
            type: "array",
            items: { $ref: "#/components/schemas/ChatMessage" },
          },
        },
      },
      ChatJobQueued: {
        allOf: [
          { $ref: "#/components/schemas/ChatJobBase" },
          {
            type: "object",
            required: ["status"],
            properties: {
              status: { type: "string", enum: ["queued"] },
            },
          },
        ],
      },
      ChatJobRunning: {
        allOf: [
          { $ref: "#/components/schemas/ChatJobBase" },
          {
            type: "object",
            required: ["status"],
            properties: {
              status: { type: "string", enum: ["running"] },
            },
          },
        ],
      },
      ChatJobCompleted: {
        allOf: [
          { $ref: "#/components/schemas/ChatJobBase" },
          {
            type: "object",
            required: ["status", "response"],
            properties: {
              status: { type: "string", enum: ["completed"] },
              response: { $ref: "#/components/schemas/ChatResponse" },
            },
          },
        ],
      },
      ChatJobFailed: {
        allOf: [
          { $ref: "#/components/schemas/ChatJobBase" },
          {
            type: "object",
            required: ["status", "error"],
            properties: {
              status: { type: "string", enum: ["failed"] },
              error: { $ref: "#/components/schemas/ChatJobError" },
            },
          },
        ],
      },
      ChatJobCancelled: {
        allOf: [
          { $ref: "#/components/schemas/ChatJobBase" },
          {
            type: "object",
            required: ["status", "error"],
            properties: {
              status: { type: "string", enum: ["cancelled"] },
              error: { $ref: "#/components/schemas/ChatJobError" },
            },
          },
        ],
      },
      ChatJobStatusResponse: {
        oneOf: [
          { $ref: "#/components/schemas/ChatJobQueued" },
          { $ref: "#/components/schemas/ChatJobRunning" },
          { $ref: "#/components/schemas/ChatJobCompleted" },
          { $ref: "#/components/schemas/ChatJobFailed" },
          { $ref: "#/components/schemas/ChatJobCancelled" },
        ],
      },
      ChatJobListResponse: {
        type: "object",
        required: ["jobs", "nextCursor"],
        properties: {
          jobs: {
            type: "array",
            items: {
              type: "object",
              required: ["jobId", "status", "createdAt"],
              properties: {
                jobId: { type: "string", format: "uuid" },
                status: {
                  type: "string",
                  enum: ["queued", "running", "completed", "failed", "cancelled"],
                },
                createdAt: { type: "string", format: "date-time" },
              },
            },
          },
          nextCursor: { type: "string", nullable: true },
        },
      },
      ChatRequest: {
        type: "object",
        required: ["message"],
        properties: {
          message: { type: "string", maxLength: 4000 },
          conversationHistory: {
            type: "array",
            maxItems: 20,
            items: { $ref: "#/components/schemas/ChatMessage" },
          },
        },
      },
      ChatResponse: {
        type: "object",
        required: ["text", "conversationHistory"],
        properties: {
          text: { type: "string" },
          conversationHistory: {
            type: "array",
            items: { $ref: "#/components/schemas/ChatMessage" },
          },
        },
      },
      TTSRequest: {
        type: "object",
        required: ["text"],
        properties: {
          text: {
            type: "string",
            maxLength: 5000,
            minLength: 1,
          },
        },
      },
      STTResponse: {
        type: "object",
        required: ["text"],
        properties: {
          text: { type: "string" },
        },
      },
    },
  },
})

const generateOpenApiSpec = async () => {
  const spec = resolveSpec()
  const outputPath = join(process.cwd(), "public", "openapi.json")

  await mkdir("public", { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(spec, null, 2)}\n`)
}

generateOpenApiSpec().catch((error) => {
  console.error(`Failed to generate OpenAPI spec: ${error.message}`)
  process.exit(1)
})
