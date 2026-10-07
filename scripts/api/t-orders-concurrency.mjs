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

  const post = async (path, data, token = null, extra = {}) => {
    const r = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { "x-guest-token": token } : {}), ...extra },
      body: JSON.stringify(data),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };

  const H = (tok) => ({ "x-customer-token": tok });
  const CPW = "Cust-Test-Pass-0001!";
  const sess = async (phone, firstName) => {
    // PHASE 2.5: register (fresh → 201 + session) or login (existing → 200).
    const reg = await post(`/api/store/customers/register`, { phone, firstName, password: CPW });
    if (reg.status === 201) {
      return { id: reg.body?.data?.customer?.id ?? null, tok: reg.body?.data?.customerToken ?? null };
    }
    const r = await post(`/api/store/customers/session`, { phone, password: CPW });
    return { id: r.body?.data?.customer?.id ?? null, tok: r.body?.data?.customerToken ?? null };
  };
  const newCust = async (phone, firstName) => {
    const s = await sess(phone, firstName);
    const a = await post(`/api/store/customers/addresses`, { city: "Cairo", phone }, null, H(s.tok));
    return { id: s.id, tok: s.tok, addr: a.body?.data?.id ?? null };
  };
  const mergeTo = async (guestToken, sessTok) =>
    post(`/api/store/cart/merge`, {}, guestToken, H(sessTok));

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
    const orderAs = (sessTok, addrId, k) =>
      post(`/api/store/orders`, { addressId: addrId, idempotencyKey: k }, null, H(sessTok));

    // ---------- Race A: last unit (isolated customers, opposed carts) ----------
    await db.query(`UPDATE inventory SET quantity = 1.000, reserved_quantity = 0 WHERE product_variant_id = $1`, [P330]);
    const ncA1 = await newCust("01098000011", "RaceA1");
    const ncA2 = await newCust("01098000012", "RaceA2");
    const ra1 = await mkCart([[P330, "1"]]);
    const ra2 = await mkCart([[P330, "1"]]);
    await mergeTo(ra1.token, ncA1.tok);
    await mergeTo(ra2.token, ncA2.tok);
    const [a1, a2] = await Promise.all([
      orderAs(ncA1.tok, ncA1.addr, "ba6r-a-1"),
      orderAs(ncA2.tok, ncA2.addr, "ba6r-a-2"),
    ]);
    const aStatuses = [a1.status, a2.status].sort().join(",");
    t("raceA-single-winner", aStatuses === "201,409", JSON.stringify([a1.status, a2.status]));
    t("raceA-reserved-one", (await reservedOf(P330)) === "1.000");
    const aRows = await ordersForKeys(["ba6r-a-1", "ba6r-a-2"]);
    t("raceA-no-losers-order", aRows.length === 1);
    await db.query(`UPDATE inventory SET quantity = 500.000, reserved_quantity = 0 WHERE product_variant_id = $1`, [P330]);

    // ---------- Race B: multi-item overlap, ample stock ----------
    const ncB1 = await newCust("01098000021", "RaceB1");
    const ncB2 = await newCust("01098000022", "RaceB2");
    const rb1 = await mkCart([[P330, "1"], [ROMI_V, "0.250"]]);
    const rb2 = await mkCart([[ROMI_V, "0.250"], [P330, "1"]]);
    await mergeTo(rb1.token, ncB1.tok);
    await mergeTo(rb2.token, ncB2.tok);
    const [b1, b2] = await Promise.all([
      orderAs(ncB1.tok, ncB1.addr, "ba6r-b-1"),
      orderAs(ncB2.tok, ncB2.addr, "ba6r-b-2"),
    ]);
    t("raceB-no-deadlock", b1.status === 201 && b2.status === 201, JSON.stringify([b1.status, b2.status]));
    // Tight stock: exactly one complete winner, no partial reservation.
    await db.query(`UPDATE inventory SET quantity = 0.500, reserved_quantity = 0 WHERE product_variant_id = $1`, [ROMI_V]);
    const ncB3 = await newCust("01098000023", "RaceB3");
    const ncB4 = await newCust("01098000024", "RaceB4");
    const rb3 = await mkCart([[P330, "1"], [ROMI_V, "0.500"]]);
    const rb4 = await mkCart([[ROMI_V, "0.500"], [P330, "1"]]);
    await mergeTo(rb3.token, ncB3.tok);
    await mergeTo(rb4.token, ncB4.tok);
    const [b3, b4] = await Promise.all([
      orderAs(ncB3.tok, ncB3.addr, "ba6r-b-3"),
      orderAs(ncB4.tok, ncB4.addr, "ba6r-b-4"),
    ]);
    const bStatuses = [b3.status, b4.status].sort().join(",");
    t("raceB-tight-single-winner", bStatuses === "201,409", JSON.stringify([b3.status, b4.status]));
    const winner = b3.status === 201 ? b3 : b4;
    t("raceB-winner-complete", winner.body.data.order.items.length === 2);
    const bRows = await ordersForKeys(["ba6r-b-3", "ba6r-b-4"]);
    t("raceB-no-partial", bRows.length === 1 && (await reservedOf(ROMI_V)) === "0.500");
    await db.query(`UPDATE inventory SET quantity = 47.350, reserved_quantity = 0 WHERE product_variant_id = $1`, [ROMI_V]);

    // ---------- Race C: duplicate idempotency key ----------
    const ncC = await newCust("01098000031", "RaceC");
    const rc1 = await mkCart([[P330, "1"]]);
    await mergeTo(rc1.token, ncC.tok);
    const resBeforeC = await reservedOf(P330);
    const [c1, c2] = await Promise.all([
      orderAs(ncC.tok, ncC.addr, "ba6r-c-1"),
      orderAs(ncC.tok, ncC.addr, "ba6r-c-1"),
    ]);
    const cStatuses = [c1.status, c2.status].sort().join(",");
    t("raceC-one-order", cStatuses === "200,201", JSON.stringify([c1.status, c2.status]));
    t("raceC-same-id", c1.body?.data?.order?.id !== undefined && c1.body.data.order.id === c2.body.data.order.id);
    const cRows = await ordersForKeys(["ba6r-c-1"]);
    t("raceC-single-row", cRows.length === 1);
    t("raceC-single-reserve", Number(await reservedOf(P330)) - Number(resBeforeC) === 1);

    // ---------- Race D: same cart twice ----------
    const ncD = await newCust("01098000032", "RaceD");
    const rd1 = await mkCart([[P330, "2"]]);
    await mergeTo(rd1.token, ncD.tok);
    const resBeforeD = await reservedOf(P330);
    const [d1, d2] = await Promise.all([
      orderAs(ncD.tok, ncD.addr, "ba6r-d-1"),
      orderAs(ncD.tok, ncD.addr, "ba6r-d-2"),
    ]);
    const dStatuses = [d1.status, d2.status].sort().join(",");
    t("raceD-one-order", dStatuses === "200,201", JSON.stringify([d1.status, d2.status]));
    t("raceD-same-id", d1.body?.data?.order?.id !== undefined && d1.body.data.order.id === d2.body.data.order.id);
    const dCart = await q(`SELECT status FROM carts WHERE id = $1`, [rd1.id]);
    t("raceD-checked-out-once", dCart[0].status === "CHECKED_OUT");
    t("raceD-single-reserve", Number(await reservedOf(P330)) - Number(resBeforeD) === 2);
  } finally {
    try {
      const RACE_PHONES = [P_RACE, "01098000011", "01098000012", "01098000021", "01098000022", "01098000023", "01098000024", "01098000031", "01098000032"];
      const ordRows = await db.query(
        `SELECT o.id FROM orders o JOIN customers c ON c.id = o.customer_id WHERE c.phone = ANY($1)`, [RACE_PHONES.map(CANON)],
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
      const cust = await db.query(`SELECT id FROM customers WHERE phone = ANY($1)`, [RACE_PHONES.map(CANON)]).catch(() => ({ rows: [] }));
      for (const r of cust.rows) {
        await db.query(`DELETE FROM customer_sessions WHERE customer_id = $1`, [r.id]).catch(() => {});
        await db.query(`DELETE FROM customer_addresses WHERE customer_id = $1`, [r.id]).catch(() => {});
        const cc = await db.query(`SELECT id FROM carts WHERE customer_id = $1`, [r.id]).catch(() => ({ rows: [] }));
        for (const c of cc.rows) {
          await db.query(`DELETE FROM cart_items WHERE cart_id = $1`, [c.id]).catch(() => {});
          await db.query(`DELETE FROM carts WHERE id = $1`, [c.id]).catch(() => {});
        }
      }
      await db.query(`DELETE FROM customers WHERE phone = ANY($1)`, [RACE_PHONES.map(CANON)]).catch(() => {});
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
