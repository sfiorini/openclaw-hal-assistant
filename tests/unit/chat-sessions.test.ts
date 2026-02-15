import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  __resetChatSessionsForTests,
  __runSessionCleanupForTests,
  __setSessionExpirationForTesting,
  appendToSessionConversation,
  getChatSession,
  getOrCreateSession,
  getSessionForJobLimitCheck,
  releaseSessionJobSlot,
  resetChatSession,
} from "../../lib/chat/sessions"

const DEFAULT_SESSION_ID = "f81c1f8a-9f7c-4e95-9e8c-cfd1f9b3c8f2"

describe("Chat sessions", () => {
  beforeEach(() => {
    __resetChatSessionsForTests()
  })

  afterEach(() => {
    __resetChatSessionsForTests()
  })

  it("creates and reuses sessions", async () => {
    const created = await getOrCreateSession(undefined, false, [
      { role: "user", content: "hi there" },
    ])

    const reused = await getOrCreateSession(created.id, false, [
      { role: "assistant", content: "should be ignored" },
    ])

    expect(reused.id).toBe(created.id)
    expect(reused.conversation).toEqual([{ role: "user", content: "hi there" }])
  })

  it("creates a new session when requested session is unknown", async () => {
    const created = await getOrCreateSession(DEFAULT_SESSION_ID, false, [{ role: "user", content: "new context" }])

    expect(created.id).not.toBe(DEFAULT_SESSION_ID)
    expect(created.conversation).toEqual([{ role: "user", content: "new context" }])
  })

  it("resets conversation when new session is requested", async () => {
    const original = await getOrCreateSession(undefined, false, [
      { role: "user", content: "first turn" },
    ])

    const continued = await getOrCreateSession(original.id, true, [{ role: "user", content: "ignored" }])
    expect(continued.id).not.toBe(original.id)
    expect(continued.conversation).toHaveLength(0)
  })

  it("resets conversation for existing session", async () => {
    const created = await getOrCreateSession(undefined, false, [{ role: "user", content: "first turn" }])
    const updated = await appendToSessionConversation(created.id, [
      { role: "assistant", content: "reply" },
      { role: "user", content: "next turn" },
    ])
    const reset = await resetChatSession(created.id)

    expect(updated.conversation).toHaveLength(3)
    expect(reset?.conversation).toHaveLength(0)
  })

  it("limits concurrent jobs per session", async () => {
    const created = await getOrCreateSession(undefined, false, [])
    await getSessionForJobLimitCheck(created.id)
    await expect(getSessionForJobLimitCheck(created.id)).rejects.toMatchObject({
      code: "concurrency_error",
    })

    await releaseSessionJobSlot(created.id)

    await expect(getSessionForJobLimitCheck(created.id)).resolves.toMatchObject({
      id: created.id,
    })
  })

  it("removes expired sessions during cleanup", async () => {
    const created = await getOrCreateSession(undefined, false, [])
    __setSessionExpirationForTesting(created.id, new Date(Date.now() - 1_000).toISOString())

    __runSessionCleanupForTests()

    expect(getChatSession(created.id)).toBeUndefined()
  })
})

