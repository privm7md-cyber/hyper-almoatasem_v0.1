// Verify the scratch-perf account vs the P12-06 creds file (read-only on Primary host; database swapped).
// Prints PASS/FAIL only — never prints passwords or connection strings.
import { readFileSync } from "node:fs";
import { Client } from "pg";
import argon2 from "argon2";
for (const m of readFileSync(".env", "utf8").matchAll(/^\s*([\w-]+)\s*=\s*"?([^"\r\n]*)"?\s*$/gm)) process.env[m[1]] ??= m[2];
const url = new URL(process.env.DATABASE_URL);
url.pathname = "/hyper_almoatasem_scratch";
const db = new Client({ connectionString: url.toString() });
await db.connect();
const out = { generatedAt: new Date().toISOString(), readOnly: true, checks: {} };
const credsPath = "D:/Hyper_Data_Review/PHASE_12_PREMIUM_ENGINEERING/P12_06/Run_20261117_0900/backups/scratch-perf-creds.txt";
let email = null, password = null;
try {
  const creds = readFileSync(credsPath, "utf8");
  email = creds.match(/^email:\s*(.+)$/m)?.[1]?.trim() ?? null;
  password = creds.match(/^password:\s*(.+)$/m)?.[1]?.trim() ?? null;
  out.checks.credsFileExists = true;
  out.checks.credsEmail = email;
} catch { out.checks.credsFileExists = false; }
if (email && password) {
  const row = (await db.query("SELECT email, password_hash, failed_login_attempts, locked_until, is_active, deleted_at FROM users WHERE email = $1", [email])).rows[0];
  out.checks.accountFound = !!row;
  if (row) {
    out.checks.isActive = row.is_active;
    out.checks.deleted = row.deleted_at !== null;
    out.checks.failedLogins = row.failed_login_attempts;
    out.checks.lockedUntil = row.locked_until;
    out.checks.credsMatchesHash = await argon2.verify(row.password_hash, password);
  }
}
await db.end();
console.log(JSON.stringify(out, null, 2));
