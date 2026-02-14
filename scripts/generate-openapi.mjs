import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

const resolveSpec = () => ({
  openapi: "3.0.0",
  info: {
    title: "OpenClaw HAL Assistant API",
    version: "1.0.0",
    description: "HAL 9000-style voice assistant and health endpoints.",
  },
  paths: {
    "/api/chat": {
      post: {
        summary: "Send a chat message to HAL and receive assistant response",
        tags: ["Chat"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ChatRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Successful chat reply",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ChatResponse" },
              },
            },
          },
          "400": { description: "Validation failed" },
          "401": { description: "Invalid API key" },
          "429": { description: "Rate limit exceeded" },
          "502": { description: "Chat upstream unavailable" },
          "500": { description: "Internal server error" },
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
                    status: {
                      type: "string",
                      enum: ["ok"],
                    },
                    timestamp: {
                      type: "string",
                      format: "date-time",
                    },
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
          "503": {
            description: "One or more dependencies are unhealthy",
          },
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
          content: { type: "string" },
        },
      },
      ChatRequest: {
        type: "object",
        required: ["message"],
        properties: {
          message: {
            type: "string",
            maxLength: 4000,
          },
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
