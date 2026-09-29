// BA-3 inventory concurrency suite (real PostgreSQL, scratch-only).
// Usage: node scripts/api/t-inventory-concurrency.mjs --db <name> --port <port>
// Races A-E run against the built server (HTTP, READ COMMITTED, row locks,
// atomic predicates — never SERIALIZABLE, never read-check-write):
//   A: same PIECE stock (1): two reserve(1) -> exactly one 201, one 409.
//   B: same WEIGHT stock (1.000): two reserve(0.750) -> single winner.
//   C: over-reservation (5): two reserve(3) -> single winner, reserved=3.
//   D: double-commit same line (R3 held-release): two commit(req2/act2) ->
//      single winner, one SALE, never negative.
//   E: multi-row ASC lock order: two opposing batch reserves -> no deadlock,
//      single full winner, no partial holds (direct SQL mirroring the
//      service reserveBatch pattern: lock ASC, conditional bumps, rollback).
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
  console.log(JSON.stringify({ suite: "inventory-concurrency", db: dbName, total: results.length, failures: failures.length, failed: failures.map((f) => f.name), passed: results.filter((r) => r.pass).map((r) => r.name) }, null, 2));
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

const CAT = "03800000-0000-7000-8000-000000000011";
const PROD_P = "03800000-0000-7000-8000-000000000310";
const PROD_W = "03800000-0000-7000-8000-000000000320";
const RACE_P = "03800000-0000-7000-8000-000000000311";
const RACE_W = "03800000-0000-7000-8000-000000000321";
const RACE_C = "03800000-0000-7000-8000-000000000312";
const RACE_D = "03800000-0000-7000-8000-000000000322";
const RACE_E1 = "03800000-0000-7000-8000-000000000313";
const RACE_E2 = "03800000-0000-7000-8000-000000000314";

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
  const mkUrl = (db) => {
    const u = new URL(process.env.MIGRATION_DATABASE_URL);
    u.pathname = `/${db}`;
    return u.toString();
  };
  const db = new Client({ connectionString: mkUrl(dbName), connectionTimeoutMillis: 5000 });
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
  const loginRes = await fetch(`${baseUrl}/api/admin/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: STORE_EMAIL, password: STORE_PW }),
  });
  const setCookie = loginRes.headers.get("set-cookie") || "";
  const match = setCookie.match(/__Host-admin-session=([^;]+)/);
  const cookie = match ? `__Host-admin-session=${match[1]}` : null;
  if (loginRes.status !== 200 || !cookie) {
    console.error("REFUSED_LOGIN: store test user login failed");
    process.exit(1);
  }

  const invOf = async (v) =>
    (await q(`SELECT quantity::text qt, reserved_quantity::text rv, available_quantity::text av FROM inventory WHERE product_variant_id = $1`, [v]))[0];
  const resetVariant = async (v, qty) => {
    await db.query(`DELETE FROM inventory_movements WHERE product_variant_id = $1`, [v]);
    await db.query(`UPDATE inventory SET quantity = $2, reserved_quantity = 0 WHERE product_variant_id = $1`, [v, qty]);
  };
  const invariantsHold = async (v) => {
    const rows = await q(`SELECT count(*)::int AS n FROM inventory WHERE product_variant_id = $1
      AND (NOT (quantity = available_quantity + reserved_quantity) OR quantity < 0 OR reserved_quantity < 0 OR available_quantity < 0
        OR reserved_quantity > quantity)`, [v]);
    return rows[0].n === 0;
  };

  try {
    // ---------- setup ----------
    await db.query(`INSERT INTO categories (id, name, slug) VALUES ($1,'BA3 Race','ba3-race') ON CONFLICT (id) DO NOTHING`, [CAT]);
    await db.query(`INSERT INTO products (id, name, slug, category_id, product_type, unit) VALUES ($1,'BA3 Race Piece','ba3-race-piece',$2,'PIECE','PIECE') ON CONFLICT (id) DO NOTHING`, [PROD_P, CAT]);
    await db.query(`INSERT INTO products (id, name, slug, category_id, product_type, unit, sale_step_grams) VALUES ($1,'BA3 Race Weight','ba3-race-weight',$2,'WEIGHT','KG',125) ON CONFLICT (id) DO NOTHING`, [PROD_W, CAT]);
    for (const [vid, pid, nm, su] of [
      [RACE_P, PROD_P, "RP", "PIECE"], [RACE_C, PROD_P, "RC", "PIECE"],
      [RACE_E1, PROD_P, "RE1", "PIECE"], [RACE_E2, PROD_P, "RE2", "PIECE"],
      [RACE_W, PROD_W, "RW", "KG"], [RACE_D, PROD_W, "RD", "KG"],
    ]) {
      await db.query(`INSERT INTO product_variants (id, product_id, name, size_value, size_unit, price)
        VALUES ($1,$2,$3,1,$4,10.00) ON CONFLICT (id) DO NOTHING`, [vid, pid, nm, su]);
      await db.query(`INSERT INTO inventory (id, product_variant_id, quantity) VALUES (gen_random_uuid(),$1,0) ON CONFLICT DO NOTHING`, [vid]);
    }

    // ---------- Race A: same PIECE stock ----------
    await resetVariant(RACE_P, "1.000");
    const [a1, a2] = await Promise.all([
      post(`/api/admin/inventory/reserve`, { productVariantId: RACE_P, quantity: "1" }, cookie),
      post(`/api/admin/inventory/reserve`, { productVariantId: RACE_P, quantity: "1" }, cookie),
    ]);
    const aWins = [a1, a2].filter((r) => r.status === 201).length;
    const aLost = [a1, a2].filter((r) => r.status === 409).length;
    const aInv = await invOf(RACE_P);
    t("raceA-single-winner", aWins === 1 && aLost === 1, JSON.stringify([a1.status, a2.status]));
    t("raceA-no-oversell", aInv.rv === "1.000" && aInv.av === "0.000", JSON.stringify(aInv));
    t("raceA-invariants", await invariantsHold(RACE_P));
    t("raceA-no-movement", Number((await q(`SELECT count(*)::int AS n FROM inventory_movements WHERE product_variant_id = $1`, [RACE_P]))[0].n) === 0);

    // ---------- Race B: weighted stock ----------
    await resetVariant(RACE_W, "1.000");
    const [b1, b2] = await Promise.all([
      post(`/api/admin/inventory/reserve`, { productVariantId: RACE_W, quantity: "0.750" }, cookie),
      post(`/api/admin/inventory/reserve`, { productVariantId: RACE_W, quantity: "0.750" }, cookie),
    ]);
    const bWins = [b1, b2].filter((r) => r.status === 201).length;
    const bInv = await invOf(RACE_W);
    t("raceB-single-winner", bWins === 1, JSON.stringify([b1.status, b2.status]));
    t("raceB-state-valid", bInv.rv === "0.750" && bInv.av === "0.250", JSON.stringify(bInv));
    t("raceB-invariants", await invariantsHold(RACE_W));

    // ---------- Race C: over-reservation guard ----------
    await resetVariant(RACE_C, "5.000");
    const [c1, c2] = await Promise.all([
      post(`/api/admin/inventory/reserve`, { productVariantId: RACE_C, quantity: "3" }, cookie),
      post(`/api/admin/inventory/reserve`, { productVariantId: RACE_C, quantity: "3" }, cookie),
    ]);
    const cWins = [c1, c2].filter((r) => r.status === 201).length;
    const cInv = await invOf(RACE_C);
    t("raceC-single-winner", cWins === 1, JSON.stringify([c1.status, c2.status]));
    t("raceC-no-over-reserve", cInv.rv === "3.000", JSON.stringify(cInv));
    t("raceC-invariants", await invariantsHold(RACE_C));

    // ---------- Race D: double-commit (R3 held-release interaction) ----------
    await resetVariant(RACE_D, "2.000");
    await post(`/api/admin/inventory/reserve`, { productVariantId: RACE_D, quantity: "2.000" }, cookie);
    const refD = `BA3RACE-D-${Date.now()}`;
    const [d1, d2] = await Promise.all([
      post(`/api/admin/inventory/commit`, { productVariantId: RACE_D, requested: "2.000", actual: "2.000", referenceType: "MANUAL", referenceId: refD }, cookie),
      post(`/api/admin/inventory/commit`, { productVariantId: RACE_D, requested: "2.000", actual: "2.000", referenceType: "MANUAL", referenceId: refD }, cookie),
    ]);
    const dWins = [d1, d2].filter((r) => r.status === 201).length;
    const dLost = [d1, d2].filter((r) => r.status === 409).length;
    const dInv = await invOf(RACE_D);
    const dMov = Number((await q(`SELECT count(*)::int AS n FROM inventory_movements WHERE reference_id = $1 AND movement_type = 'SALE'`, [refD]))[0].n);
    t("raceD-single-winner", dWins === 1 && dLost === 1, JSON.stringify([d1.status, d2.status]));
    t("raceD-one-sale", dMov === 1);
    t("raceD-never-negative", dInv.qt === "0.000" && dInv.rv === "0.000" && dInv.av === "0.000", JSON.stringify(dInv));
    t("raceD-invariants", await invariantsHold(RACE_D));

    // ---------- Race E: multi-row ASC lock order (opposing input order) ----------
    await resetVariant(RACE_E1, "5.000");
    await resetVariant(RACE_E2, "5.000");
    const batchTx = async (pairs, tag) => {
      const c = new Client({ connectionString: mkUrl(dbName), connectionTimeoutMillis: 8000 });
      await c.connect();
      try {
        const ids = [...new Set(pairs.map((p) => p[0]))].sort(); // ASC (service orderLockIds)
        await c.query("BEGIN");
        for (const id of ids) await c.query(`SELECT 1 FROM inventory WHERE product_variant_id = $1 FOR UPDATE`, [id]);
        for (const id of ids) {
          const qty = pairs.find((p) => p[0] === id)[1];
          const r = await c.query(
            `UPDATE inventory SET reserved_quantity = reserved_quantity + $2::numeric
              WHERE product_variant_id = $1 AND (quantity - reserved_quantity) >= $2::numeric RETURNING 1`,
            [id, qty],
          );
          if (r.rowCount === 0) {
            await c.query("ROLLBACK");
            return { tag, ok: false };
          }
        }
        await c.query("COMMIT");
        return { tag, ok: true };
      } catch (e) {
        try { await c.query("ROLLBACK"); } catch { /* noop */ }
        return { tag, ok: false, err: String(e.code || e.message).slice(0, 30) };
      } finally {
        await c.end().catch(() => {});
      }
    };
    const [eA, eB] = await Promise.all([
      batchTx([[RACE_E1, "5"], [RACE_E2, "5"]], "A-forward"),
      batchTx([[RACE_E2, "5"], [RACE_E1, "5"]], "B-reversed"),
    ]);
    const eWins = [eA, eB].filter((r) => r.ok).length;
    const e1 = await invOf(RACE_E1);
    const e2 = await invOf(RACE_E2);
    t("raceE-no-deadlock", eA.err === undefined && eB.err === undefined, JSON.stringify([eA, eB]));
    t("raceE-single-full-winner", eWins === 1, JSON.stringify([eA, eB]));
    t("raceE-no-partial", e1.rv === "5.000" && e2.rv === "5.000", JSON.stringify([e1, e2]));
    t("raceE-invariants", (await invariantsHold(RACE_E1)) && (await invariantsHold(RACE_E2)));
  } finally {
    try {
      for (const v of [RACE_P, RACE_W, RACE_C, RACE_D, RACE_E1, RACE_E2]) {
        await db.query(`DELETE FROM inventory_movements WHERE product_variant_id = $1`, [v]).catch(() => {});
      }
      for (const v of [RACE_P, RACE_W, RACE_C, RACE_D, RACE_E1, RACE_E2]) {
        await db.query(`DELETE FROM inventory WHERE product_variant_id = $1`, [v]).catch(() => {});
      }
      for (const v of [RACE_P, RACE_W, RACE_C, RACE_D, RACE_E1, RACE_E2]) {
        await db.query(`DELETE FROM product_variants WHERE id = $1`, [v]).catch(() => {});
      }
      await db.query(`DELETE FROM products WHERE id IN ($1,$2)`, [PROD_P, PROD_W]).catch(() => {});
      await db.query(`DELETE FROM categories WHERE id = $1`, [CAT]).catch(() => {});
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
