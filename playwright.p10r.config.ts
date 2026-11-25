import { defineConfig, devices } from "@playwright/test";

// Phase-10 residual-closure e2e config.
// The app under test is a bridge copy of the repo booted by
// Residual_Closure_Run…/_scratch/p10r-run-all.mjs on :3209 with
// DATABASE_URL/MIGRATION_DATABASE_URL swapped to the ISOLATED database
// hyper_almoatasem_p10r (runtime-proven by the wrapper and again by the
// spec's current_database() gate). This config only ATTACHES to that server;
// running it standalone fails honestly.
export default defineConfig({
  testDir: "./e2e",
  testMatch: /phase10-residual\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    ...devices["Desktop Chrome"],
    channel: "chrome",
    baseURL: "http://localhost:3209",
    locale: "ar-EG",
  },
  outputDir: process.env.P10R_RESULTS_DIR ?? "test-results/p10r",
  webServer: {
    command:
      'echo "P10R: the :3209 server is managed by Residual_Closure_Run/_scratch/p10r-run-all.mjs (isolated DB). Start it first." && exit 1',
    url: "http://localhost:3209/",
    reuseExistingServer: true,
    timeout: 5_000,
  },
});
