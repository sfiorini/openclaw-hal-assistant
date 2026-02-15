import { beforeEach, describe, expect, it } from "vitest"

import {
  __resetChatJobsForTests,
  __runCleanupForTests,
  __setJobExpirationForTesting,
  cancelChatJob,
  createChatJob,
  getChatJobById,
  listChatJobs,
  markChatJobFinalized,
  readChatJobForPolling,
} from "../../lib/chat/jobs"

describe("Chat job repository", () => {
  beforeEach(() => {
    __resetChatJobsForTests()
  })

  it("creates queued jobs and deduplicates by idempotency key", () => {
    const first = createChatJob({
      message: "Hello",
      conversationHistory: [],
      idempotencyKey: "same-key",
    })
    const second = createChatJob({
      message: "Hello",
      conversationHistory: [],
      idempotencyKey: "same-key",
    })

    expect(second.id).toBe(first.id)
  })

  it("records polling attempts and preserves terminal state", () => {
    const created = createChatJob({
      message: "Hello",
      conversationHistory: [],
    })

    const firstPoll = readChatJobForPolling(created.id)
    expect(firstPoll?.status).toBe("queued")
    expect(firstPoll?.attemptCount).toBe(1)

    const completed = markChatJobFinalized(created.id, "completed", {
      response: { text: "done", conversationHistory: [{ role: "assistant", content: "done" }] },
    })
    expect(completed?.status).toBe("completed")

    const after = readChatJobForPolling(created.id)
    expect(after?.status).toBe("completed")
    expect(after?.pollAfterMs).toBe(0)

    const terminalAttempt = readChatJobForPolling(created.id)
    expect(terminalAttempt?.attemptCount).toBe(after?.attemptCount)
  })

  it("supports cancellation", () => {
    const created = createChatJob({
      message: "cancel",
      conversationHistory: [],
    })

    const cancelled = cancelChatJob(created.id)
    expect(cancelled?.status).toBe("cancelled")
    expect(cancelled?.error?.code).toBe("cancelled")
  })

  it("cleans up expired jobs", () => {
    const created = createChatJob({
      message: "stale",
      conversationHistory: [],
    })

    __setJobExpirationForTesting(created.id, new Date(Date.now() - 1000).toISOString())
    __runCleanupForTests()

    const missing = getChatJobById(created.id)
    expect(missing).toBeUndefined()
  })

  it("returns jobs for debug listing", () => {
    createChatJob({ message: "one", conversationHistory: [] })
    createChatJob({ message: "two", conversationHistory: [] })

    const listed = listChatJobs(10)
    expect(listed.length).toBeGreaterThanOrEqual(2)
  })
})
