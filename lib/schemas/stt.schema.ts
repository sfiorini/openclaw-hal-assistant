import "./openapi"
import { z } from "zod"

export const sttResponseSchema = z
  .object({
    text: z.string().openapi({
      description: "Transcribed text from uploaded speech audio",
      example: "Hello, world.",
    }),
  })
  .openapi({
    title: "STTResponse",
    description: "Response payload from the STT endpoint.",
  })

export const sttRequestSchema = z
  .object({
    audio: z
      .any()
      .refine((value) => value !== undefined && value !== null, {
        message: "audio is required",
      })
      .openapi({
        description: "Audio file uploaded as multipart/form-data field 'audio'.",
      }),
  })
  .openapi({
    title: "STTRequest",
    description: "Payload for speech-to-text conversion.",
  })
