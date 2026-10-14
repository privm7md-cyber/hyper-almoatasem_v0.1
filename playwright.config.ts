import { defineConfig, devices } from "@playwright/test";

// FE-1 smoke only: read-only GETs against a dev server the runner starts itself.
// Browser comes from the installed Chrome (no downloaded browsers committed/required).
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  use: {
    ...devices["Desktop Chrome"],
    channel: "chrome",
    baseURL: "http://localhost:3141",
  },
  webServer: {
    command: "npx next dev -p 3141",
    url: "http://localhost:3141/prototype",
    reuseExistingServer: true,
    timeout: 180000,
  },
});
