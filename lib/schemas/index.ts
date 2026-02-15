import { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi"

import { chatRequestSchema, chatResponseSchema } from "./chat.schema"
import {
  chatJobCancelledSchema,
  chatJobCompletedSchema,
  chatJobFailedSchema,
  chatJobListSchema,
  chatJobRequestSchema,
  chatJobRunningSchema,
  chatJobSubmissionResponseSchema,
  chatJobQueuedSchema,
} from "./chat.schema"
import { sttRequestSchema, sttResponseSchema } from "./stt.schema"
import { ttsRequestSchema, ttsResponseSchema } from "./tts.schema"
export { isOpenApiBootstrapReady, z } from "./openapi"

export const registry = new OpenAPIRegistry()

registry.register("ChatRequest", chatRequestSchema)
registry.register("ChatResponse", chatResponseSchema)
registry.register("ChatJobRequest", chatJobRequestSchema)
registry.register("ChatJobSubmissionResponse", chatJobSubmissionResponseSchema)
registry.register("ChatJobQueued", chatJobQueuedSchema)
registry.register("ChatJobRunning", chatJobRunningSchema)
registry.register("ChatJobCompleted", chatJobCompletedSchema)
registry.register("ChatJobFailed", chatJobFailedSchema)
registry.register("ChatJobCancelled", chatJobCancelledSchema)
registry.register("ChatJobListResponse", chatJobListSchema)
registry.register("STTRequest", sttRequestSchema)
registry.register("STTResponse", sttResponseSchema)
registry.register("TTSRequest", ttsRequestSchema)
registry.register("TTSResponse", ttsResponseSchema)
