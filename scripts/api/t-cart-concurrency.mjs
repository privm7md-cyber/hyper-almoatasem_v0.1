// BA-5 cart concurrency suite (real PostgreSQL, scratch-only).
// Usage: node scripts/api/t-cart-concurrency.mjs --db <name> --port <port>
//   A: concurrent cart creation (one customer) -> one ACTIVE cart,
//      statuses {201,200}, identical ids (partial-UQ convergence).
//   B: concurrent add, same variant -> single line, qty = X+Y, one snapshot.
//   C: concurrent set-qty (3 vs 5) -> single valid line, value in {3,5}.
//   D: concurrent remove + set-qty -> consistent end state, no 500s.
//   E: concurrent merge (same guest+customer) -> one 200 + one 409,
//      lines materialized once, guest MERGED.
//   F: two guests create concurrently -> two distinct carts (no false
//      convergence).
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
  console.log(JSON.stringify({ suite: "cart-concurrency", db: dbName, total: results.length, failures: failures.length, failed: failures.map((f) => f.name), passed: results.filter((r) => r.pass).map((r) => r.name) }, null, 2));
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

const P330 = "01800000-0000-7000-8000-000000000201";
const ROMI_V = "01800000-0000-7000-8000-000000000101";
const P_RACE = "01091000111";
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

  const post = async (path, data, token = null) => {
    const r = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { "x-guest-token": token } : {}) },
      body: JSON.stringify(data),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const patch = async (path, data, token = null) => {
    const r = await fetch(`${baseUrl}${path}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...(token ? { "x-guest-token": token } : {}) },
      body: JSON.stringify(data),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const del = async (path, token = null) => {
    const r = await fetch(`${baseUrl}${path}`, {
      method: "DELETE",
      headers: token ? { "x-guest-token": token } : {},
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };

  const cartIds = new Set();
  const track = (body) => {
    const id = body?.data?.cart?.id;
    if (id) cartIds.add(id);
  };

  try {
    const rc = await post(`/api/store/customers/identify`, { phone: P_RACE, firstName: "Race" });
    const idC = rc.body.data.id;

    // ---------- Race A: concurrent creation ----------
    const [a1, a2] = await Promise.all([
      post(`/api/store/cart`, { customerId: idC }),
      post(`/api/store/cart`, { customerId: idC }),
    ]);
    track(a1.body);
    track(a2.body);
    const aStatuses = [a1.status, a2.status].sort().join(",");
    t("raceA-converge", aStatuses === "200,201", JSON.stringify([a1.status, a2.status]));
    t("raceA-same-id", a1.body?.data?.cart?.id !== undefined && a1.body.data.cart.id === a2.body.data.cart.id);
    const aRows = await q(`SELECT count(*)::int AS n FROM carts WHERE customer_id = $1 AND status = 'ACTIVE'`, [idC]);
    t("raceA-single-active", Number(aRows[0].n) === 1);

    // ---------- Race B: concurrent add same variant ----------
    const gB = await post(`/api/store/cart`, {});
    track(gB.body);
    const tokB = gB.body.data.guestToken;
    const [b1, b2] = await Promise.all([
      post(`/api/store/cart/items`, { productVariantId: P330, quantity: "2" }, tokB),
      post(`/api/store/cart/items`, { productVariantId: P330, quantity: "3" }, tokB),
    ]);
    track(b1.body);
    track(b2.body);
    t("raceB-both-ok", b1.status === 200 && b2.status === 200, JSON.stringify([b1.status, b2.status]));
    const bLines = await q(`SELECT quantity::text qt, count(*) OVER () AS n FROM cart_items
      WHERE cart_id = $1 AND product_variant_id = $2`, [gB.body.data.cart.id, P330]);
    t("raceB-single-summed-line", bLines.length === 1 && bLines[0].qt === "5.000" && bLines[0].n === "1",
      JSON.stringify(bLines));

    // ---------- Race C: concurrent set-qty ----------
    const [c1, c2] = await Promise.all([
      patch(`/api/store/cart/items/${P330}`, { quantity: "3" }, tokB),
      patch(`/api/store/cart/items/${P330}`, { quantity: "5" }, tokB),
    ]);
    t("raceC-both-ok", c1.status === 200 && c2.status === 200, JSON.stringify([c1.status, c2.status]));
    const cLine = await q(`SELECT quantity::text qt FROM cart_items WHERE cart_id = $1 AND product_variant_id = $2`,
      [gB.body.data.cart.id, P330]);
    t("raceC-single-valid", cLine.length === 1 && (cLine[0].qt === "3.000" || cLine[0].qt === "5.000"),
      JSON.stringify(cLine));

    // ---------- Race D: remove vs set-qty ----------
    const [d1, d2] = await Promise.all([
      del(`/api/store/cart/items/${P330}`, tokB),
      patch(`/api/store/cart/items/${P330}`, { quantity: "7" }, tokB),
    ]);
    const dStatuses = [d1.status, d2.status].sort().join(",");
    t("raceD-no-500", dStatuses !== "500,500" && !dStatuses.includes("500"), JSON.stringify([d1.status, d2.status]));
    const dLine = await q(`SELECT quantity::text qt FROM cart_items WHERE cart_id = $1 AND product_variant_id = $2`,
      [gB.body.data.cart.id, P330]);
    const dOk = dLine.length === 0 || (dLine.length === 1 && dLine[0].qt === "7.000");
    t("raceD-consistent", dOk, JSON.stringify(dLine));

    // ---------- Race E: concurrent merge ----------
    const gE = await post(`/api/store/cart`, {});
    track(gE.body);
    const tokE = gE.body.data.guestToken;
    await post(`/api/store/cart/items`, { productVariantId: ROMI_V, quantity: "0.250" }, tokE);
    const [e1, e2] = await Promise.all([
      post(`/api/store/cart/merge`, { customerId: idC }, tokE),
      post(`/api/store/cart/merge`, { customerId: idC }, tokE),
    ]);
    track(e1.body);
    track(e2.body);
    const eStatuses = [e1.status, e2.status].sort().join(",");
    t("raceE-single-winner", eStatuses === "200,409", JSON.stringify([e1.status, e2.status]));
    const eGuestStatus = await q(`SELECT status FROM carts WHERE id = $1`, [gE.body.data.cart.id]);
    t("raceE-guest-merged", eGuestStatus[0].status === "MERGED");
    const eCount = await q(`SELECT count(*)::int AS n FROM cart_items ci JOIN carts c ON c.id = ci.cart_id
      WHERE c.customer_id = $1 AND c.status = 'ACTIVE' AND ci.product_variant_id = $2`, [idC, ROMI_V]);
    t("raceE-materialized-once", Number(eCount[0].n) === 1, JSON.stringify(eCount));

    // ---------- Race F: distinct guests stay distinct ----------
    const [f1, f2] = await Promise.all([
      post(`/api/store/cart`, {}),
      post(`/api/store/cart`, {}),
    ]);
    track(f1.body);
    track(f2.body);
    t("raceF-distinct", f1.status === 201 && f2.status === 201
      && f1.body.data.cart.id !== f2.body.data.cart.id
      && f1.body.data.guestToken !== f2.body.data.guestToken);
  } finally {
    try {
      for (const id of cartIds) {
        await db.query(`DELETE FROM cart_items WHERE cart_id = $1`, [id]).catch(() => {});
        await db.query(`DELETE FROM carts WHERE id = $1`, [id]).catch(() => {});
      }
      const rows = await db.query(`SELECT id FROM customers WHERE phone = $1`, [CANON(P_RACE)]).catch(() => ({ rows: [] }));
      for (const r of rows.rows) {
        await db.query(`DELETE FROM cart_items WHERE cart_id IN (SELECT id FROM carts WHERE customer_id = $1)`, [r.id]).catch(() => {});
        await db.query(`DELETE FROM carts WHERE customer_id = $1`, [r.id]).catch(() => {});
      }
      await db.query(`DELETE FROM customers WHERE phone = $1`, [CANON(P_RACE)]).catch(() => {});
    } catch { /* scratch hygiene best-effort */ }
    await db.end().catch(() => {});
  }
  done();
}

main().catch((e) => {
  console.error(`RACE_SUITE_FAILED: ${e.constructor.name}: ${String(e.message).slice(0, 200)}`);
  process.exit(1);
});
