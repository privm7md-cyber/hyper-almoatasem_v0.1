// BA-4 customer concurrency suite (real PostgreSQL, scratch-only).
// Usage: node scripts/api/t-customers-concurrency.mjs --db <name> --port <port>
//   Race A: two concurrent identify() for one phone -> one customer
//     (statuses {201,200} in either order, identical ids, one DB row).
//   Race B: concurrent canonical equivalents (010… / +2010… / 2010…) ->
//     the same single customer (ladder convergence under contention).
//   Race C: two concurrent default-address creates for one customer ->
//     exactly one 201 + one 409, exactly one default remains
//     (partial-UQ backstop, no SERIALIZABLE, no app mutex).
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
  console.log(JSON.stringify({ suite: "customers-concurrency", db: dbName, total: results.length, failures: failures.length, failed: failures.map((f) => f.name), passed: results.filter((r) => r.pass).map((r) => r.name) }, null, 2));
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

const STORE_EMAIL = "store-cat-test@example.com";
const STORE_PW = "Cat-Test-Store-Pass-0002!";

const P_RACE_A = "01090000088";
const P_RACE_B = "01090000099";
const P_RACE_C = "01090000100";
const CANON = (p) => "2010" + p.slice(3);

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

  const post = async (path, data, cookie = null) => {
    const r = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(data),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const loginRes = await fetch(`${baseUrl}/api/admin/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: STORE_EMAIL, password: STORE_PW }),
  });
  const match = (loginRes.headers.get("set-cookie") || "").match(/__Host-admin-session=([^;]+)/);
  const cookie = match ? `__Host-admin-session=${match[1]}` : null;
  if (loginRes.status !== 201 || !cookie) {
    console.error("REFUSED_LOGIN: store test user login failed");
    process.exit(1);
  }

  const custCount = async (phone) =>
    Number((await q(`SELECT count(*)::int AS n FROM customers WHERE phone = $1`, [phone]))[0].n);

  try {
    // ---------- Race A: same phone ----------
    const [a1, a2] = await Promise.all([
      post(`/api/store/customers/identify`, { phone: P_RACE_A, firstName: "Race" }),
      post(`/api/store/customers/identify`, { phone: P_RACE_A, firstName: "Race" }),
    ]);
    const aStatuses = [a1.status, a2.status].sort().join(",");
    t("raceA-one-customer", aStatuses === "200,201", JSON.stringify([a1.status, a2.status]));
    t("raceA-same-id", a1.body?.data?.id !== undefined && a1.body.data.id === a2.body.data.id);
    t("raceA-single-row", (await custCount(CANON(P_RACE_A))) === 1);

    // ---------- Race B: canonical equivalents ----------
    const canonB = CANON(P_RACE_B);
    const [b1, b2, b3] = await Promise.all([
      post(`/api/store/customers/identify`, { phone: P_RACE_B, firstName: "Race" }),
      post(`/api/store/customers/identify`, { phone: `+${canonB}`, firstName: "Race" }),
      post(`/api/store/customers/identify`, { phone: canonB, firstName: "Race" }),
    ]);
    const bIds = [b1, b2, b3].map((r) => r.body?.data?.id);
    t("raceB-all-success", [b1, b2, b3].every((r) => r.status === 200 || r.status === 201),
      JSON.stringify([b1.status, b2.status, b3.status]));
    t("raceB-single-id", bIds[0] !== undefined && bIds.every((id) => id === bIds[0]));
    t("raceB-single-row", (await custCount(canonB)) === 1);

    // ---------- Race C: competing default addresses ----------
    const rc = await post(`/api/store/customers/identify`, { phone: P_RACE_C, firstName: "Race" });
    const idC = rc.body.data.id;
    const [c1, c2] = await Promise.all([
      post(`/api/admin/customers/${idC}/addresses`, { city: "Cairo", phone: P_RACE_C, isDefault: true }, cookie),
      post(`/api/admin/customers/${idC}/addresses`, { city: "Giza", phone: P_RACE_C, isDefault: true }, cookie),
    ]);
    const cStatuses = [c1.status, c2.status].sort().join(",");
    t("raceC-one-default-winner", cStatuses === "201,409", JSON.stringify([c1.status, c2.status]));
    const defaults = await q(`SELECT count(*)::int AS n FROM customer_addresses WHERE customer_id = $1 AND is_default`, [idC]);
    t("raceC-single-default", Number(defaults[0].n) === 1);
  } finally {
    try {
      for (const ph of [P_RACE_A, P_RACE_B, P_RACE_C].map(CANON)) {
        const rows = await db.query(`SELECT id FROM customers WHERE phone = $1`, [ph]).catch(() => ({ rows: [] }));
        for (const r of rows.rows) {
          await db.query(`DELETE FROM customer_addresses WHERE customer_id = $1`, [r.id]).catch(() => {});
        }
      }
      for (const ph of [P_RACE_A, P_RACE_B, P_RACE_C].map(CANON)) {
        await db.query(`DELETE FROM customers WHERE phone = $1`, [ph]).catch(() => {});
      }
      await db.query(`DELETE FROM admin_sessions WHERE user_id = (SELECT id FROM users WHERE email = $1)`, [STORE_EMAIL]).catch(() => {});
    } catch { /* scratch hygiene best-effort */ }
    await db.end().catch(() => {});
  }
  done();
}

main().catch((e) => {
  console.error(`RACE_SUITE_FAILED: ${e.constructor.name}: ${String(e.message).slice(0, 200)}`);
  process.exit(1);
});
