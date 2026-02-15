import { expect, test } from "@playwright/test"

import { installBrowserApiMocks } from "./fixtures"

test.describe("voice flow", () => {
  test("cycles through recording, processing, speaking, and ready states", async ({ page }) => {
    await installBrowserApiMocks(page, {
      sttText: "Tell me a status update",
      chatText: "HAL is fully operational.",
      audioHex: "49443303",
    })

    await page.goto("/")
    const eyeButton = page.getByRole("button", { name: /start recording/i })
    const speakingState = page.getByText("SPEAKING")
    const processingState = page.getByText("PROCESSING")
    const waitingState = page.getByText("WAITING", { exact: true })
    const readyState = page.getByText("READY")
    const recordingState = page.getByText("RECORDING")

    await expect(readyState).toBeVisible()
    await eyeButton.click()
    await expect(recordingState).toBeVisible()

    const stopButton = page.getByRole("button", { name: /stop recording/i })
    await stopButton.click()

    await expect(processingState).toBeVisible()
    await expect(waitingState).toBeVisible({ timeout: 5000 })
    await expect(speakingState).toBeVisible({ timeout: 5000 })
    await expect(readyState).toBeVisible({ timeout: 5000 })
    await expect(page.getByText("You said:")).toBeVisible()
    await expect(page.getByText("HAL 9000:")).toBeVisible()
    await expect(page.getByText("HAL is fully operational.")).toBeVisible()
  })
})
