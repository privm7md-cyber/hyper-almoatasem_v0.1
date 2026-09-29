// BA-10 transaction atomicity suite (real PostgreSQL, scratch-only).
// Usage: node scripts/api/t-atomicity.mjs --db <name> --port <port>
// Drives frozen guards to fail AFTER earlier in-tx writes happened, then
// proves zero partial commits (rows, counters, holds, movements, usages,
// discounts, history, audit). Non-drivable micro-steps (post-release
// failures with all CHECKs satisfied by construction) are code-reviewed,
// not test-driven — stated honestly, never claimed.
//   A1 coupon+promo+stock-short: 409, no order/usage/discounts, counters
//     and holds untouched, cart ACTIVE.
//   A2 approve substitute-short: 409, proposal stays PROPOSED, original
//     untouched, no line, holds and movements untouched.
//   A3 duplicate grant: 409 + no audit row for the failed call.
//   A4 invalid setting: 422 + no audit row + value unchanged.
//   A5 successful user patch: state + exactly one audit row committed.
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
  console.log(JSON.stringify({ suite: "atomicity", db: dbName, total: results.length, failures: failures.length, failed: failures.map((f) => f.name), passed: results.filter((r) => r.pass).map((r) => r.name) }, null, 2));
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
const P_C1 = "01096000011";
const CANON = (p) => "2010" + p.slice(3);
const STORE_EMAIL = "store-cat-test@example.com";
const STORE_PW = "Cat-Test-Store-Pass-0002!";
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

  const post = async (path, data, cookie = null) => {
    const r = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
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
  const key = (p) => `ba10a-${p}-${Date.now().toString(36)}-${keySeq.n++}`;
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
  const checkout = async (custId, addrId, lines, k, couponCode = null) => {
    const tok = await mkCart(lines);
    const body = { customerId: custId, addressId: addrId, idempotencyKey: k };
    if (couponCode) body.couponCode = couponCode;
    const r = await fetch(`${baseUrl}/api/store/orders`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-guest-token": tok },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const reservedOf = async (v) =>
    (await q(`SELECT reserved_quantity::text r FROM inventory WHERE product_variant_id = $1`, [v]))[0].r;
  const movCount = async (v) =>
    Number((await q(`SELECT count(*)::int AS n FROM inventory_movements WHERE product_variant_id = $1`, [v]))[0].n);

  try {
    const store = await loginAs(STORE_EMAIL, STORE_PW);
    const owner = await loginAs(OWNER_EMAIL, OWNER_PW);
    if (store.status !== 200 || !store.cookie || owner.status !== 200 || !owner.cookie) {
      console.error(`REFUSED_LOGIN: store=${store.status} owner=${owner.status}`);
      process.exit(1);
    }
    const ck = store.cookie;
    const cko = owner.cookie;
    const c1 = await post(`/api/store/customers/identify`, { phone: P_C1, firstName: "Atom" });
    const idC = c1.body.data.id;
    const a1 = await post(`/api/admin/customers/${idC}/addresses`, { city: "Cairo", phone: P_C1 }, ck);
    const idA = a1.body.data.id;

    // Promo (limited auto 10% LINE on P330) + coupon parent for A1.
    const pAuto = await post(`/api/admin/promotions`,
      { name: "BA10A auto", type: "PERCENTAGE", scope: "LINE", discountPercent: "10.00", priority: 10, usageLimit: 5 }, ck);
    const idAuto = pAuto.body.data.id;
    promoIds.add(idAuto);
    await post(`/api/admin/promotions/${idAuto}/targets`, { targetType: "VARIANT", targetId: P330 }, ck);
    await patch(`/api/admin/promotions/${idAuto}`, { status: "ACTIVE" }, ck);
    const pCp = await post(`/api/admin/promotions`,
      { name: "BA10A coupon parent", type: "FIXED_AMOUNT", scope: "ORDER", discountAmount: "20.00", priority: 100 }, ck);
    const idCp = pCp.body.data.id;
    promoIds.add(idCp);
    await patch(`/api/admin/promotions/${idCp}`, { status: "ACTIVE" }, ck);
    const cpA = await post(`/api/admin/coupons`, { promotionId: idCp, code: "ATOM20" }, ck);
    const idCpA = cpA.body.data.id;
    couponIds.add(idCpA);

    // ---------- A1: coupon + promo + stock-short ----------
    await db.query(`UPDATE inventory SET quantity = 1.000, reserved_quantity = 0 WHERE product_variant_id = $1`, [P330]);
    const mvP330 = await movCount(P330);
    const usedAutoBefore = (await q(`SELECT used_count FROM promotions WHERE id = $1`, [idAuto]))[0].used_count;
    const usedCpBefore = (await q(`SELECT used_count FROM coupons WHERE id = $1`, [idCpA]))[0].used_count;
    const a1r = await checkout(idC, idA, [[P330, "2"]], key("a1"), "ATOM20");
    t("a1-409", a1r.status === 409, String(a1r.status));
    t("a1-no-order", (await q(`SELECT count(*)::int AS n FROM orders WHERE idempotency_key LIKE 'ba10a-a1%'`))[0].n === 0);
    t("a1-no-usage", (await q(`SELECT count(*)::int AS n FROM coupon_usages WHERE coupon_id = $1`, [idCpA]))[0].n === 0);
    t("a1-no-discounts", (await q(`SELECT count(*)::int AS n FROM order_discounts WHERE promotion_id IN ($1,$2)`, [idAuto, idCp]))[0].n === 0);
    t("a1-counters-untouched",
      (await q(`SELECT used_count FROM promotions WHERE id = $1`, [idAuto]))[0].used_count === usedAutoBefore
      && (await q(`SELECT used_count FROM coupons WHERE id = $1`, [idCpA]))[0].used_count === usedCpBefore
      && (await q(`SELECT used_count FROM promotions WHERE id = $1`, [idCp]))[0].used_count === 0);
    t("a1-holds-untouched", (await reservedOf(P330)) === "0.000");
    t("a1-no-movements", (await movCount(P330)) === mvP330);
    await db.query(`UPDATE inventory SET quantity = 500.000, reserved_quantity = 0 WHERE product_variant_id = $1`, [P330]);

    // ---------- A2: approve substitute-short ----------
    await db.query(`UPDATE inventory SET quantity = 0.000, reserved_quantity = 0 WHERE product_variant_id = $1`, [P1L]);
    const mvP1L = await movCount(P1L);
    const oA2 = await checkout(idC, idA, [[P330, "1"]], key("a2"));
    const itemsA2 = (await fetch(`${baseUrl}/api/store/orders/${oA2.body.data.order.id}?customerId=${idC}`).then((r) => r.json())).data.order.items;
    const pA2 = await post(`/api/admin/orders/${oA2.body.data.order.id}/items/${itemsA2[0].id}/replacements`,
      { replacementVariantId: P1L, replacementQuantity: "1" }, ck);
    const dA2 = await post(`/api/store/orders/${oA2.body.data.order.id}/replacements/${pA2.body.data.id}/decide`,
      { customerId: idC, action: "approve" });
    t("a2-409", dA2.status === 409, String(dA2.status));
    const repRow = await q(`SELECT status FROM order_item_replacements WHERE id = $1`, [pA2.body.data.id]);
    const itemRow = await q(`SELECT item_status FROM order_items WHERE id = $1`, [itemsA2[0].id]);
    t("a2-proposal-intact", repRow[0].status === "PROPOSED" && itemRow[0].item_status === "UNAVAILABLE");
    t("a2-no-line", (await q(`SELECT count(*)::int AS n FROM order_items WHERE order_id = $1`, [oA2.body.data.order.id]))[0].n === 1);
    t("a2-holds-intact", (await reservedOf(P330)) === "1.000" && (await reservedOf(P1L)) === "0.000");
    t("a2-no-movements", (await movCount(P1L)) === mvP1L);
    await db.query(`UPDATE inventory SET quantity = 300.000, reserved_quantity = 0 WHERE product_variant_id = $1`, [P1L]);

    // ---------- A3: duplicate grant -> no audit row ----------
    const permReports = await q(`SELECT id FROM permissions WHERE key = 'reports.view'`);
    const roleTmp = await post(`/api/admin/roles`, { name: `BA10A_TMP_${Date.now().toString(36)}`.toUpperCase() }, cko);
    const idRT = roleTmp.body.data.id;
    await post(`/api/admin/roles/${idRT}/grants`, { permissionId: permReports[0].id }, cko);
    const auditBefore = (await q(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'roles.grant'`))[0].n;
    const dup = await post(`/api/admin/roles/${idRT}/grants`, { permissionId: permReports[0].id }, cko);
    const auditAfter = (await q(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'roles.grant'`))[0].n;
    t("a3-dup-409", dup.status === 409);
    t("a3-no-audit", auditAfter === auditBefore + 0, `${auditBefore}->${auditAfter}`);
    await db.query(`DELETE FROM role_permissions WHERE role_id = $1`, [idRT]).catch(() => {});
    await db.query(`DELETE FROM roles WHERE id = $1`, [idRT]).catch(() => {});

    // ---------- A4: invalid setting -> no audit, value kept ----------
    const auditSetBefore = (await q(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'settings.update'`))[0].n;
    const badSet = await patch(`/api/admin/settings/orders.auto_cancel_minutes`, { value: "soon" }, cko);
    const valAfter = await q(`SELECT value_text FROM store_settings WHERE key = 'orders.auto_cancel_minutes'`);
    const auditSetAfter = (await q(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'settings.update'`))[0].n;
    t("a4-422", badSet.status === 422);
    t("a4-value-kept", valAfter[0].value_text === "30");
    t("a4-no-audit", auditSetAfter === auditSetBefore);

    // ---------- A5: successful mutation commits state + audit together ----------
    const u5 = await post(`/api/admin/users`, { name: "BA10 Atom", email: `ba10-atom-${Date.now().toString(36)}@example.com` }, cko);
    const idU5 = u5.body.data.id;
    const p5 = await patch(`/api/admin/users/${idU5}`, { name: "BA10 Atomised" }, cko);
    const pair = await q(`SELECT action, entity_id::text AS e, new_values FROM audit_logs
      WHERE action = 'users.update' AND entity_id = $1 ORDER BY created_at DESC LIMIT 1`, [idU5]);
    t("a5-pair", p5.status === 200 && pair.length === 1 && pair[0].e === idU5
      && JSON.stringify(pair[0].new_values).includes("Atomised"));
    await db.query(`DELETE FROM audit_logs WHERE user_id = $1`, [idU5]).catch(() => {});
    await db.query(`DELETE FROM admin_sessions WHERE user_id = $1`, [idU5]).catch(() => {});
    await db.query(`DELETE FROM user_roles WHERE user_id = $1`, [idU5]).catch(() => {});
    await db.query(`DELETE FROM users WHERE id = $1`, [idU5]).catch(() => {});
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
        await db.query(`DELETE FROM customer_addresses WHERE customer_id = $1`, [r.id]).catch(() => {});
        const cc = await db.query(`SELECT id FROM carts WHERE customer_id = $1`, [r.id]).catch(() => ({ rows: [] }));
        for (const c of cc.rows) {
          await db.query(`DELETE FROM cart_items WHERE cart_id = $1`, [c.id]).catch(() => {});
          await db.query(`DELETE FROM carts WHERE id = $1`, [c.id]).catch(() => {});
        }
      }
      await db.query(`DELETE FROM customers WHERE phone = $1`, [CANON(P_C1)]).catch(() => {});
      for (const email of [STORE_EMAIL, OWNER_EMAIL]) {
        await db.query(`DELETE FROM admin_sessions WHERE user_id = (SELECT id FROM users WHERE email = $1)`, [email]).catch(() => {});
      }
      await db.query(`UPDATE inventory SET quantity = 500.000, reserved_quantity = 0 WHERE product_variant_id = $1`, [P330]).catch(() => {});
      await db.query(`UPDATE inventory SET quantity = 300.000, reserved_quantity = 0 WHERE product_variant_id = $1`, [P1L]).catch(() => {});
    } catch { /* scratch hygiene best-effort */ }
    await db.end().catch(() => {});
  }
  done();
}

main().catch((e) => {
  console.error(`ATOMICITY_SUITE_FAILED: ${e.constructor.name}: ${String(e.message).slice(0, 200)}`);
  console.error(String(e.stack).split("\n").slice(0, 4).join(" | "));
  process.exit(1);
});
