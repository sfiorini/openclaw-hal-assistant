import { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi"

import { chatRequestSchema, chatResponseSchema } from "./chat.schema"
import { sttRequestSchema, sttResponseSchema } from "./stt.schema"
import { ttsRequestSchema, ttsResponseSchema } from "./tts.schema"
export { isOpenApiBootstrapReady, z } from "./openapi"

export const registry = new OpenAPIRegistry()

registry.register("ChatRequest", chatRequestSchema)
registry.register("ChatResponse", chatResponseSchema)
registry.register("STTRequest", sttRequestSchema)
registry.register("STTResponse", sttResponseSchema)
registry.register("TTSRequest", ttsRequestSchema)
registry.register("TTSResponse", ttsResponseSchema)
