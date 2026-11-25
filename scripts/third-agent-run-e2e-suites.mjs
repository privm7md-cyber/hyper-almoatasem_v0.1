// third-agent-run-e2e-suites.mjs — FINAL full API E2E battery over the final
// build (.next-third-verify v2). Runs ALL 49 API suites, each against the
// isolated e2e DB and the dedicated battery servers:
//   3240 = trusted posture (TRUSTED_PROXY=1)    — all suites except t-proxy-identity
//   3241 = untrusted posture                    — t-proxy-identity only
// Hygiene (rate-limit buckets + fixture holds) is reset on the e2e DB before
// every suite; the helpers print database/user identity themselves.
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const REPO = "D:/Hyper_el-moatasem";
const LOGDIR = "D:/Hyper_Data_Review/Third_Agent_Final_Acceptance/Run_20261107_211349/E2E";
const DB = "hyper_almoatasem_e2e_20261106";
const PORT_TRUSTED = "3240";
const PORT_UNTRUSTED = "3241";

const SUITES = [
  "t-guest-orders.mjs",
  "t-atomicity.mjs",
  "t-idempotency-matrix.mjs",
  "t-time-contract.mjs",
  "t-foundation.mjs",
  "t-bab-catalog.mjs",
  "t-catalog.mjs",
  "t-catalog-unit.mjs",
  "t-cart.mjs",
  "t-cart-unit.mjs",
  "t-cart-concurrency.mjs",
  "t-bac-shopping.mjs",
  "t-bad-customer-checkout.mjs",
  "t-customer-auth.mjs",
  "t-customer-register-ratelimit.mjs",
  "t-customers.mjs",
  "t-customers-unit.mjs",
  "t-customers-concurrency.mjs",
  "t-store-addresses.mjs",
  "t-store-idor.mjs",
  "t-orders.mjs",
  "t-orders-unit.mjs",
  "t-orders-concurrency.mjs",
  "t-order-journey-d6.mjs",
  "t-inventory.mjs",
  "t-inventory-unit.mjs",
  "t-inventory-concurrency.mjs",
  "t-wave1-audit-inventory.mjs",
  "t-fulfillment.mjs",
  "t-replacements.mjs",
  "t-replacements-unit.mjs",
  "t-replacements-concurrency.mjs",
  "t-promotions.mjs",
  "t-promotions-unit.mjs",
  "t-promotions-concurrency.mjs",
  "t-admin.mjs",
  "t-admin-unit.mjs",
  "t-admin-concurrency.mjs",
  "t-audit-pairing.mjs",
  "t-ba-a-contract.mjs",
  "t-baf-admin.mjs",
  "t-bag-e2e.mjs",
  "t-deadlock.mjs",
  "t-rbac-guards.mjs",
  "t-rbac-races.mjs",
  "t-wave2-product-patch.mjs",
  "t-xmodule.mjs",
  "t-phase10-remediation.mjs", // trusted posture (client env mirrors server's TRUSTED_PROXY=1)
  "t-proxy-identity.mjs",      // untrusted posture — its own suite contract
];

const summary = [];
for (const s of SUITES) {
  const file = `${REPO}/scripts/api/${s}`;
  if (!fs.existsSync(file)) {
    summary.push({ suite: s, error: "MISSING FILE" });
    console.log(`${s}: MISSING FILE`);
    continue;
  }
  // 1) hygiene on the isolated e2e DB only
  const h1 = spawnSync(process.execPath, [`${REPO}/scripts/second-agent-clear-ratelimits.mjs`], { encoding: "utf8", timeout: 60000 });
  const h2 = spawnSync(process.execPath, [`${REPO}/scripts/second-agent-reset-fixture-holds.mjs`], { encoding: "utf8", timeout: 60000 });
  const hygieneSoft = (h1.status ?? 1) === 0 && (h2.status ?? 1) === 0;

  // 2) the suite itself
  const port = s === "t-proxy-identity.mjs" ? PORT_UNTRUSTED : PORT_TRUSTED;
  const env = { ...process.env };
  if (s === "t-phase10-remediation.mjs") env.PHASE10_TRUSTED_PROXY = "1"; // mirrors 3240's TRUSTED_PROXY=1
  const res = spawnSync(process.execPath, [file, "--db", DB, "--port", port], {
    timeout: 600000,
    encoding: "utf8",
    env,
  });
  const jsonName = `${LOGDIR}/${s.replace(".mjs", "")}.json`;
  fs.writeFileSync(jsonName, res.stdout || (res.stderr || ""), "utf8");
  const m = (res.stdout || "").match(/"total"\s*:\s*(\d+)[\s\S]*?"failures"\s*:\s*(\d+)/) ||
            (res.stderr || "").match(/"total"\s*:\s*(\d+)[\s\S]*?"failures"\s*:\s*(\d+)/);
  if (m) {
    console.log(`${s}: total=${m[1]} failures=${m[2]} exit=${res.status} hygiene=${hygieneSoft ? "ok" : "soft-skip"}`);
    summary.push({ suite: s, total: +m[1], failures: +m[2], exit: res.status, hygiene: hygieneSoft });
  } else {
    const err = ((res.stderr || "") + (res.stdout || "")).replace(/\r/g, " ").slice(0, 220);
    console.log(`${s}: NO-JSON exit=${res.status} err=${err.slice(0, 150)}`);
    summary.push({ suite: s, total: null, failures: null, exit: res.status, hygiene: hygieneSoft, err: err.slice(0, 150) });
  }
}
const clean = summary.filter((x) => typeof x.total === "number");
const totals = clean.reduce((a, b) => a + b.total, 0);
const fails = clean.reduce((a, b) => a + b.failures, 0);
fs.writeFileSync(`${LOGDIR}/third-e2e-battery-summary.json`, JSON.stringify({ suites: summary, totals, fails }, null, 2), "utf8");
console.log(`SUITES-DONE suites=${summary.length} totals=${totals} failures=${fails}`);
