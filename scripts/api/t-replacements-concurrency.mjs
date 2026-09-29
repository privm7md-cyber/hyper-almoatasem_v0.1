// BA-7 replacements concurrency suite (real PostgreSQL, scratch-only).
// Usage: node scripts/api/t-replacements-concurrency.mjs --db <name> --port <port>
// Only races between operations the frozen contract actually defines:
//   R1 double-approve: one materialization, single winner, loser 409.
//   R2 approve-vs-reject: one terminal outcome, loser 409, valid end state.
//   R3 double-propose: one PROPOSED (partial UQ), loser 409.
//   R4 cancel-vs-approve: either order wins coherently — no partial writes,
//     no deadlock, valid end state either way.
// (No READY-transition race exists: nothing targets READY in this scope.)
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
  console.log(JSON.stringify({ suite: "replacements-concurrency", db: dbName, total: results.length, failures: failures.length, failed: failures.map((f) => f.name), passed: results.filter((r) => r.pass).map((r) => r.name) }, null, 2));
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
const P_RACE = "01093000111";
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

  const get = async (path) => {
    const r = await fetch(`${baseUrl}${path}`);
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  // Storefront POSTs: guest bearer travels in x-guest-token.
  const post = async (path, data, token = null) => {
    const r = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { "x-guest-token": token } : {}) },
      body: JSON.stringify(data),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  // Admin POSTs: session cookie.
  const apost = async (path, data, cookie) => {
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
  const match = (loginRes.headers.get("set-cookie") || "").match(/__Host-admin-session=([^;]+)/);
  const cookie = match ? `__Host-admin-session=${match[1]}` : null;
  if (loginRes.status !== 200 || !cookie) {
    console.error("REFUSED_LOGIN: store test user login failed");
    process.exit(1);
  }

  const cartIds = new Set();
  const keySeq = { n: 0 };
  const key = (p) => `ba7r-${p}-${Date.now().toString(36)}-${keySeq.n++}`;
  const mkOrder = async (custId, addrId, lines, k) => {
    const g = await post(`/api/store/cart`, {});
    const tok = g.body.data.guestToken;
    cartIds.add(g.body.data.cart.id);
    for (const [vid, qty] of lines) await post(`/api/store/cart/items`, { productVariantId: vid, quantity: qty }, tok);
    const o = await post(`/api/store/orders`, { customerId: custId, addressId: addrId, idempotencyKey: k }, tok);
    return o.body?.data?.order;
  };
  const itemsOf = async (orderId, custId) =>
    (await get(`/api/store/orders/${orderId}?customerId=${custId}`)).body?.data?.order?.items ?? [];
  const repOf = async (orderId, custId) =>
    (await get(`/api/store/orders/${orderId}/replacements?customerId=${custId}`)).body?.data ?? [];

  try {
    const c1 = await post(`/api/store/customers/identify`, { phone: P_RACE, firstName: "Race" });
    const idC = c1.body.data.id;
    const a1 = await apost(`/api/admin/customers/${idC}/addresses`, { city: "Cairo", phone: P_RACE }, cookie);
    const idA = a1.body.data.id;

    // ---------- R1: double approve ----------
    const o1 = await mkOrder(idC, idA, [[P330, "2"]], key("r1"));
    const it1 = (await itemsOf(o1.id, idC)).find((i) => i.productVariantId === P330);
    const p1 = await apost(`/api/admin/orders/${o1.id}/items/${it1.id}/replacements`,
      { replacementVariantId: P1L, replacementQuantity: "1" }, cookie);
    const idR1 = p1.body.data.id;
    const decide = (action) =>
      post(`/api/store/orders/${o1.id}/replacements/${idR1}/decide`, { customerId: idC, action });
    const [r1a, r1b] = await Promise.all([decide("approve"), decide("approve")]);
    const r1 = [r1a.status, r1b.status].sort().join(",");
    t("raceApprove-single-winner", r1 === "200,409", JSON.stringify([r1a.status, r1b.status]));
    const afterR1 = await itemsOf(o1.id, idC);
    t("raceApprove-one-line", afterR1.filter((i) => i.productVariantId === P1L).length === 1);
    t("raceApprove-original-replaced", afterR1.find((i) => i.id === it1.id).itemStatus === "REPLACED");
    const repsR1 = await repOf(o1.id, idC);
    t("raceApprove-terminal", repsR1.find((x) => x.id === idR1).status === "CUSTOMER_APPROVED");
    const invR1 = await q(`SELECT reserved_quantity::text r FROM inventory WHERE product_variant_id = $1`, [P1L]);
    t("raceApprove-reserved-once", invR1[0].r === "1.000");

    // ---------- R2: approve vs reject ----------
    const o2 = await mkOrder(idC, idA, [[P330, "1"]], key("r2"));
    const it2 = (await itemsOf(o2.id, idC)).find((i) => i.productVariantId === P330);
    const p2 = await apost(`/api/admin/orders/${o2.id}/items/${it2.id}/replacements`,
      { replacementVariantId: P1L, replacementQuantity: "1" }, cookie);
    const idR2 = p2.body.data.id;
    const decide2 = (action) =>
      post(`/api/store/orders/${o2.id}/replacements/${idR2}/decide`, { customerId: idC, action });
    const [r2a, r2b] = await Promise.all([decide2("approve"), decide2("reject")]);
    const r2 = [r2a.status, r2b.status].sort().join(",");
    t("raceMixed-one-winner", r2 === "200,409", JSON.stringify([r2a.status, r2b.status]));
    const repsR2 = await repOf(o2.id, idC);
    const st2 = repsR2.find((x) => x.id === idR2).status;
    const itemsR2 = await itemsOf(o2.id, idC);
    const subLines = itemsR2.filter((i) => i.productVariantId === P1L).length;
    t("raceMixed-coherent", (st2 === "CUSTOMER_APPROVED") === (subLines === 1)
      && (st2 === "CUSTOMER_REJECTED") === (subLines === 0), st2);

    // ---------- R3: double propose ----------
    const o3 = await mkOrder(idC, idA, [[P330, "1"]], key("r3"));
    const it3 = (await itemsOf(o3.id, idC)).find((i) => i.productVariantId === P330);
    const prop = () =>
      apost(`/api/admin/orders/${o3.id}/items/${it3.id}/replacements`,
        { replacementVariantId: P1L, replacementQuantity: "1" }, cookie);
    const [r3a, r3b] = await Promise.all([prop(), prop()]);
    const r3 = [r3a.status, r3b.status].sort().join(",");
    t("racePropose-single-open", r3 === "201,409", JSON.stringify([r3a.status, r3b.status]));
    const liveCount = await q(`SELECT count(*)::int AS n FROM order_item_replacements
      WHERE order_item_id = $1 AND status = 'PROPOSED'`, [it3.id]);
    t("racePropose-one-row", Number(liveCount[0].n) === 1);

    // ---------- R4: cancel vs approve ----------
    const o4 = await mkOrder(idC, idA, [[P330, "1"]], key("r4"));
    const it4 = (await itemsOf(o4.id, idC)).find((i) => i.productVariantId === P330);
    const p4 = await apost(`/api/admin/orders/${o4.id}/items/${it4.id}/replacements`,
      { replacementVariantId: P1L, replacementQuantity: "1" }, cookie);
    const idR4 = p4.body.data.id;
    const [r4a, r4b] = await Promise.all([
      post(`/api/store/orders/${o4.id}/cancel`, { customerId: idC }),
      post(`/api/store/orders/${o4.id}/replacements/${idR4}/decide`, { customerId: idC, action: "approve" }),
    ]);
    const bothOk = r4a.status === 200 && r4b.status === 200;
    const cancelFirst = r4a.status === 200 && r4b.status === 409;
    t("raceCancelApprove-settles", bothOk || cancelFirst, JSON.stringify([r4a.status, r4b.status]));
    const o4row = await q(`SELECT status FROM orders WHERE id = $1`, [o4.id]);
    const o4items = await itemsOf(o4.id, idC);
    const o4reps = await repOf(o4.id, idC);
    const st4 = o4reps.find((x) => x.id === idR4).status;
    const coherent =
      (o4row[0].status === "CANCELLED" && st4 === "PROPOSED") ||
      (o4row[0].status === "CONFIRMED" && st4 === "CUSTOMER_APPROVED"
        && o4items.filter((i) => i.productVariantId === P1L).length === 1);
    t("raceCancelApprove-coherent", coherent, `${o4row[0].status}/${st4}`);
    const invP330 = await q(`SELECT reserved_quantity::text r FROM inventory WHERE product_variant_id = $1`, [P330]);
    const invP1L = await q(`SELECT reserved_quantity::text r FROM inventory WHERE product_variant_id = $1`, [P1L]);
    t("raceCancelApprove-no-leak", Number(invP330[0].r) >= 0 && Number(invP1L[0].r) >= 0
      && (await q(`SELECT count(*)::int AS n FROM inventory WHERE reserved_quantity < 0 OR reserved_quantity > quantity`))[0].n === 0);
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
        await db.query(`DELETE FROM order_item_replacements WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id = $1)`, [o.id]).catch(() => {});
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
