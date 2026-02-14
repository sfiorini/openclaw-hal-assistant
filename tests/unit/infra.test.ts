import { describe, expect, it } from "vitest"

describe("test infrastructure", () => {
  it("keeps arithmetic stable", () => {
    expect(1 + 1).toBe(2)
  })
})
