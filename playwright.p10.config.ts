import { defineConfig, devices } from "@playwright/test";

// Phase 10 (Checkout & Customer Identity) e2e config.
// The app under test is a bridge copy of the repo booted by
// Run…/_scratch/p10-run-e2e.mjs on :3199 with DATABASE_URL/MIGRATION_DATABASE_URL
// swapped to the ISOLATED database hyper_almoatasem_p10 (runtime-proven by the
// wrapper and again by the spec's current_database() gate). This config only
// ATTACHES to that server; running it standalone fails honestly.
export default defineConfig({
  testDir: "./e2e",
  testMatch: /phase10-checkout\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    ...devices["Desktop Chrome"],
    channel: "chrome",
    baseURL: "http://localhost:3199",
    locale: "ar-EG",
  },
  outputDir: process.env.P10_RESULTS_DIR ?? "test-results/p10",
  webServer: {
    command:
      'echo "P10: the :3199 server is managed by Run/_scratch/p10-run-e2e.mjs (isolated DB). Start it first." && exit 1',
    url: "http://localhost:3199/",
    reuseExistingServer: true,
    timeout: 120000,
  },
});
