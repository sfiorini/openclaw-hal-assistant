import { devices, defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm dev",
    env: {
      ...process.env,
      NODE_OPTIONS:
        `${process.env.NODE_OPTIONS ? `${process.env.NODE_OPTIONS} ` : ""}--require ./tests/e2e/fetch-mock.cjs`,
      OPENCLAW_GATEWAY_URL: "ws://gateway.example.com",
      OPENCLAW_GATEWAY_TOKEN: "gateway-token",
      OPENCLAW_SESSION_ID: "11111111-1111-4111-8111-111111111111",
      OPENCLAW_API_KEY: "",
      ELEVENLABS_API_KEY: "eleven-key",
      ELEVENLABS_VOICE_ID: "voice-id",
      OPENCLAW_RATE_LIMIT: "2",
      OPENCLAW_API_DOCS_ENABLED: "false",
    },
    url: "http://127.0.0.1:3000",
    // Always start a fresh test server so CI and local E2E runs use the same
    // env values defined below (including OPENCLAW_RATE_LIMIT=2).
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
