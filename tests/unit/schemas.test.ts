import { describe, expect, it } from "vitest"

import {
  chatMessageSchema,
  chatRequestSchema,
  chatJobSubmissionResponseSchema,
  chatJobCompletedSchema,
  chatJobStatusSchema,
  chatResponseSchema,
} from "../../lib/schemas/chat.schema"
import { parseChatSessionCommand } from "../../lib/chat/schemas/session.schema"
import { sttRequestSchema, sttResponseSchema } from "../../lib/schemas/stt.schema"
import {
  ttsRequestSchema,
  ttsResponseSchema,
} from "../../lib/schemas/tts.schema"

describe("schema validations", () => {
  it("rejects TTS payloads longer than 5000 chars", () => {
    const text = "a".repeat(5001)
    expect(() => ttsRequestSchema.parse({ text })).toThrow()
  })

  it("accepts TTS payloads at exactly 5000 chars", () => {
    const text = "a".repeat(5000)
    expect(ttsRequestSchema.parse({ text })).toEqual({ text })
  })

  it("parses valid TTS request payload", () => {
    expect(ttsRequestSchema.parse({ text: "short text" })).toEqual({
      text: "short text",
    })
  })

  it("validates required TTS response audio field", () => {
    expect(ttsResponseSchema.parse({ audio: "base64-audio" })).toEqual({
      audio: "base64-audio",
    })
    expect(() => ttsResponseSchema.parse({})).toThrow()
  })

  it("rejects chat messages longer than 4000 chars", () => {
    expect(() =>
      chatRequestSchema.parse({
        message: "a".repeat(4001),
        conversationHistory: [],
      })
    ).toThrow()
  })

  it("rejects chat history with more than 20 messages", () => {
    expect(() =>
      chatRequestSchema.parse({
        message: "hello",
        conversationHistory: Array.from({ length: 21 }).map((_) => ({
          role: "user",
          content: "x",
        })),
      })
    ).toThrow()
  })

  it("accepts only user or assistant roles", () => {
    expect(
      chatMessageSchema.parse({
        role: "assistant",
        content: "all good",
      })
    ).toEqual({
      role: "assistant",
      content: "all good",
    })

    expect(() =>
      chatMessageSchema.parse({
        role: "system",
        content: "invalid",
      })
    ).toThrow()
  })

  it("parses valid chat request and response payloads", () => {
    const chat = chatRequestSchema.parse({
      message: "Hello",
      conversationHistory: [{ role: "user", content: "Before" }],
    })
    expect(chat.conversationHistory).toEqual([{ role: "user", content: "Before" }])

    const response = chatResponseSchema.parse({
      text: "Hi there",
      conversationHistory: [
        { role: "assistant", content: "Hi there" },
      ],
    })
    expect(response.text).toBe("Hi there")
  })

  it("validates STT schema structure", () => {
    expect(sttResponseSchema.parse({ text: "done" })).toEqual({ text: "done" })
    expect(() => sttRequestSchema.parse({})).toThrow()
    expect(() => sttRequestSchema.parse({ audio: null })).toThrow()
  })

  it("validates chat job submission response", () => {
    const payload = {
      sessionId: "f81c1f8a-9f7c-4e95-9e8c-cfd1f9b3c8f2",
      jobId: "f81c1f8a-9f7c-4e95-9e8c-cfd1f9b3c8f2",
      status: "queued",
      pollAfterMs: 500,
      maxPollAttempts: 240,
      maxWaitMs: 240000,
    }

    expect(chatJobSubmissionResponseSchema.parse(payload)).toEqual(payload)
  })

  it("validates chat job terminal status schema", () => {
    const payload = {
      sessionId: "f81c1f8a-9f7c-4e95-9e8c-cfd1f9b3c8f2",
      jobId: "f81c1f8a-9f7c-4e95-9e8c-cfd1f9b3c8f2",
      status: "completed",
      pollAfterMs: 0,
      attemptCount: 1,
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      response: {
        text: "ok",
        conversationHistory: [{ role: "assistant", content: "hi" }],
      },
    }

    expect(chatJobCompletedSchema.parse(payload).jobId).toBe(payload.jobId)
    expect(chatJobCompletedSchema.parse(payload).status).toBe("completed")
  })

  it("validates chat job status union schema", () => {
    const queued = chatJobStatusSchema.parse({
      sessionId: "f81c1f8a-9f7c-4e95-9e8c-cfd1f9b3c8f2",
      jobId: "f81c1f8a-9f7c-4e95-9e8c-cfd1f9b3c8f2",
      status: "queued",
      pollAfterMs: 500,
      attemptCount: 0,
      createdAt: new Date().toISOString(),
    })

    expect(["queued", "running", "completed", "failed", "cancelled"]).toContain(queued.status)

    const failed = chatJobStatusSchema.parse({
      sessionId: "f81c1f8a-9f7c-4e95-9e8c-cfd1f9b3c8f2",
      jobId: "f81c1f8a-9f7c-4e95-9e8c-cfd1f9b3c8f2",
      status: "failed",
      pollAfterMs: 0,
      attemptCount: 2,
      createdAt: new Date().toISOString(),
      error: {
        code: "upstream_error",
        message: "OpenClaw request failed",
      },
    })

    expect(failed.status).toBe("failed")
  })

  it("parses session reset command syntax", () => {
    const newMessage = parseChatSessionCommand("/new hello HAL")
    expect(newMessage.newSession).toBe(true)
    expect(newMessage.command).toBe("/new")
    expect(newMessage.message).toBe("hello HAL")

    const resetMessage = parseChatSessionCommand("  /reset  ")
    expect(resetMessage.newSession).toBe(true)
    expect(resetMessage.message).toBe("")

    const unknownCase = parseChatSessionCommand("/NEW hello")
    expect(unknownCase.newSession).toBe(false)
    expect(unknownCase.message).toBe("/NEW hello")
  })
})
