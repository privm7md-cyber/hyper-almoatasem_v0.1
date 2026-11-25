import { defineConfig, devices } from "@playwright/test";

// Phase-13 follow-up (owner-approval reconciliation) account-runtime e2e config.
//
// NO `webServer` on purpose.
//
// The repository's default Playwright config boots `next dev -p 3141`, which
// would use the DATABASE_URL from `.env` (the production target). These
// browser tests must only ever touch the ISOLATED local scratch database, so
// this config only ATTACHES to an already-running server supplied through
// P13R_BASE_URL and never starts one.
//
// The server it attaches to is the production bundle started by the follow-up
// runner with DATABASE_URL/MIGRATION_DATABASE_URL rewritten to the
// allowlisted `hyper_almoatasem_scratch` database (runtime-proven by the
// wrapper's IDENTITY_PROOF and again by the spec's own writes). Running this
// config standalone fails honestly.
const EVIDENCE = process.env.P13R_EVIDENCE_DIR ?? "";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /p13r-account-runtime\.spec\.ts/,
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
  outputDir: EVIDENCE === "" ? "test-results/p13r" : `${EVIDENCE}/test-results`,
  use: {
    baseURL: process.env.P13R_BASE_URL ?? "http://127.0.0.1:3214",
    ...devices["Desktop Chrome"],
    channel: "chrome",
    locale: "ar-EG",
  },
});
