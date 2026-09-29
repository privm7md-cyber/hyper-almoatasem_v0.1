// BA-9 admin concurrency suite (real PostgreSQL, scratch-only).
// Usage: node scripts/api/t-admin-concurrency.mjs --db <name> --port <port>
// Only races the operations BA-9 actually defines (no BA-10 matrix):
//   R1 duplicate user creation (one email) -> one 201 + one 409, one row.
//   R2 concurrent role assignment (one pair) -> one 201 + one 409.
//   R3 competing activation writes -> both 200, single consistent state.
//   R4 competing setting updates -> both 200, winner's valid value stands.
// Prints JSON, never secrets.
import "dotenv/config";
import { Client } from "pg";

const args = process.argv.slice(2);
const dbFlag = args.indexOf("--db");
const portFlag = args.indexOf("--port");
const dbName = dbFlag === -1 ? null : args[dbFlag + 1];
const port = portFlag === -1 ? "3131" : args[portFlag + 1];

const results = [];
const t = (name, pass, detail = "") => results.push({ name, pass: pass === true, detail });
const done = (code) => {
  const failures = results.filter((r) => !r.pass);
  console.log(JSON.stringify({ suite: "admin-concurrency", db: dbName, total: results.length, failures: failures.length, failed: failures.map((f) => f.name), passed: results.filter((r) => r.pass).map((r) => r.name) }, null, 2));
  process.exitCode = code ?? (failures.length === 0 ? 0 : 2);
};

const ALLOWED = [
  "hyper_almoatasem_scratch",
  "hyper_almoatasem_scratch_official_20260923",
  "hyper_almoatasem_seed_20260923",
  "hyper_almoatasem_auth_20260923",
  "hyper_almoatasem_authb_20260923",
  "hyper_almoatasem_hardening_20260924",
  "hyper_almoatasem_staging_20260924",
];

const OWNER_EMAIL = "owner@hyper-al-moatasem.local";
const OWNER_PW = "Cat-Test-Owner-Pass-0001!";

async function main() {
  if (!dbName || !ALLOWED.includes(dbName)) {
    console.error(`REFUSED_DB: ${dbName}`);
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
  const q = async (sql, params = []) => (await db.query(sql, params)).rows;

  const post = async (path, data, cookie) => {
    const r = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(data),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const patch = async (path, data, cookie) => {
    const r = await fetch(`${baseUrl}${path}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(data),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const loginRes = await fetch(`${baseUrl}/api/admin/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PW }),
  });
  const match = (loginRes.headers.get("set-cookie") || "").match(/__Host-admin-session=([^;]+)/);
  const cookie = match ? `__Host-admin-session=${match[1]}` : null;
  if (loginRes.status !== 200 || !cookie) {
    console.error("REFUSED_LOGIN: owner login failed");
    process.exit(1);
  }

  const stamp = Date.now().toString(36);
  const userIds = new Set();
  const roleIds = new Set();

  try {
    // ---------- R1: duplicate user creation ----------
    const emailR1 = `ba9r-dup-${stamp}@example.com`;
    const [r1a, r1b] = await Promise.all([
      post(`/api/admin/users`, { name: "BA9 Race", email: emailR1 }, cookie),
      post(`/api/admin/users`, { name: "BA9 Race", email: emailR1 }, cookie),
    ]);
    const r1 = [r1a.status, r1b.status].sort().join(",");
    t("raceUser-single-winner", r1 === "201,409", JSON.stringify([r1a.status, r1b.status]));
    if (r1a.status === 201) userIds.add(r1a.body.data.id);
    if (r1b.status === 201) userIds.add(r1b.body.data.id);
    t("raceUser-single-row", (await q(`SELECT count(*)::int AS n FROM users WHERE email = $1`, [emailR1]))[0].n === 1);

    // ---------- R2: concurrent role assignment ----------
    const ru = await post(`/api/admin/users`, { name: "BA9 RaceU", email: `ba9r-u-${stamp}@example.com` }, cookie);
    const rr = await post(`/api/admin/roles`, { name: `BA9R_RACE_${stamp}`.toUpperCase() }, cookie);
    const idU = ru.body.data.id;
    const idR = rr.body.data.id;
    userIds.add(idU);
    roleIds.add(idR);
    const [r2a, r2b] = await Promise.all([
      post(`/api/admin/users/${idU}/roles`, { roleId: idR }, cookie),
      post(`/api/admin/users/${idU}/roles`, { roleId: idR }, cookie),
    ]);
    const r2 = [r2a.status, r2b.status].sort().join(",");
    t("raceAssign-single-winner", r2 === "201,409", JSON.stringify([r2a.status, r2b.status]));
    t("raceAssign-single-row", (await q(`SELECT count(*)::int AS n FROM user_roles WHERE user_id = $1 AND role_id = $2`, [idU, idR]))[0].n === 1);

    // ---------- R3: competing activation writes ----------
    const [r3a, r3b] = await Promise.all([
      patch(`/api/admin/users/${idU}`, { isActive: false }, cookie),
      patch(`/api/admin/users/${idU}`, { isActive: false }, cookie),
    ]);
    t("raceActivate-consistent", r3a.status === 200 && r3b.status === 200);
    t("raceActivate-state", (await q(`SELECT is_active FROM users WHERE id = $1`, [idU]))[0].is_active === false);
    await patch(`/api/admin/users/${idU}`, { isActive: true }, cookie);

    // ---------- R4: competing setting updates ----------
    const [r4a, r4b] = await Promise.all([
      patch(`/api/admin/settings/store.name`, { value: "Race A" }, cookie),
      patch(`/api/admin/settings/store.name`, { value: "Race B" }, cookie),
    ]);
    t("raceSettings-both-ok", r4a.status === 200 && r4b.status === 200, JSON.stringify([r4a.status, r4b.status]));
    const cur = await q(`SELECT value_text FROM store_settings WHERE key = 'store.name'`);
    t("raceSettings-valid", cur[0].value_text === "Race A" || cur[0].value_text === "Race B", cur[0].value_text);
    await patch(`/api/admin/settings/store.name`, { value: "Hyper Al-Moatasem" }, cookie);
  } finally {
    try {
      for (const uid of userIds) {
        await db.query(`DELETE FROM admin_sessions WHERE user_id = $1`, [uid]).catch(() => {});
        await db.query(`DELETE FROM user_roles WHERE user_id = $1`, [uid]).catch(() => {});
        await db.query(`DELETE FROM users WHERE id = $1`, [uid]).catch(() => {});
      }
      for (const rid of roleIds) {
        await db.query(`DELETE FROM role_permissions WHERE role_id = $1`, [rid]).catch(() => {});
        await db.query(`DELETE FROM user_roles WHERE role_id = $1`, [rid]).catch(() => {});
        await db.query(`DELETE FROM roles WHERE id = $1`, [rid]).catch(() => {});
      }
      await db.query(`DELETE FROM admin_sessions WHERE user_id = (SELECT id FROM users WHERE email = $1)`, [OWNER_EMAIL]).catch(() => {});
    } catch { /* scratch hygiene best-effort */ }
    await db.end().catch(() => {});
  }
  done();
}

main().catch((e) => {
  console.error(`RACE_SUITE_FAILED: ${e.constructor.name}: ${String(e.message).slice(0, 200)}`);
  process.exit(1);
});
