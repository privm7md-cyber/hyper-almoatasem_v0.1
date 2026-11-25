import { defineConfig, devices } from "@playwright/test";

// Playwright run config for PHASE 09 (Cart Experience) e2e.
// Environment: the ISOLATED database hyper_almoatasem_p09 (created + documented
// in the run folder). The dev server on :3199 is started/owned by the run
// wrapper (Run…/_scratch/p09-run-e2e.mjs) which swaps DATABASE_URL in-process —
// this config only ATTACHES to it (the standalone command is a documented
// no-op that surfaces an honest failure when the server is missing).
export default defineConfig({
  testDir: "./e2e",
  // THIS phase's suite only — the shared e2e dir holds other phases' specs.
  testMatch: /phase09.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  use: {
    ...devices["Desktop Chrome"],
    channel: "chrome",
    baseURL: "http://localhost:3199",
  },
  outputDir: process.env.P09_RESULTS_DIR ?? "test-results",
  webServer: {
    command:
      'echo "P09: the :3199 server is managed by Run/_scratch/p09-run-e2e.mjs (isolated DB). Start it first." && exit 1',
    url: "http://localhost:3199/",
    reuseExistingServer: true,
    timeout: 120000,
  },
});
