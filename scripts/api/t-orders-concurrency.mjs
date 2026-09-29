// BA-6 orders concurrency suite (real PostgreSQL, scratch-only).
// Usage: node scripts/api/t-orders-concurrency.mjs --db <name> --port <port>
//   Race A: one stock unit, two carts -> one 201 + one 409, reserved = 1,
//     no over-reservation, loser leaves no order.
//   Race B: multi-item overlap (reversed line order) -> no deadlock; ample
//     stock lets both through; tight stock yields a single complete winner
//     (no partial reservation, winner holds both lines).
//   Race C: same idempotency key concurrently -> one order id, {201,200},
//     reservation counted once.
//   Race D: same cart concurrently -> one order {201,200 replay},
//     cart CHECKED_OUT once, single reservation set.
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
  console.log(JSON.stringify({ suite: "orders-concurrency", db: dbName, total: results.length, failures: failures.length, failed: failures.map((f) => f.name), passed: results.filter((r) => r.pass).map((r) => r.name) }, null, 2));
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
const P_RACE = "01092000111";
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

  const cartIds = new Set();
  const trackCart = (body) => {
    const id = body?.data?.cart?.id;
    if (id) cartIds.add(id);
  };
  const reservedOf = async (v) =>
    (await q(`SELECT reserved_quantity::text r FROM inventory WHERE product_variant_id = $1`, [v]))[0].r;
  const mkCart = async (lines) => {
    const g = await post(`/api/store/cart`, {});
    trackCart(g.body);
    const tok = g.body.data.guestToken;
    for (const [vid, qty] of lines) await post(`/api/store/cart/items`, { productVariantId: vid, quantity: qty }, tok);
    return { id: g.body.data.cart.id, token: tok };
  };
  const ordersForKeys = async (keys) =>
    q(`SELECT id, idempotency_key AS k FROM orders WHERE idempotency_key = ANY($1)`, [keys]);

  try {
    const rc = await post(`/api/store/customers/identify`, { phone: P_RACE, firstName: "Race" });
    const idC = rc.body.data.id;
    const ad = await q(`INSERT INTO customer_addresses (id, customer_id, city, phone, is_default)
      VALUES (gen_random_uuid(), $1, 'Cairo', $2, TRUE) RETURNING id`, [idC, CANON(P_RACE)]);
    const idA = ad[0].id;

    // ---------- Race A: last unit ----------
    await db.query(`UPDATE inventory SET quantity = 1.000, reserved_quantity = 0 WHERE product_variant_id = $1`, [P330]);
    const ra1 = await mkCart([[P330, "1"]]);
    const ra2 = await mkCart([[P330, "1"]]);
    const [a1, a2] = await Promise.all([
      post(`/api/store/orders`, { customerId: idC, addressId: idA, idempotencyKey: "ba6r-a-1" }, ra1.token),
      post(`/api/store/orders`, { customerId: idC, addressId: idA, idempotencyKey: "ba6r-a-2" }, ra2.token),
    ]);
    const aStatuses = [a1.status, a2.status].sort().join(",");
    t("raceA-single-winner", aStatuses === "201,409", JSON.stringify([a1.status, a2.status]));
    t("raceA-reserved-one", (await reservedOf(P330)) === "1.000");
    const aRows = await ordersForKeys(["ba6r-a-1", "ba6r-a-2"]);
    t("raceA-no-losers-order", aRows.length === 1);
    await db.query(`UPDATE inventory SET quantity = 500.000, reserved_quantity = 0 WHERE product_variant_id = $1`, [P330]);

    // ---------- Race B: multi-item overlap, ample stock ----------
    const rb1 = await mkCart([[P330, "1"], [ROMI_V, "0.250"]]);
    const rb2 = await mkCart([[ROMI_V, "0.250"], [P330, "1"]]);
    const [b1, b2] = await Promise.all([
      post(`/api/store/orders`, { customerId: idC, addressId: idA, idempotencyKey: "ba6r-b-1" }, rb1.token),
      post(`/api/store/orders`, { customerId: idC, addressId: idA, idempotencyKey: "ba6r-b-2" }, rb2.token),
    ]);
    t("raceB-no-deadlock", b1.status === 201 && b2.status === 201, JSON.stringify([b1.status, b2.status]));
    // Tight stock: exactly one complete winner, no partial reservation.
    await db.query(`UPDATE inventory SET quantity = 0.500, reserved_quantity = 0 WHERE product_variant_id = $1`, [ROMI_V]);
    const rb3 = await mkCart([[P330, "1"], [ROMI_V, "0.500"]]);
    const rb4 = await mkCart([[ROMI_V, "0.500"], [P330, "1"]]);
    const [b3, b4] = await Promise.all([
      post(`/api/store/orders`, { customerId: idC, addressId: idA, idempotencyKey: "ba6r-b-3" }, rb3.token),
      post(`/api/store/orders`, { customerId: idC, addressId: idA, idempotencyKey: "ba6r-b-4" }, rb4.token),
    ]);
    const bStatuses = [b3.status, b4.status].sort().join(",");
    t("raceB-tight-single-winner", bStatuses === "201,409", JSON.stringify([b3.status, b4.status]));
    const winner = b3.status === 201 ? b3 : b4;
    t("raceB-winner-complete", winner.body.data.order.items.length === 2);
    const bRows = await ordersForKeys(["ba6r-b-3", "ba6r-b-4"]);
    t("raceB-no-partial", bRows.length === 1 && (await reservedOf(ROMI_V)) === "0.500");
    await db.query(`UPDATE inventory SET quantity = 47.350, reserved_quantity = 0 WHERE product_variant_id = $1`, [ROMI_V]);

    // ---------- Race C: duplicate idempotency key ----------
    const rc1 = await mkCart([[P330, "1"]]);
    const resBeforeC = await reservedOf(P330);
    const [c1, c2] = await Promise.all([
      post(`/api/store/orders`, { customerId: idC, addressId: idA, idempotencyKey: "ba6r-c-1" }, rc1.token),
      post(`/api/store/orders`, { customerId: idC, addressId: idA, idempotencyKey: "ba6r-c-1" }, rc1.token),
    ]);
    const cStatuses = [c1.status, c2.status].sort().join(",");
    t("raceC-one-order", cStatuses === "200,201", JSON.stringify([c1.status, c2.status]));
    t("raceC-same-id", c1.body?.data?.order?.id !== undefined && c1.body.data.order.id === c2.body.data.order.id);
    const cRows = await ordersForKeys(["ba6r-c-1"]);
    t("raceC-single-row", cRows.length === 1);
    t("raceC-single-reserve", Number(await reservedOf(P330)) - Number(resBeforeC) === 1);

    // ---------- Race D: same cart twice ----------
    const rd1 = await mkCart([[P330, "2"]]);
    const resBeforeD = await reservedOf(P330);
    const [d1, d2] = await Promise.all([
      post(`/api/store/orders`, { customerId: idC, addressId: idA, idempotencyKey: "ba6r-d-1" }, rd1.token),
      post(`/api/store/orders`, { customerId: idC, addressId: idA, idempotencyKey: "ba6r-d-2" }, rd1.token),
    ]);
    const dStatuses = [d1.status, d2.status].sort().join(",");
    t("raceD-one-order", dStatuses === "200,201", JSON.stringify([d1.status, d2.status]));
    t("raceD-same-id", d1.body?.data?.order?.id !== undefined && d1.body.data.order.id === d2.body.data.order.id);
    const dCart = await q(`SELECT status FROM carts WHERE id = $1`, [rd1.id]);
    t("raceD-checked-out-once", dCart[0].status === "CHECKED_OUT");
    t("raceD-single-reserve", Number(await reservedOf(P330)) - Number(resBeforeD) === 2);
  } finally {
    try {
      const ordRows = await db.query(
        `SELECT o.id FROM orders o JOIN customers c ON c.id = o.customer_id WHERE c.phone = $1`, [CANON(P_RACE)],
      ).catch(() => ({ rows: [] }));
      for (const o of ordRows.rows) {
        const items = await db.query(`SELECT product_variant_id, requested_quantity FROM order_items WHERE order_id = $1`, [o.id]).catch(() => ({ rows: [] }));
        for (const it of items.rows) {
          await db.query(`UPDATE inventory SET reserved_quantity = reserved_quantity - $2 WHERE product_variant_id = $1`,
            [it.product_variant_id, it.requested_quantity]).catch(() => {});
        }
        await db.query(`DELETE FROM order_status_history WHERE order_id = $1`, [o.id]).catch(() => {});
        await db.query(`DELETE FROM order_items WHERE order_id = $1`, [o.id]).catch(() => {});
        await db.query(`DELETE FROM orders WHERE id = $1`, [o.id]).catch(() => {});
      }
      for (const id of cartIds) {
        await db.query(`DELETE FROM cart_items WHERE cart_id = $1`, [id]).catch(() => {});
        await db.query(`DELETE FROM carts WHERE id = $1`, [id]).catch(() => {});
      }
      const cust = await db.query(`SELECT id FROM customers WHERE phone = $1`, [CANON(P_RACE)]).catch(() => ({ rows: [] }));
      for (const r of cust.rows) {
        await db.query(`DELETE FROM customer_addresses WHERE customer_id = $1`, [r.id]).catch(() => {});
        const cc = await db.query(`SELECT id FROM carts WHERE customer_id = $1`, [r.id]).catch(() => ({ rows: [] }));
        for (const c of cc.rows) {
          await db.query(`DELETE FROM cart_items WHERE cart_id = $1`, [c.id]).catch(() => {});
          await db.query(`DELETE FROM carts WHERE id = $1`, [c.id]).catch(() => {});
        }
      }
      await db.query(`DELETE FROM customers WHERE phone = $1`, [CANON(P_RACE)]).catch(() => {});
      // Fixture stock restore (exact seed values, zero reservation).
      await db.query(`UPDATE inventory SET quantity = 500.000, reserved_quantity = 0 WHERE product_variant_id = $1`, [P330]).catch(() => {});
      await db.query(`UPDATE inventory SET quantity = 47.350, reserved_quantity = 0 WHERE product_variant_id = $1`, [ROMI_V]).catch(() => {});
    } catch { /* scratch hygiene best-effort */ }
    await db.end().catch(() => {});
  }
  done();
}

main().catch((e) => {
  console.error(`RACE_SUITE_FAILED: ${e.constructor.name}: ${String(e.message).slice(0, 200)}`);
  process.exit(1);
});
