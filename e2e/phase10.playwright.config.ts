// Phase-10 Playwright config: NO `webServer` on purpose.
//
// The repository's default Playwright config boots `next dev -p 3141`, which
// would use the DATABASE_URL from `.env` (the production target). The Phase-10
// browser tests must only ever touch the isolated scratch database, so this
// config attaches to an already-running scratch-backed server supplied through
// PHASE10_BASE_URL and never starts one.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./",
  testMatch: process.env.PHASE10_TEST_MATCH
    ? new RegExp(process.env.PHASE10_TEST_MATCH)
    : /phase10-(admin|remediation)\.spec\.ts/,
  timeout: 120000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { outputFolder: "test-results/phase10-admin", open: "never" }]],
  use: {
    baseURL: process.env.PHASE10_BASE_URL ?? "http://127.0.0.1:3131",
    ...devices["Desktop Chrome"],
    channel: "chrome",
  },
});
