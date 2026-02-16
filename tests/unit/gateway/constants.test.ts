import { describe, expect, it } from "vitest"

import { resolveGatewayReconnectDelayMs } from "../../../lib/openclaw/constants"

describe("gateway constants", () => {
  it("uses configured delay windows and caps at max backoff", () => {
    expect(resolveGatewayReconnectDelayMs(0, [500, 1_000, 2_000])).toBe(500)
    expect(resolveGatewayReconnectDelayMs(1, [500, 1_000, 2_000])).toBe(1_000)
    expect(resolveGatewayReconnectDelayMs(2, [500, 1_000, 2_000])).toBe(2_000)
    expect(resolveGatewayReconnectDelayMs(3, [500, 1_000, 2_000])).toBe(30_000)
  })
})
