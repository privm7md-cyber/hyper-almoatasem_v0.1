import { defineConfig, devices } from "@playwright/test";

// Closure e2e config: NO `webServer` on purpose.
//
// The repository's default Playwright config boots `next dev -p 3141`, which
// would use the DATABASE_URL from `.env` (the production target) and would
// also re-add the generated block to the protected `AGENTS.md`. The closure
// browser tests must only ever touch the ISOLATED closure database, so this
// config ATTACHES to an already-running closure-backed server supplied through
// CLOSURE_BASE_URL and never starts one.
//
// The server it attaches to is started by
// _scratch/run-e2e-closure.mjs with DATABASE_URL/MIGRATION_DATABASE_URL
// pointed at the allowlisted `hyper_almoatasem_closure_20261030` database
// (runtime-proven by the wrapper and again by the spec's current_database()
// gate). Running this config standalone fails honestly.
const EVIDENCE = process.env.CLOSURE_EVIDENCE_DIR ?? "";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /order-journey-pages\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [
    ["list"],
    ...(EVIDENCE === ""
      ? []
      : [["json", { outputFile: `${EVIDENCE}/playwright-report.json` }] as const]),
  ],
  outputDir: EVIDENCE === "" ? "test-results/closure" : `${EVIDENCE}/test-results`,
  use: {
    baseURL: process.env.CLOSURE_BASE_URL ?? "http://127.0.0.1:3131",
    ...devices["Desktop Chrome"],
    channel: "chrome",
    locale: "ar-EG",
  },
});
