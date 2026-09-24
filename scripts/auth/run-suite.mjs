// Run ONE http suite against an already-running server (scratch-only).
// Usage: node scripts/auth/run-suite.mjs --suite <name> --db <name> --port <port>
// Prints the suite JSON (never passwords).
import fs from "node:fs";
import "dotenv/config";

const suite = process.argv[process.argv.indexOf("--suite") + 1];
const dbName = process.argv[process.argv.indexOf("--db") + 1];
const port = process.argv[process.argv.indexOf("--port") + 1] || "3111";
const logFlag = process.argv.indexOf("--logfile");
const logFile = logFlag === -1 ? null : process.argv[logFlag + 1];
const useTls = process.argv.includes("--tls");
if (useTls) process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // self-signed staging cert, test-only
const ALLOWED = [
  "hyper_almoatasem_scratch",
  "hyper_almoatasem_scratch_official_20260923",
  "hyper_almoatasem_seed_20260923",
  "hyper_almoatasem_auth_20260923",
  "hyper_almoatasem_authb_20260923",
  "hyper_almoatasem_hardening_20260924",
  "hyper_almoatasem_staging_20260924",
];
if (!ALLOWED.includes(dbName) || !["auth-flow", "rbac", "races", "security", "hardening"].includes(suite)) {
  console.error(`REFUSED: ${suite} ${dbName}`);
  process.exit(1);
}
const mod = await import(`./suites/${suite}.mjs`);
// Run-local identities: parallel-safe (no shared owner/store rows).
const { createRunUsers } = await import("./test-users.mjs");
const creds = await createRunUsers(dbName);
const ctx = {
  baseUrl: `${useTls ? "https" : "http"}://127.0.0.1:${port}`,
  dbName,
  owner: creds.owner,
  store: creds.store,
};
const serverLogs = logFile && fs.existsSync(logFile) ? [fs.readFileSync(logFile, "utf8")] : [];
const results = await mod.run(ctx, serverLogs);
const failures = results.filter((r) => !r.pass);
console.log(JSON.stringify({ suite, total: results.length, failures: failures.length, failed: failures, passed: results.filter((r) => r.pass).map((r) => r.name) }, null, 2));
process.exitCode = failures.length === 0 ? 0 : 2;
