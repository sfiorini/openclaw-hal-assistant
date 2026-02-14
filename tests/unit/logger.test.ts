import { describe, expect, it, vi } from "vitest"

import { createLogger } from "../../lib/middleware/logger"

describe("logger", () => {
  it("prints levels at/above threshold", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const logger = createLogger({ level: "warn" })

    logger.debug("invisible")
    logger.info("also invisible")
    logger.warn("visible warn")
    logger.error("visible error")

    expect(warnSpy).toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalled()
    expect(warnSpy.mock.calls[0][0]).toMatch(/\[WARN\]/)
    expect(errorSpy.mock.calls[0][0]).toMatch(/\[ERROR\]/)

    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it("suppresses logs below threshold", () => {
    const debugSpy = vi.spyOn(console, "log").mockImplementation(() => {})

    const logger = createLogger({ level: "error" })

    logger.debug("hidden")
    logger.info("hidden")

    expect(debugSpy).not.toHaveBeenCalled()

    debugSpy.mockRestore()
  })
})
