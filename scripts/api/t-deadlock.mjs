// BA-10 deadlock suite (real PostgreSQL, scratch-only).
// Usage: node scripts/api/t-deadlock.mjs --db <name> --port <port>
// Opposing lock-order patterns, all under READ COMMITTED (never
// SERIALIZABLE, no app mutexes). Proves: deterministic ASC ordering,
// clean termination (no hangs), no deadlock errors, coherent outcomes.
//   D1 opposed multi-line checkouts x5 (reversed line order, ample stock):
//     every checkout 201, no error mentions deadlock.
//   D2 order-vs-approval on one shared unit x5: single winner per round
//     (201/200 vs 409), holds coherent, no 500s.
// Any PostgreSQL 40P01/deadlock word in any response fails the suite.
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
  console.log(JSON.stringify({ suite: "deadlock", db: dbName, total: results.length, failures: failures.length, failed: failures.map((f) => f.name), passed: results.filter((r) => r.pass).map((r) => r.name) }, null, 2));
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
const P1L = "01800000-0000-7000-8000-000000000202";
const P_C1 = "01098000011";
const P_C2 = "01098000022";
const CANON = (p) => "2010" + p.slice(3);
const STORE_EMAIL = "store-cat-test@example.com";
const STORE_PW = "Cat-Test-Store-Pass-0002!";

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
    const body = await r.json().catch(() => ({}));
    return { status: r.status, body };
  };
  const loginAs = async (email, password) => {
    const r = await fetch(`${baseUrl}/api/admin/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const m = (r.headers.get("set-cookie") || "").match(/__Host-admin-session=([^;]+)/);
    return { status: r.status, cookie: m ? `__Host-admin-session=${m[1]}` : null };
  };

  const cartIds = new Set();
  const keySeq = { n: 0 };
  const key = (p) => `ba10d-${p}-${Date.now().toString(36)}-${keySeq.n++}`;
  const mkCart = async (lines) => {
    const g = await post(`/api/store/cart`, {});
    const tok = g.body.data.guestToken;
    cartIds.add(g.body.data.cart.id);
    for (const [vid, qty] of lines) {
      await post(`/api/store/cart/items`, { productVariantId: vid, quantity: qty }, tok);
    }
    return tok;
  };
  const deadlocked = (results) =>
    results.some((r) => r.status === 500 || JSON.stringify(r.body).toLowerCase().includes("deadlock"));

  try {
    const store = await loginAs(STORE_EMAIL, STORE_PW);
    if (store.status !== 201 || !store.cookie) {
      console.error(`REFUSED_LOGIN: store=${store.status}`);
      process.exit(1);
    }
    const ck = store.cookie;
    const admPost = async (path, data) => {
      const r = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ck },
        body: JSON.stringify(data),
      });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    };
    const c1 = await post(`/api/store/customers/identify`, { phone: P_C1, firstName: "Dead1" });
    const c2 = await post(`/api/store/customers/identify`, { phone: P_C2, firstName: "Dead2" });
    const idC1 = c1.body.data.id;
    const idC2 = c2.body.data.id;
    const a1 = await admPost(`/api/admin/customers/${idC1}/addresses`, { city: "Cairo", phone: P_C1 });
    const a2 = await admPost(`/api/admin/customers/${idC2}/addresses`, { city: "Giza", phone: P_C2 });
    const idA1 = a1.body.data.id;
    const idA2 = a2.body.data.id;
    const orderAs = (custId, addrId, tok, k) =>
      post(`/api/store/orders`, { customerId: custId, addressId: addrId, idempotencyKey: k }, tok);

    // ---------- D1: opposed multi-line checkouts x5 ----------
    let d1ok = true;
    for (let i = 0; i < 5; i++) {
      const t1 = await mkCart([[P330, "1"], [P1L, "1"]]);
      const t2 = await mkCart([[P1L, "1"], [P330, "1"]]);
      const started = Date.now();
      const [d1, d2] = await Promise.all([
        orderAs(idC1, idA1, t1, key(`d1a-${i}`)),
        orderAs(idC2, idA2, t2, key(`d1b-${i}`)),
      ]);
      const elapsed = Date.now() - started;
      if (d1.status !== 201 || d2.status !== 201 || deadlocked([d1, d2]) || elapsed > 30000) {
        d1ok = false;
        console.error(`TMP d1 iter ${i}:`, d1.status, d2.status, `${elapsed}ms`);
      }
    }
    t("deadlock-opposed-checkouts", d1ok);

    // ---------- D2: order vs approval on one shared unit x5 ----------
    let d2ok = true;
    for (let i = 0; i < 5; i++) {
      await db.query(`UPDATE inventory SET quantity = 1.000, reserved_quantity = 0 WHERE product_variant_id = $1`, [P1L]);
      const tOrder = await mkCart([[P1L, "1"]]);
      const gRep = await mkCart([[P330, "1"]]);
      const ro = await orderAs(idC1, idA1, gRep, key(`d2o-${i}`));
      const items = (await fetch(`${baseUrl}/api/store/orders/${ro.body.data.order.id}?customerId=${idC1}`).then((r) => r.json())).data.order.items;
      const rp = await admPost(`/api/admin/orders/${ro.body.data.order.id}/items/${items[0].id}/replacements`,
        { replacementVariantId: P1L, replacementQuantity: "1" });
      const [a, b] = await Promise.all([
        post(`/api/store/orders/${ro.body.data.order.id}/replacements/${rp.body.data.id}/decide`, { customerId: idC1, action: "approve" }),
        orderAs(idC2, idA2, tOrder, key(`d2c-${i}`)),
      ]);
      const pair = [a.status, b.status].sort().join(",");
      const inv = await q(`SELECT reserved_quantity::text r, quantity::text qq FROM inventory WHERE product_variant_id = $1`, [P1L]);
      const coherent =
        (pair === "200,201" || pair === "200,409" || pair === "201,409") &&
        !deadlocked([a, b]) && inv[0].r === "1.000" && inv[0].qq === "1.000";
      if (!coherent) {
        d2ok = false;
        console.error(`TMP d2 iter ${i}:`, a.status, b.status, JSON.stringify(inv[0]));
      }
    }
    t("deadlock-order-vs-approve", d2ok);
    await db.query(`UPDATE inventory SET quantity = 300.000, reserved_quantity = 0 WHERE product_variant_id = $1`, [P1L]);
  } finally {
    try {
      const ordRows = await db.query(
        `SELECT o.id FROM orders o JOIN customers c ON c.id = o.customer_id WHERE c.phone IN ($1,$2)`, [CANON(P_C1), CANON(P_C2)],
      ).catch(() => ({ rows: [] }));
      for (const o of ordRows.rows) {
        const items = await db.query(`SELECT product_variant_id, requested_quantity FROM order_items WHERE order_id = $1`, [o.id]).catch(() => ({ rows: [] }));
        for (const it of items.rows) {
          await db.query(`UPDATE inventory SET reserved_quantity = reserved_quantity - $2 WHERE product_variant_id = $1`,
            [it.product_variant_id, it.requested_quantity]).catch(() => {});
        }
        await db.query(`DELETE FROM order_discounts WHERE order_id = $1`, [o.id]).catch(() => {});
        await db.query(`DELETE FROM coupon_usages WHERE order_id = $1`, [o.id]).catch(() => {});
        await db.query(`DELETE FROM order_item_replacements WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id = $1)`, [o.id]).catch(() => {});
        await db.query(`DELETE FROM order_status_history WHERE order_id = $1`, [o.id]).catch(() => {});
        await db.query(`DELETE FROM order_items WHERE order_id = $1`, [o.id]).catch(() => {});
        await db.query(`DELETE FROM orders WHERE id = $1`, [o.id]).catch(() => {});
      }
      for (const id of cartIds) {
        await db.query(`DELETE FROM cart_items WHERE cart_id = $1`, [id]).catch(() => {});
        await db.query(`DELETE FROM carts WHERE id = $1`, [id]).catch(() => {});
      }
      for (const ph of [P_C1, P_C2].map(CANON)) {
        const rows = await db.query(`SELECT id FROM customers WHERE phone = $1`, [ph]).catch(() => ({ rows: [] }));
        for (const r of rows.rows) {
          await db.query(`DELETE FROM customer_addresses WHERE customer_id = $1`, [r.id]).catch(() => {});
          const cc = await db.query(`SELECT id FROM carts WHERE customer_id = $1`, [r.id]).catch(() => ({ rows: [] }));
          for (const c of cc.rows) {
            await db.query(`DELETE FROM cart_items WHERE cart_id = $1`, [c.id]).catch(() => {});
            await db.query(`DELETE FROM carts WHERE id = $1`, [c.id]).catch(() => {});
          }
        }
      }
      for (const ph of [P_C1, P_C2].map(CANON)) {
        await db.query(`DELETE FROM customers WHERE phone = $1`, [ph]).catch(() => {});
      }
      await db.query(`DELETE FROM admin_sessions WHERE user_id = (SELECT id FROM users WHERE email = $1)`, [STORE_EMAIL]).catch(() => {});
      await db.query(`UPDATE inventory SET quantity = 300.000, reserved_quantity = 0 WHERE product_variant_id = $1`, [P1L]).catch(() => {});
    } catch { /* scratch hygiene best-effort */ }
    await db.end().catch(() => {});
  }
  done();
}

main().catch((e) => {
  console.error(`DEADLOCK_SUITE_FAILED: ${e.constructor.name}: ${String(e.message).slice(0, 200)}`);
  console.error(String(e.stack).split("\n").slice(0, 4).join(" | "));
  process.exit(1);
});
