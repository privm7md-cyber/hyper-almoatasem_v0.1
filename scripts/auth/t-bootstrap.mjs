// Bootstrap CLI tests (scratch-only, 10 cases). Drives
// scripts/bootstrap-admin-password.mjs via child processes with piped stdin
// (never CLI args, never logs). Asserts refusal paths perform ZERO database
// contact for production/unknown targets (pre-connection guards).
import { spawnSync } from "node:child_process";
import "dotenv/config";
import { Client } from "pg";
import argon2 from "argon2";

const dbName = process.argv[process.argv.indexOf("--db") + 1];
if (dbName === "hyper_almoatasem" || !(dbName.endsWith("_20260923") || dbName.endsWith("_20260924"))) {
  console.error(`REFUSED: ${dbName}`);
  process.exit(1);
}
const scratchUrl = (() => {
  const u = new URL(process.env.MIGRATION_DATABASE_URL);
  u.pathname = `/${dbName}`;
  return u.toString();
})();
const prodUrl = process.env.MIGRATION_DATABASE_URL; // production — must be refused pre-connection

const results = [];
const t = (name, pass, detail = "") => results.push({ name, pass, detail });

function runCli(envExtra, stdin, email) {
  const args = ["scripts/bootstrap-admin-password.mjs"];
  if (email) args.push("--email", email);
  const r = spawnSync("node", args, {
    cwd: "D:/Hyper_el-moatasem",
    env: { ...process.env, ...envExtra },
    input: stdin,
    encoding: "utf8",
  });
  return { status: r.status, out: `${r.stdout || ""}\n${r.stderr || ""}` };
}
const OWNER = `bootstrap-probe-${Date.now().toString(36)}@example.com`;
const PW = "Cli-Test-Pass-0003!";
const constLeakCheck = (out) => !out.includes(PW) && !out.includes("Cli-Test-Pass-0004!");

// Run-local probe identity (parallel-safe): created here, used by all CLI
// cases below, removed at the end. The CLI only ever touches this row.
{
  const c = new Client({ connectionString: scratchUrl, connectionTimeoutMillis: 8000 });
  await c.connect();
  try {
    await c.query(`INSERT INTO users (name, email, is_active) VALUES ('Bootstrap Probe', $1, TRUE)`, [OWNER]);
    const u = (await c.query(`SELECT id FROM users WHERE email=$1`, [OWNER])).rows[0];
    const r = (await c.query(`SELECT id FROM roles WHERE name='SUPER_ADMIN'`)).rows[0];
    await c.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [u.id, r.id]);
  } finally {
    await c.end().catch(() => {});
  }
}

// 1. valid bootstrap (rotation over existing owner password).
{
  const r = runCli({ DATABASE_URL: scratchUrl }, `${PW}\n${PW}\n`, OWNER);
  t("valid_bootstrap", r.status === 0 && r.out.includes('"passwordUpdated":true'), `status=${r.status}`);
}
// 2. invalid (short) password rejected.
{
  const r = runCli({ DATABASE_URL: scratchUrl }, `short1\nshort1\n`, OWNER);
  t("invalid_password", r.status !== 0 && r.out.includes("too short"), `status=${r.status}`);
}
// 3. confirmation mismatch rejected.
{
  const r = runCli({ DATABASE_URL: scratchUrl }, `${PW}\nDifferent-Pass-1!\n`, OWNER);
  t("mismatch", r.status !== 0 && r.out.includes("mismatch"), `status=${r.status}`);
}
// 4. rotation: second valid run succeeds again.
{
  const r = runCli({ DATABASE_URL: scratchUrl }, `Cli-Test-Pass-0004!\nCli-Test-Pass-0004!\n`, OWNER);
  t("rotation", r.status === 0, `status=${r.status}`);
}
// 5. hash updated + verifies with argon2.
{
  const c = new Client({ connectionString: scratchUrl, connectionTimeoutMillis: 8000 });
  await c.connect();
  try {
    const row = (await c.query(`SELECT password_hash FROM users WHERE email=$1`, [OWNER])).rows[0];
    const ok = row && row.password_hash.startsWith("$argon2id$") && (await argon2.verify(row.password_hash, "Cli-Test-Pass-0004!"));
    t("hash_updated", ok === true, `prefix=${String(row?.password_hash).slice(0, 11)}`);
  } finally {
    await c.end().catch(() => {});
  }
}
// 6. audit generated (scoped to the probe identity: exactly the 2 rotations).
{
  const c = new Client({ connectionString: scratchUrl, connectionTimeoutMillis: 8000 });
  await c.connect();
  try {
    const n = Number((await c.query(`SELECT count(*) n FROM audit_logs WHERE action='auth.bootstrap_password_set' AND entity_id = (SELECT id FROM users WHERE email=$1)`, [OWNER])).rows[0].n);
    t("audit_generated", n === 2, `count=${n}`);
  } finally {
    await c.end().catch(() => {});
  }
}
// 7. password never logged (all outputs above + fresh failing run).
{
  const r = runCli({ DATABASE_URL: scratchUrl }, `short1\nshort1\n`, OWNER);
  t("not_logged", constLeakCheck(r.out), "");
}
// 8. production target refused with zero contact (pre-connection guard).
{
  const before = Date.now();
  const r = runCli({ DATABASE_URL: prodUrl }, `${PW}\n${PW}\n`, OWNER);
  t("production_refused", r.status !== 0 && r.out.includes("refusing production"), `status=${r.status} ms=${Date.now() - before}`);
}
// 9. wrong DB (postgres maintenance) refused.
{
  const maint = scratchUrl.replace(`/${dbName}`, "/postgres");
  const r = runCli({ DATABASE_URL: maint }, `${PW}\n${PW}\n`, OWNER);
  t("wrong_db_refused", r.status !== 0 && r.out.includes("unknown database"), `status=${r.status}`);
}
// 10. unauthorized/unknown database refused with zero contact.
{
  const unknown = scratchUrl.replace(`/${dbName}`, "/hyper_almoatasem_evil");
  const r = runCli({ DATABASE_URL: unknown }, `${PW}\n${PW}\n`, OWNER);
  t("unknown_db_refused", r.status !== 0 && r.out.includes("unknown database"), `status=${r.status}`);
}

// Cleanup probe credentials (scratch-only): audit rows are append-only history
// and pin the user row (RESTRICT), so the probe identity stays as an inert,
// credential-less row — exactly like a pre-bootstrap identity. Mappings go.
{
  const c = new Client({ connectionString: scratchUrl, connectionTimeoutMillis: 8000 });
  await c.connect();
  try {
    const u = (await c.query(`SELECT id FROM users WHERE email=$1`, [OWNER])).rows[0];
    if (u) {
      await c.query(`DELETE FROM user_roles WHERE user_id=$1`, [u.id]);
      await c.query(`UPDATE users SET password_hash = NULL, failed_login_attempts = 0, locked_until = NULL WHERE id=$1`, [u.id]);
    }
  } finally {
    await c.end().catch(() => {});
  }
  console.log("probe credentials cleared");
}

const failures = results.filter((r) => !r.pass).length;
console.log(JSON.stringify({ database: dbName, failures, results }, null, 2));
process.exitCode = failures === 0 ? 0 : 2;
