// BA-10 idempotency/replay matrix (real PostgreSQL, scratch-only).
// Usage: node scripts/api/t-idempotency-matrix.mjs --db <name> --port <port>
// Classification (frozen; HD-4: no new keys invented):
//   Orders: explicit key. Same key + same cart -> replay identical result
//     INCLUDING discounts (no second usage, no counter move). Same key +
//     different cart -> 409, no second order/usage.
//   Cart: no key; partial-UQ + status convergence ({201,200} same id).
//   Coupons: no key; usage UQ(order) + conditional bumps (covered BA-8).
//   Replacements: no key; partial UQ + PROPOSED gate -> 409s (covered BA-7).
//   Admin users/grants: pair UQs -> 409 (covered BA-9).
//   Audit: read-only (no PATCH/DELETE routes).
// This suite executes the ORDER+COUPON replay-identity row (new ground:
// prior replay tests used coupon-free orders) and re-asserts the cart
// convergence row; all other rows cite their regression suites.
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
  console.log(JSON.stringify({ suite: "idempotency-matrix", db: dbName, total: results.length, failures: failures.length, failed: failures.map((f) => f.name), passed: results.filter((r) => r.pass).map((r) => r.name) }, null, 2));
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
const P_C1 = "01097000011";
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

  const post = async (path, data, token = null, extra = {}) => {
    const r = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { "x-guest-token": token } : {}), ...extra },
      body: JSON.stringify(data),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
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
  const promoIds = new Set();
  const couponIds = new Set();
  const keySeq = { n: 0 };
  const key = (p) => `ba10i-${p}-${Date.now().toString(36)}-${keySeq.n++}`;
  const num = (s) => Number(s);
  const mkCart = async (lines) => {
    const g = await post(`/api/store/cart`, {});
    const tok = g.body.data.guestToken;
    cartIds.add(g.body.data.cart.id);
    for (const [vid, qty] of lines) {
      await post(`/api/store/cart/items`, { productVariantId: vid, quantity: qty }, tok);
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
  const mergeTo = async (guestToken, sessTok) =>
    post(`/api/store/cart/merge`, {}, guestToken, H(sessTok));
  const checkout = async (sessTok, addrId, lines, k, couponCode = null) => {
    const tok = await mkCart(lines);
    await mergeTo(tok, sessTok);
    const body = { addressId: addrId, idempotencyKey: k };
    if (couponCode) body.couponCode = couponCode;
    return post(`/api/store/orders`, body, null, H(sessTok));
  };

  try {
    const store = await loginAs(STORE_EMAIL, STORE_PW);
    if (store.status !== 201 || !store.cookie) {
      console.error(`REFUSED_LOGIN: store=${store.status}`);
      process.exit(1);
    }
    const ck = store.cookie;
    const ss1 = await sess(P_C1, "Idem");
    const idC = ss1.id;
    const tC = ss1.tok;
    const a1 = await fetch(`${baseUrl}/api/admin/customers/${idC}/addresses`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: ck },
      body: JSON.stringify({ city: "Cairo", phone: P_C1 }),
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
    const idA = a1.body.data.id;

    // Coupon parent (ORDER fixed 40) + single-use coupon for replay tests.
    const admPost = async (path, data) => {
      const r = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ck },
        body: JSON.stringify(data),
      });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    };
    const pCp = await admPost(`/api/admin/promotions`,
      { name: "BA10I parent", type: "FIXED_AMOUNT", scope: "ORDER", discountAmount: "40.00", priority: 100 });
    const idCp = pCp.body.data.id;
    promoIds.add(idCp);
    await fetch(`${baseUrl}/api/admin/promotions/${idCp}`, {
      method: "PATCH", headers: { "content-type": "application/json", cookie: ck },
      body: JSON.stringify({ status: "ACTIVE" }),
    });
    const cpI = await admPost(`/api/admin/coupons`, { promotionId: idCp, code: "IDEM40" });
    const idCpI = cpI.body.data.id;
    couponIds.add(idCpI);

    // ---------- Orders+coupon replay identity (same cart+key replays) ----------
    const K1 = key("k1");
    const tokK1 = await mkCart([[P1L, "10"]]);
    await mergeTo(tokK1, tC);
    const orderAs = async (k, couponCode = null) => {
      const body = { addressId: idA, idempotencyKey: k };
      if (couponCode) body.couponCode = couponCode;
      const r = await fetch(`${baseUrl}/api/store/orders`, {
        method: "POST",
        headers: { "content-type": "application/json", ...H(tC) },
        body: JSON.stringify(body),
      });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    };
    const r1 = await orderAs(K1, "IDEM40");
    t("coupon-order-201", r1.status === 201);
    const O1 = r1.body.data.order;
    const usedBefore = (await q(`SELECT used_count FROM coupons WHERE id = $1`, [idCpI]))[0].used_count;
    const usagesBefore = (await q(`SELECT count(*)::int AS n FROM coupon_usages WHERE coupon_id = $1`, [idCpI]))[0].n;
    const rowsBefore = await q(`SELECT kind k, discount_estimated::text d FROM order_discounts WHERE order_id = $1 ORDER BY kind, id`, [O1.id]);
    const r2 = await orderAs(K1, "IDEM40");
    t("coupon-replay-200", r2.status === 200 && r2.body.meta?.replay === true && r2.body.data.order.id === O1.id);
    const O2 = r2.body.data.order;
    t("coupon-replay-identical", num(O2.discountTotal) === num(O1.discountTotal)
      && num(O2.totalEstimated) === num(O1.totalEstimated)
      && O2.orderNumber === O1.orderNumber);
    t("coupon-replay-no-rebump",
      (await q(`SELECT used_count FROM coupons WHERE id = $1`, [idCpI]))[0].used_count === usedBefore
      && (await q(`SELECT count(*)::int AS n FROM coupon_usages WHERE coupon_id = $1`, [idCpI]))[0].n === usagesBefore);
    const rowsAfter = await q(`SELECT kind k, discount_estimated::text d FROM order_discounts WHERE order_id = $1 ORDER BY kind, id`, [O1.id]);
    t("coupon-replay-rows-stable", JSON.stringify(rowsAfter) === JSON.stringify(rowsBefore));

    // ---------- Same key, different cart -> 409, nothing new ----------
    const usagesX = (await q(`SELECT count(*)::int AS n FROM coupon_usages WHERE coupon_id = $1`, [idCpI]))[0].n;
    const r3 = await checkout(tC, idA, [[P330, "1"]], K1, "IDEM40");
    t("key-diff-cart-409", r3.status === 409);
    t("key-diff-no-usage", (await q(`SELECT count(*)::int AS n FROM coupon_usages WHERE coupon_id = $1`, [idCpI]))[0].n === usagesX);
    t("key-diff-no-order", (await q(`SELECT count(*)::int AS n FROM orders WHERE customer_id = $1`, [idC]))[0].n === 1);

    // ---------- Cart convergence row (no key) ----------
    const sCC = await sess("01097000022", "Idem2");
    const [g1, g2] = await Promise.all([
      post(`/api/store/cart`, {}, null, H(sCC.tok)),
      post(`/api/store/cart`, {}, null, H(sCC.tok)),
    ]);
    const gs = [g1.status, g2.status].sort().join(",");
    t("cart-converge", gs === "200,201" && g1.body.data.cart.id === g2.body.data.cart.id, gs);
    for (const ph of ["01097000022"]) {
      const rows = await db.query(`SELECT id FROM customers WHERE phone = $1`, [CANON(ph)]).catch(() => ({ rows: [] }));
      for (const r of rows.rows) {
        const ccs = await db.query(`SELECT id FROM carts WHERE customer_id = $1`, [r.id]).catch(() => ({ rows: [] }));
        for (const c of ccs.rows) cartIds.add(c.id);
        await db.query(`DELETE FROM customer_sessions WHERE customer_id = $1`, [r.id]).catch(() => {});
      }
      await db.query(`DELETE FROM customers WHERE phone = $1`, [ph]).catch(() => {});
    }
  } finally {
    try {
      const ordRows = await db.query(
        `SELECT o.id FROM orders o JOIN customers c ON c.id = o.customer_id WHERE c.phone = $1`, [CANON(P_C1)],
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
      const cust = await db.query(`SELECT id FROM customers WHERE phone = $1`, [CANON(P_C1)]).catch(() => ({ rows: [] }));
      for (const r of cust.rows) {
        await db.query(`DELETE FROM customer_sessions WHERE customer_id = $1`, [r.id]).catch(() => {});
        await db.query(`DELETE FROM customer_addresses WHERE customer_id = $1`, [r.id]).catch(() => {});
        const ccs = await db.query(`SELECT id FROM carts WHERE customer_id = $1`, [r.id]).catch(() => ({ rows: [] }));
        for (const c of ccs.rows) {
          await db.query(`DELETE FROM cart_items WHERE cart_id = $1`, [c.id]).catch(() => {});
          await db.query(`DELETE FROM carts WHERE id = $1`, [c.id]).catch(() => {});
        }
      }
      await db.query(`DELETE FROM customers WHERE phone = $1`, [CANON(P_C1)]).catch(() => {});
      for (const email of [STORE_EMAIL]) {
        await db.query(`DELETE FROM admin_sessions WHERE user_id = (SELECT id FROM users WHERE email = $1)`, [email]).catch(() => {});
      }
    } catch { /* scratch hygiene best-effort */ }
    await db.end().catch(() => {});
  }
  done();
}

main().catch((e) => {
  console.error(`IDEMPOTENCY_SUITE_FAILED: ${e.constructor.name}: ${String(e.message).slice(0, 200)}`);
  console.error(String(e.stack).split("\n").slice(0, 4).join(" | "));
  process.exit(1);
});
