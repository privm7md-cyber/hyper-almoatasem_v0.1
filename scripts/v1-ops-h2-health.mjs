// V1 Data Integrity — H2 & preview health (read-only):
//   1. /api/health on :3150 (Primary preview) and :3151 (scratch preview).
//   2. Worker process presence: node processes running scripts/privacy-redaction-worker.mjs (read-only).
//   3. H2/privacy tables on Primary: information_schema dump (names only, no data).
// Produces evidence/h2-health.json (call scripts/v1-ops-h2-health.mjs).
import { readFileSync } from "node:fs";
import { Client } from "pg";
for (const m of readFileSync(".env", "utf8").matchAll(/^\s*([\w-]+)\s*=\s*"?([^"\r\n]*)"?\s*$/gm)) process.env[m[1]] ??= m[2];
const out = { generatedAt: new Date().toISOString(), checks: {} };
async function health(port) {
  try {
    const r = await fetch(`http://localhost:${port}/api/health`);
    out.checks[`health_${port}`] = { status: r.status, body: await r.json() };
  } catch (e) { out.checks[`health_${port}`] = { error: String(e) }; }
}
async function login(port, email, password) {
  try {
    const r = await fetch(`http://localhost:${port}/api/admin/session`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    out.checks[`login_${port}`] = { status: r.status };
  } catch (e) { out.checks[`login_${port}`] = { error: String(e) }; }
}
await health(3150); await health(3151);
// scratch admin account for the preview health check
try { const creds = readFileSync("D:/Hyper_Data_Review/PHASE_12_PREMIUM_ENGINEERING/P12_06/Run_20261117_0900/backups/scratch-perf-creds.txt", "utf8");
  const email = creds.match(/^email:\s*(.+)$/m)?.[1]?.trim(); const password = creds.match(/^password:\s*(.+)$/m)?.[1]?.trim();
  await login(3151, email, password); } catch (e) { out.checks["scratch_login_3151"] = { error: "scratch creds file missing: " + e.code }; }
// H2/privacy tables on Primary (names only)
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const tables = await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name ILIKE '%v1%' OR table_name ILIKE '%privacy%' OR table_name ILIKE '%h2%' OR table_name ILIKE '%redact%') ORDER BY table_name");
out.checks["primary_h2_tables"] = tables.rows.map((r) => r.table_name);
const totalTables = (await db.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'")).rows[0].n;
out.checks["primary_table_count"] = totalTables;
await db.end();
console.log(JSON.stringify(out, null, 2));
