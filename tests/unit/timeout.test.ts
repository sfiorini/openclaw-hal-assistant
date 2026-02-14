import { describe, expect, it } from "vitest"

import { isTimeoutError, withTimeout } from "../../lib/middleware/timeout"

describe("timeout helper", () => {
  it("resolves within timeout", async () => {
    const result = await withTimeout((signal) => {
      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => resolve("ok"), 20)
        signal.addEventListener("abort", () => {
          clearTimeout(timer)
          reject(signal.reason)
        })
      })
    }, 100)

    expect(result).toBe("ok")
  })

  it("rejects with timeout error", async () => {
    await expect(
      withTimeout(() => {
        return new Promise<string>((resolve) => {
          setTimeout(() => resolve("late"), 1000)
        })
      }, 30)
    ).rejects.toThrow("Operation timed out after 30ms")

    let timeoutError: unknown
    try {
      await withTimeout(() => {
        return new Promise<string>((resolve) => {
          setTimeout(() => resolve("late"), 1000)
        })
      }, 30)
    } catch (error) {
      timeoutError = error
    }

    expect(isTimeoutError(timeoutError)).toBe(true)
  })
})
