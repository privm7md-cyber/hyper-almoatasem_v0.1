// BA-8 promotions concurrency suite (real PostgreSQL, scratch-only).
// Usage: node scripts/api/t-promotions-concurrency.mjs --db <name> --port <port>
//   R1 coupon last-usage (global limit 1, two customers) -> one 201 + one
//     409, used_count 1, exactly one usage row (frozen single-winner).
//   R2 per-customer double-submit (same customer, two carts) -> one 201 +
//     one 422, single usage (row-lock serialization).
//   R3 limited-auto SKIP race (usage_limit 1, no coupon) -> both 201, one
//     discounted + one full-price, used_count 1 (exhaustion skips).
//   R4 rollback atomicity (coupon + insufficient stock) -> 409, no usage
//     row, counters untouched, no order (frozen atomicity).
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
  console.log(JSON.stringify({ suite: "promotions-concurrency", db: dbName, total: results.length, failures: failures.length, failed: failures.map((f) => f.name), passed: results.filter((r) => r.pass).map((r) => r.name) }, null, 2));
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
const P_C1 = "01094000111";
const P_C2 = "01094000222";
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

  const post = async (path, data, cookie = null, headers = {}) => {
    const r = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...headers },
      body: JSON.stringify(data),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const patch = async (path, data, cookie = null) => {
    const r = await fetch(`${baseUrl}${path}`, {
      method: "PATCH",
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

  const cartIds = new Set();
  const promoIds = new Set();
  const couponIds = new Set();
  const keySeq = { n: 0 };
  const key = (p) => `ba8r-${p}-${Date.now().toString(36)}-${keySeq.n++}`;
  const mkCart = async (lines) => {
    const g = await post(`/api/store/cart`, {});
    const tok = g.body.data.guestToken;
    cartIds.add(g.body.data.cart.id);
    for (const [vid, qty] of lines) {
      await fetch(`${baseUrl}/api/store/cart/items`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-guest-token": tok },
        body: JSON.stringify({ productVariantId: vid, quantity: qty }),
      });
    }
    return tok;
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
  const checkout = async (sessTok, addrId, lines, k, couponCode = null) => {
    // Isolate: empty the session cart first (failed checkouts leave carts).
    await fetch(`${baseUrl}/api/store/cart/items`, { method: "DELETE", headers: H(sessTok) });
    const tok = await mkCart(lines);
    await post(`/api/store/cart/merge`, {}, null, { "x-guest-token": tok, ...H(sessTok) });
    const body = { addressId: addrId, idempotencyKey: k };
    if (couponCode) body.couponCode = couponCode;
    const r = await fetch(`${baseUrl}/api/store/orders`, {
      method: "POST",
      headers: { "content-type": "application/json", ...H(sessTok) },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const num = (s) => Number(s);

  try {
    const ss1 = await sess(P_C1, "Race1");
    const ss2 = await sess(P_C2, "Race2");
    const idC1 = ss1.id;
    const idC2 = ss2.id;
    const tC1 = ss1.tok;
    const tC2 = ss2.tok;
    const a1 = await post(`/api/admin/customers/${idC1}/addresses`, { city: "Cairo", phone: P_C1 }, cookie);
    const a2 = await post(`/api/admin/customers/${idC2}/addresses`, { city: "Giza", phone: P_C2 }, cookie);
    const idA1 = a1.body.data.id;
    const idA2 = a2.body.data.id;

    // Parent promo (ORDER fixed 30) + limit-1 coupon, shared by R1/R2/R4.
    const pCp = await post(`/api/admin/promotions`,
      { name: "BA8R race parent", type: "FIXED_AMOUNT", scope: "ORDER", discountAmount: "30.00", priority: 100 }, cookie);
    const idCp = pCp.body.data.id;
    promoIds.add(idCp);
    await patch(`/api/admin/promotions/${idCp}`, { status: "ACTIVE" }, cookie);

    // ---------- R1: last global usage, two customers ----------
    const cp1 = await post(`/api/admin/coupons`, { promotionId: idCp, code: "RACEONE", usageLimit: 1 }, cookie);
    const idRaceOne = cp1.body.data.id;
    couponIds.add(idRaceOne);
    const [r1a, r1b] = await Promise.all([
      checkout(tC1, idA1, [[P330, "2"]], key("r1a"), "RACEONE"),
      checkout(tC2, idA2, [[P330, "2"]], key("r1b"), "RACEONE"),
    ]);
    const r1 = [r1a.status, r1b.status].sort().join(",");
    t("raceCoupon-single-winner", r1 === "201,409", JSON.stringify([r1a.status, r1b.status]));
    t("raceCoupon-counter-one", (await q(`SELECT used_count FROM coupons WHERE id = $1`, [idRaceOne]))[0].used_count === 1);
    t("raceCoupon-one-usage", (await q(`SELECT count(*)::int AS n FROM coupon_usages WHERE coupon_id = $1`, [idRaceOne]))[0].n === 1);
    const winner = r1a.status === 201 ? r1a : r1b;
    t("raceCoupon-winner-discounted", num(winner.body.data.order.discountTotal) === 30);

    // ---------- R2: per-customer limit, same customer twice ----------
    // (Sequential: one session cart exists per customer, so a second order
    // needs its own merged cart. The limit itself is enforced by row-lock.)
    const cp2 = await post(`/api/admin/coupons`, { promotionId: idCp, code: "RACETWO", perCustomerLimit: 1 }, cookie);
    const idRaceTwo = cp2.body.data.id;
    couponIds.add(idRaceTwo);
    const r2a = await checkout(tC1, idA1, [[P330, "1"]], key("r2a"), "RACETWO");
    const r2b = await checkout(tC1, idA1, [[P330, "1"]], key("r2b"), "RACETWO");
    const r2 = [r2a.status, r2b.status].sort().join(",");
    t("racePerCustomer-single", r2 === "201,422", JSON.stringify([r2a.status, r2b.status]));
    t("racePerCustomer-one-usage", (await q(`SELECT count(*)::int AS n FROM coupon_usages WHERE coupon_id = $1`, [idRaceTwo]))[0].n === 1);

    // ---------- R3: limited auto SKIP race (no coupon) ----------
    const pAuto = await post(`/api/admin/promotions`,
      { name: "BA8R auto10", type: "PERCENTAGE", scope: "ORDER", discountPercent: "10.00", priority: 5, usageLimit: 1 }, cookie);
    const idAuto = pAuto.body.data.id;
    promoIds.add(idAuto);
    await patch(`/api/admin/promotions/${idAuto}`, { status: "ACTIVE" }, cookie);
    const [r3a, r3b] = await Promise.all([
      checkout(tC1, idA1, [[P330, "2"]], key("r3a")),
      checkout(tC2, idA2, [[P330, "2"]], key("r3b")),
    ]);
    t("raceAuto-both-succeed", r3a.status === 201 && r3b.status === 201, JSON.stringify([r3a.status, r3b.status]));
    const discs = [r3a, r3b].map((r) => num(r.body.data.order.discountTotal)).sort((a, b) => a - b);
    t("raceAuto-skip-one", JSON.stringify(discs) === JSON.stringify([0, 3]));
    t("raceAuto-counter-one", (await q(`SELECT used_count FROM promotions WHERE id = $1`, [idAuto]))[0].used_count === 1);
    await patch(`/api/admin/promotions/${idAuto}`, { status: "DISABLED" }, cookie);

    // ---------- R4: coupon + insufficient stock rolls back atomically ----------
    await db.query(`UPDATE inventory SET quantity = 1.000, reserved_quantity = 0 WHERE product_variant_id = $1`, [P330]);
    const cp4 = await post(`/api/admin/coupons`, { promotionId: idCp, code: "RACEFOUR" }, cookie);
    const idRaceFour = cp4.body.data.id;
    couponIds.add(idRaceFour);
    const r4 = await checkout(tC1, idA1, [[P330, "5"]], key("r4"), "RACEFOUR");
    t("raceRollback-409", r4.status === 409);
    t("raceRollback-no-usage", (await q(`SELECT count(*)::int AS n FROM coupon_usages WHERE coupon_id = $1`, [idRaceFour]))[0].n === 0);
    t("raceRollback-no-order", (await q(`SELECT count(*)::int AS n FROM orders WHERE idempotency_key LIKE 'ba8r-r4%'`))[0].n === 0);
    t("raceRollback-counters-zero",
      (await q(`SELECT used_count FROM coupons WHERE id = $1`, [idRaceFour]))[0].used_count === 0
      && (await q(`SELECT reserved_quantity::text r FROM inventory WHERE product_variant_id = $1`, [P330]))[0].r === "0.000");
    await db.query(`UPDATE inventory SET quantity = 500.000, reserved_quantity = 0 WHERE product_variant_id = $1`, [P330]);
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
      for (const id of couponIds) {
        await db.query(`DELETE FROM coupons WHERE id = $1`, [id]).catch(() => {});
      }
      for (const id of promoIds) {
        await db.query(`DELETE FROM promotion_buy_get_rules WHERE promotion_id = $1`, [id]).catch(() => {});
        await db.query(`DELETE FROM promotion_rules WHERE promotion_id = $1`, [id]).catch(() => {});
        await db.query(`DELETE FROM promotion_targets WHERE promotion_id = $1`, [id]).catch(() => {});
        await db.query(`DELETE FROM promotions WHERE id = $1`, [id]).catch(() => {});
      }
      for (const id of cartIds) {
        await db.query(`DELETE FROM cart_items WHERE cart_id = $1`, [id]).catch(() => {});
        await db.query(`DELETE FROM carts WHERE id = $1`, [id]).catch(() => {});
      }
      for (const ph of [P_C1, P_C2].map(CANON)) {
        const rows = await db.query(`SELECT id FROM customers WHERE phone = $1`, [ph]).catch(() => ({ rows: [] }));
        for (const r of rows.rows) {
          await db.query(`DELETE FROM customer_sessions WHERE customer_id = $1`, [r.id]).catch(() => {});
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
      await db.query(`UPDATE inventory SET quantity = 500.000, reserved_quantity = 0 WHERE product_variant_id = $1`, [P330]).catch(() => {});
    } catch { /* scratch hygiene best-effort */ }
    await db.end().catch(() => {});
  }
  done();
}

main().catch((e) => {
  console.error(`RACE_SUITE_FAILED: ${e.constructor.name}: ${String(e.message).slice(0, 200)}`);
  process.exit(1);
});
