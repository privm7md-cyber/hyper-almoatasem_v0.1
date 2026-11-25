import { defineConfig, devices } from "@playwright/test";
import { readFileSync } from "node:fs";

// Phase D/E acceptance: attaches to an already-running server backed by the
// disposable synthetic database. No webServer, so it can never boot against
// Primary. Credentials come from the isolated cluster's secret file.
const secrets = JSON.parse(readFileSync("_recovery/v1-ops/isolated-secrets.json", "utf8"));
process.env.PHASE_DE_OWNER_EMAIL ??= "owner@hyper-al-moatasem.local";
process.env.PHASE_DE_OWNER_PASSWORD ??= secrets.adminPassword;

const baseURL = process.env.PHASE_DE_BASE_URL ?? "http://127.0.0.1:3152";
const evidence = process.env.PHASE_DE_EVIDENCE_DIR ?? "_recovery/v1-ops/evidence";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /phase-de-owner-policy\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: [["list"], ["json", { outputFile: `${evidence}/playwright-phase-de-report.json` }]],
  outputDir: `${evidence}/playwright-phase-de-results`,
  use: {
    baseURL,
    ...devices["Desktop Chrome"],
    channel: "chrome",
    locale: "ar-EG",
  },
});
