import { describe, expect, it } from "vitest"

import nextConfig from "../../next.config.mjs"

describe("next.config", () => {
  it("sets standalone output for Docker deployment", () => {
    expect(nextConfig.output).toBe("standalone")
  })

  it("disables x-powered-by header", () => {
    expect(nextConfig.poweredByHeader).toBe(false)
  })

  it("does not ignore TypeScript errors", () => {
    expect(nextConfig.typescript).toBeUndefined()
  })
})
