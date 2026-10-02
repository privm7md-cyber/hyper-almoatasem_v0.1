// CC-1 lockout/time-gate tests (BA-1). Cases A-F per task.
// Part 0 (no DB): static guard — the login fail-path must decide lockout in
// SQL, never via a JavaScript Date comparison on a decoded TIMESTAMPTZ.
// Part 1 (needs server + scratch DB): HTTP behavior cases against a running
// Next server pointed at the given scratch database.// Usage: node scripts/auth/t-cc1-lockout.mjs --db <name> --port <port>
// Prints JSON (never passwords, hashes, or tokens). Scratch-only guard.
// Server TZ variation (Case F): start the server under different TZ values
// (e.g. TZ=Africa/Cairo vs TZ=Pacific/Kiritimati) and run this suite twice;
// outcomes must be identical because no decision reads a decoded timestamp.
import fs from "node:fs";
import crypto from "node:crypto";
import "dotenv/config";
import argon2 from "argon2";
import { Client } from "pg";

const args = process.argv.slice(2);
const dbFlag = args.indexOf("--db");
const portFlag = args.indexOf("--port");
const dbName = dbFlag === -1 ? null : args[dbFlag + 1];
const port = portFlag === -1 ? "3131" : args[portFlag + 1];

const results = [];
const t = (name, pass, detail = "") => results.push({ name, pass: pass === true, detail });

// ---------- Part 0: static guard (no DB) ----------
const loginSrc = fs.readFileSync("src/lib/auth/login.ts", "utf8");
t("static-no-js-date-on-locked-until", !/new Date\(\s*row\.locked_until/.test(loginSrc) && !/locked_until[^;]*\.getTime\(\)/.test(loginSrc));
t("static-sql-lock-boolean", /RETURNING[\s\S]*?locked_until\s+IS\s+NOT\s+NULL\s+AND\s+locked_until\s*>\s*now\(\)/.test(loginSrc));
t("static-no-timezone-arithmetic", !/getTimezoneOffset|setHours|\+ *3 *\* *60|10800000/.test(loginSrc));

// ---------- Part 1: HTTP behavior (needs server + scratch DB) ----------
const ALLOWED = [
  "hyper_almoatasem_scratch",
  "hyper_almoatasem_scratch_official_20260923",
  "hyper_almoatasem_seed_20260923",
  "hyper_almoatasem_auth_20260923",
  "hyper_almoatasem_authb_20260923",
  "hyper_almoatasem_hardening_20260924",
  "hyper_almoatasem_staging_20260924",
];

function argonOpts() {
  return { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };
}

async function main() {
  if (!dbName || !ALLOWED.includes(dbName)) {
    console.error(`REFUSED_DB: ${dbName} (run a server pointed at an allowlisted scratch DB first)`);
    process.exit(1);
  }
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    const probe = await fetch(`${baseUrl}/api/admin/session`, { method: "GET" });
    await probe.text();
  } catch {
    console.error(`REFUSED_NO_SERVER: nothing listening at ${baseUrl}`);
    process.exit(1);
  }

  const scratchUrl = (() => {
    const u = new URL(process.env.MIGRATION_DATABASE_URL);
    u.pathname = `/${dbName}`;
    return u.toString();
  })();
  const db = new Client({ connectionString: scratchUrl, connectionTimeoutMillis: 5000 });
  await db.connect();

  const tag = Date.now().toString(36);
  const email = `cc1-${tag}@example.com`;
  const password = `Cc1-${tag}-` + crypto.randomBytes(6).toString("hex") + "!";
  const userId = crypto.randomUUID();
  const hash = await argon2.hash(password, argonOpts());
  await db.query(
    `INSERT INTO users (id, name, email, phone, password_hash, is_active, failed_login_attempts, locked_until)
     VALUES ($1, 'CC1 User', $2, $3, $4, TRUE, 0, NULL)`,
    [userId, email, `2010${String(Date.now()).slice(-7)}`, hash],
  );

  const login = async (pw) => {
    const r = await fetch(`${baseUrl}/api/admin/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: pw }),
    });
    const body = await r.json().catch(() => ({}));
    return { status: r.status, ok: r.status === 201 && body.data?.admin?.email === email };
  };
  const setLock = (attempts, lockedSql) =>
    db.query(`UPDATE users SET failed_login_attempts = $2, locked_until = ${lockedSql} WHERE id = $1`, [userId, attempts]);
  const sqlLocked = async () =>
    (await db.query(`SELECT (locked_until IS NOT NULL AND locked_until > now()) AS locked FROM users WHERE id = $1`, [userId])).rows[0].locked;

  // Case A: no lockout -> login succeeds.
  await setLock(0, "NULL");
  t("A-no-lockout-login-ok", (await login(password)).ok === true);

  // Case B: active lockout -> rejected with generic 401.
  await setLock(5, "now() + interval '15 minutes'");
  const b = await login(password);
  t("B-active-lockout-rejected", b.ok === false && b.status === 401);

  // Case C: expired lockout -> not rejected for lockout.
  await setLock(5, "now() - interval '1 hour'");
  t("C-expired-lockout-not-rejected", (await login(password)).ok === true);

  // Case D: 15-minute lockout must not read as ~3h15m (the CC-1 regression).
  // A lock that expired 16 minutes ago (1 minute past a 15-minute lock) MUST
  // already allow login. Under the old JS-decode bug it would still reject.
  await setLock(5, "now() - interval '16 minutes'");
  const sqlSaysUnlocked = (await sqlLocked()) === false;
  const d = await login(password);
  t("D-15min-not-3h15m", sqlSaysUnlocked && d.ok === true);

  // Case E: boundary — attempts=3 with a live 2s lock rejects now (the bump
  // to 4 stays below threshold, so it cannot extend the lock); 3.5s later
  // the SQL gate reads unlocked. (At attempts=5 any rejected login would
  // re-lock for 15 minutes by design — expiry-then-login is covered by C/D.)
  await setLock(3, "now() + interval '2 seconds'");
  const e1 = await login(password);
  await new Promise((r) => setTimeout(r, 3500));
  const eGate = await sqlLocked();
  const eAttempts = (await db.query(`SELECT failed_login_attempts AS n FROM users WHERE id = $1`, [userId])).rows[0].n;
  t("E-boundary-reject-then-gate-clears", e1.ok === false && eGate === false && Number(eAttempts) === 4);

  // Hygiene: remove scratch-only rows (audit rows first: users is RESTRICT-referenced).
  await db.query(`DELETE FROM audit_logs WHERE user_id = $1`, [userId]);
  await db.query(`DELETE FROM admin_sessions WHERE user_id = $1`, [userId]);
  await db.query(`DELETE FROM user_roles WHERE user_id = $1`, [userId]);
  await db.query(`DELETE FROM users WHERE id = $1`, [userId]);
  await db.end().catch(() => {});

  const failures = results.filter((r) => !r.pass);
  console.log(JSON.stringify({ suite: "cc1-lockout", db: dbName, total: results.length, failures: failures.length, failed: failures.map((f) => f.name), passed: results.filter((r) => r.pass).map((r) => r.name) }, null, 2));
  process.exitCode = failures.length === 0 ? 0 : 2;
}

main().catch((e) => {
  console.error(`CC1_SUITE_FAILED: ${e.constructor.name}: ${String(e.message).slice(0, 200)}`);
  process.exit(1);
});
