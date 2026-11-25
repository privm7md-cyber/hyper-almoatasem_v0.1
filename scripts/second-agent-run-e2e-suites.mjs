// second-agent-run-e2e-suites.mjs — runs remaining API E2E suites against isolated
// prod server (3223) + isolated e2e DB; records totals to run-dir Logs.
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const REPO = "D:/Hyper_el-moatasem";
const LOGDIR = "D:/Hyper_Data_Review/Second_Agent_Completion/Run_20261106_210603/Logs";
const DB = "hyper_almoatasem_e2e_20261106";
const PORT = "3223";

const SUITES = [
  "t-guest-orders.mjs",
  "t-admin-concurrency.mjs",
  "t-atomicity.mjs",
  "t-audit-pairing.mjs",
  "t-ba-a-contract.mjs",
  "t-bab-catalog.mjs",
  "t-bac-shopping.mjs",
  "t-bad-customer-checkout.mjs",
  "t-baf-admin.mjs",
  "t-bag-e2e.mjs",
  "t-cart-concurrency.mjs",
  "t-customer-auth.mjs",
  "t-customer-register-ratelimit.mjs",
  "t-customers-concurrency.mjs",
  "t-deadlock.mjs",
  "t-idempotency-matrix.mjs",
  "t-inventory-concurrency.mjs",
  "t-order-journey-d6.mjs",
  "t-orders-concurrency.mjs",
  "t-phase10-remediation.mjs",
  "t-promotions-concurrency.mjs",
  "t-proxy-identity.mjs",
  "t-rbac-guards.mjs",
  "t-rbac-races.mjs",
  "t-replacements.mjs",
  "t-replacements-concurrency.mjs",
  "t-store-addresses.mjs",
  "t-store-idor.mjs",
  "t-time-contract.mjs",
  "t-wave1-audit-inventory.mjs",
  "t-wave2-product-patch.mjs",
  "t-xmodule.mjs",
];

const only = (process.argv.find((a) => a.startsWith("--only=")) ?? "").slice(7).split(",").filter(Boolean);

const summary = [];
for (const s of SUITES) {
  if (only.length && !only.includes(s)) continue;
  const res = spawnSync(process.execPath, [`${REPO}/scripts/api/${s}`, "--db", DB, "--port", PORT], {
    timeout: 300000,
    encoding: "utf8",
  });
  const out = res.stdout || "";
  fs.writeFileSync(`${LOGDIR}/${s.replace(".mjs", "")}.json`, out, "utf8");
  const m = out.match(/"total"\s*:\s*(\d+)[\s\S]*?"failures"\s*:\s*(\d+)/);
  if (m) {
    console.log(`${s}: total=${m[1]} failures=${m[2]} exit=${res.status}`);
    summary.push({ suite: s, total: +m[1], failures: +m[2], exit: res.status });
  } else {
    const err = (res.stderr || "").slice(0, 200).replace(/\r/g, " ");
    console.log(`${s}: NO-JSON exit=${res.status} err=${err.slice(0, 120)}`);
    summary.push({ suite: s, total: null, failures: null, exit: res.status, err: err.slice(0, 120) });
  }
}
fs.writeFileSync(`${LOGDIR}/e2e-suite-summary.json`, JSON.stringify(summary, null, 2), "utf8");
console.log("SUITES-DONE");
