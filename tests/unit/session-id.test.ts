import { describe, expect, it, vi } from "vitest"

import { buildSessionIdentity } from "../../lib/chat/session-id"

describe("session identity", () => {
  it("builds deterministic key from app and user", () => {
    const spy = vi
      .spyOn(crypto, "randomUUID")
      .mockReturnValue("11111111-1111-4111-8111-111111111111")

    const identity = buildSessionIdentity({
      appName: "hal-app",
      username: "pilot",
    })

    expect(identity.sessionId).toBe("11111111-1111-4111-8111-111111111111")
    expect(identity.sessionKey).toBe(
      "app:hal-app:user:pilot:uuid:11111111-1111-4111-8111-111111111111"
    )
    spy.mockRestore()
  })
})
