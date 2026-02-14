import { describe, expect, it } from "vitest"

import {
  chatMessageSchema,
  chatRequestSchema,
  chatResponseSchema,
} from "../../lib/schemas/chat.schema"
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
})
