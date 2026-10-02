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
// Hygiene (BA-A): remove the run-local users so repeated runs leave zero
// residue (sessions → mappings → audit pins → rows, best-effort).
try {
  const { Client } = await import("pg");
  const cu = new URL(process.env.MIGRATION_DATABASE_URL);
  cu.pathname = `/${dbName}`;
  const c = new Client({ connectionString: cu.toString(), connectionTimeoutMillis: 8000 });
  await c.connect();
  try {
    for (const em of [creds.owner.email, creds.store.email]) {
      await c.query(`DELETE FROM audit_logs WHERE user_id = (SELECT id FROM users WHERE email = $1)`, [em]).catch(() => {});
      await c.query(`DELETE FROM admin_sessions WHERE user_id = (SELECT id FROM users WHERE email = $1)`, [em]).catch(() => {});
      await c.query(`DELETE FROM user_roles WHERE user_id = (SELECT id FROM users WHERE email = $1)`, [em]).catch(() => {});
      await c.query(`DELETE FROM users WHERE email = $1`, [em]).catch(() => {});
    }
  } finally {
    await c.end().catch(() => {});
  }
} catch { /* scratch hygiene best-effort */ }
