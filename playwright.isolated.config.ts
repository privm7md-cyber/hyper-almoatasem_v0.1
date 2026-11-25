import { defineConfig, devices } from "@playwright/test";

// Isolated Storefront E2E config (NO `webServer` on purpose).
//
// `playwright.config.ts` spawns `next dev -p 3141` against `.env` (Primary DB
// `hyper_almoatasem`) and touches `AGENTS.md`. Write-capable Storefront E2E
// specs MUST attach to a verified isolated scratch server explicitly configured
// via environment variables, never falling back silently to a hardcoded port.
const RAW_BASE =
  process.env.PHASE07_BASE_URL ??
  process.env.E2E_BASE_URL ??
  process.env.PHASE10_BASE_URL ??
  "";

if (RAW_BASE.trim() === "") {
  throw new Error(
    "ISOLATED_E2E_CONFIG_ERROR: Set PHASE07_BASE_URL (or E2E_BASE_URL) and PHASE07_DATABASE_URL pointing to an isolated scratch server and DB before running.",
  );
}

const parsed = new URL(RAW_BASE);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
  throw new Error(
    `ISOLATED_E2E_REFUSED_HOST: Isolated E2E may only target loopback addresses, got ${RAW_BASE}`,
  );
}
if (parsed.port === "3150") {
  throw new Error(
    `ISOLATED_E2E_REFUSED_PRIMARY_PORT: Refusing Primary-DB preview port 3150 (${RAW_BASE}).`,
  );
}

const RESULTS_DIR =
  process.env.ISOLATED_RESULTS_DIR ?? "test-results/isolated-storefront";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  outputDir: RESULTS_DIR,
  use: {
    baseURL: parsed.origin,
    ...devices["Desktop Chrome"],
    channel: "chrome",
    locale: "ar-EG",
  },
});
