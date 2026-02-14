import "./openapi"
import { z } from "zod"

export const ttsRequestSchema = z
  .object({
    text: z
      .string({
        required_error: "text is required",
        invalid_type_error: "text must be a string",
      })
      .trim()
      .min(1, "text must not be empty")
      .max(5000, "text must not exceed 5000 characters")
      .openapi({
        description: "Plaintext to convert into speech.",
        example: "How are you feeling today?",
      }),
  })
  .openapi({
    title: "TTSRequest",
    description: "Payload for text-to-speech conversion.",
  })

export const ttsResponseSchema = z
  .object({
    audio: z
      .string({
        required_error: "audio response metadata required",
      })
      .openapi({
        description: "Base64-encoded MP3 audio data.",
      }),
  })
  .openapi({
    title: "TTSResponse",
    description: "Response payload for text-to-speech conversion.",
  })
