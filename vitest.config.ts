import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["tests/**/*.{test,spec}.{ts,tsx}"],
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    mockReset: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}", "hooks/**/*.{ts,tsx}"],
      exclude: ["node_modules", "tests/**"],
    },
  },
})
