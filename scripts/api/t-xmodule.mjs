// BA-10 cross-module concurrency suite (real PostgreSQL, scratch-only).
// Usage: node scripts/api/t-xmodule.mjs --db <name> --port <port>
// New ground only (single-module races live in their BA suites):
//   X1 Catalog x Cart: price moves after add -> snapshot frozen, drift 409.
//   X2 Catalog x Order: drift leaves cart ACTIVE, no order, no reservation.
//   X3 Inventory x Order: adjust-down vs checkout race -> single winner,
//     predicates authoritative, never oversell.
//   X4 Inventory x Replacement: approve vs admin reserve on one unit ->
//     single winner, loser 409, reserved exactly 1.
//   X7 Order x Replacement x Inventory (mandatory trio): approve +
//     contending checkout + cancel -> coherent end state, conservation.
//   X8 RBAC vs API: deactivation mid-session -> 401/403 (per-request
//     evaluation), never 500, final state enforced.
// X5/X6 (coupon/promo checkout races) are BA-8 R1/R3, re-run in regression.
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
  console.log(JSON.stringify({ suite: "xmodule", db: dbName, total: results.length, failures: failures.length, failed: failures.map((f) => f.name), passed: results.filter((r) => r.pass).map((r) => r.name) }, null, 2));
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
const P_C1 = "01095000011";
const P_C2 = "01095000022";
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

  const jpost = async (path, data, headers = {}) => {
    const r = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(data),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const jpatch = async (path, data, headers = {}) => {
    const r = await fetch(`${baseUrl}${path}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(data),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const jget = async (path, headers = {}) => {
    const r = await fetch(`${baseUrl}${path}`, { headers });
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
  const keySeq = { n: 0 };
  const key = (p) => `ba10x-${p}-${Date.now().toString(36)}-${keySeq.n++}`;
  const num = (s) => Number(s);
  const mkCart = async (lines) => {
    const g = await jpost(`/api/store/cart`, {});
    const tok = g.body.data.guestToken;
    cartIds.add(g.body.data.cart.id);
    for (const [vid, qty] of lines) {
      await jpost(`/api/store/cart/items`, { productVariantId: vid, quantity: qty }, { "x-guest-token": tok });
    }
    return { id: g.body.data.cart.id, token: tok };
  };
  const reservedOf = async (v) =>
    (await q(`SELECT reserved_quantity::text r, quantity::text q FROM inventory WHERE product_variant_id = $1`, [v]))[0];

  try {
    const store = await loginAs(STORE_EMAIL, STORE_PW);
    const owner = await loginAs(OWNER_EMAIL, OWNER_PW);
    if (store.status !== 200 || !store.cookie || owner.status !== 200 || !owner.cookie) {
      console.error(`REFUSED_LOGIN: store=${store.status} owner=${owner.status}`);
      process.exit(1);
    }
    const ck = { cookie: store.cookie };
    const c1 = await jpost(`/api/store/customers/identify`, { phone: P_C1, firstName: "Xmod1" });
    const c2 = await jpost(`/api/store/customers/identify`, { phone: P_C2, firstName: "Xmod2" });
    const idC1 = c1.body.data.id;
    const idC2 = c2.body.data.id;
    const a1 = await jpost(`/api/admin/customers/${idC1}/addresses`, { city: "Cairo", phone: P_C1 }, ck);
    const a2 = await jpost(`/api/admin/customers/${idC2}/addresses`, { city: "Giza", phone: P_C2 }, ck);
    const idA1 = a1.body.data.id;
    const idA2 = a2.body.data.id;

    // ---------- X1/X2: price moves after cart add ----------
    const gx = await mkCart([[P330, "2"]]);
    await jpatch(`/api/admin/catalog/variants/${P330}/price`, { price: "17.00", reason: "ba10 x1" }, ck);
    const cartAfter = await jget(`/api/store/cart`, { "x-guest-token": gx.token });
    const snapKept = cartAfter.body?.data?.cart?.lines?.find((l) => l.productVariantId === P330);
    t("x1-snapshot-frozen", cartAfter.status === 200 && snapKept && num(snapKept.unitPriceSnapshot) === 15);
    const driftOrder = await jpost(`/api/store/orders`,
      { customerId: idC1, addressId: idA1, idempotencyKey: key("x1") }, { "x-guest-token": gx.token });
    t("x2-drift-409", driftOrder.status === 409);
    const noOrder = await q(`SELECT count(*)::int AS n FROM orders WHERE idempotency_key LIKE 'ba10x-x1%'`);
    const cartStill = await jget(`/api/store/cart`, { "x-guest-token": gx.token });
    t("x2-no-side-effects", noOrder[0].n === 0 && cartStill.status === 200
      && (await reservedOf(P330)).r === "0.000");
    await jpatch(`/api/admin/catalog/variants/${P330}/price`, { price: "15.00", reason: "ba10 revert" }, ck);

    // ---------- X3: adjust-down vs checkout ----------
    await db.query(`UPDATE inventory SET quantity = 2.000, reserved_quantity = 0 WHERE product_variant_id = $1`, [P330]);
    const xa = await mkCart([[P330, "2"]]);
    const adjBody = { productVariantId: P330, delta: "-1.000", movementType: "ADJUSTMENT", referenceType: "MANUAL", referenceId: "BA10X3" };
    const [x3o, x3a] = await Promise.all([
      jpost(`/api/store/orders`, { customerId: idC1, addressId: idA1, idempotencyKey: key("x3o") }, { "x-guest-token": xa.token }),
      jpost(`/api/admin/inventory/adjust`, adjBody, ck),
    ]);
    const x3ok = (x3o.status === 201 && x3a.status === 409) || (x3o.status === 409 && x3a.status === 201);
    t("x3-single-winner", x3ok, JSON.stringify([x3o.status, x3a.status]));
    const invX3 = await reservedOf(P330);
    t("x3-predicates-hold", num(invX3.r) >= 0 && num(invX3.r) <= num(invX3.q), JSON.stringify(invX3));
    await db.query(`UPDATE inventory SET quantity = 500.000, reserved_quantity = 0 WHERE product_variant_id = $1`, [P330]);
    await db.query(`DELETE FROM inventory_movements WHERE reference_id = 'BA10X3'`).catch(() => {});

    // ---------- X4: approve vs admin reserve on one unit ----------
    // Note: approve answers 200, reserve answers 201 — pairs below use both.
    const mkProposal = async (suffix) => {
      const cart = await mkCart([[P330, "1"]]);
      const o = await jpost(`/api/store/orders`,
        { customerId: idC1, addressId: idA1, idempotencyKey: key(`x4o-${suffix}`) }, { "x-guest-token": cart.token });
      const items = (await jget(`/api/store/orders/${o.body.data.order.id}?customerId=${idC1}`)).body.data.order.items;
      const p = await jpost(`/api/admin/orders/${o.body.data.order.id}/items/${items[0].id}/replacements`,
        { replacementVariantId: P1L, replacementQuantity: "1" }, ck);
      return { orderId: o.body.data.order.id, repId: p.body.data.id };
    };
    const coherentPair = (a, r) =>
      (a === 200 && r === 409) || (a === 409 && r === 201);
    await db.query(`UPDATE inventory SET quantity = 1.000, reserved_quantity = 0 WHERE product_variant_id = $1`, [P1L]);
    const x4one = await mkProposal("a");
    const [x4a, x4r] = await Promise.all([
      jpost(`/api/store/orders/${x4one.orderId}/replacements/${x4one.repId}/decide`, { customerId: idC1, action: "approve" }),
      jpost(`/api/admin/inventory/reserve`, { productVariantId: P1L, quantity: "1.000" }, ck),
    ]);
    t("x4-single-winner", coherentPair(x4a.status, x4r.status), JSON.stringify([x4a.status, x4r.status]));
    t("x4-reserved-exactly-one", (await reservedOf(P1L)).r === "1.000");
    // Staggered round (approve head start) exercises the opposite arrival.
    await db.query(`UPDATE inventory SET quantity = 1.000, reserved_quantity = 0 WHERE product_variant_id = $1`, [P1L]);
    const x4two = await mkProposal("b");
    const pa = jpost(`/api/store/orders/${x4two.orderId}/replacements/${x4two.repId}/decide`, { customerId: idC1, action: "approve" });
    await new Promise((r) => setTimeout(r, 250));
    const pr = await jpost(`/api/admin/inventory/reserve`, { productVariantId: P1L, quantity: "1.000" }, ck);
    const [x4a2, x4r2] = await Promise.all([pa, pr]);
    t("x4-staggered-coherent", coherentPair(x4a2.status, x4r2.status), JSON.stringify([x4a2.status, x4r2.status]));
    t("x4-staggered-reserved-one", (await reservedOf(P1L)).r === "1.000");
    await db.query(`UPDATE inventory SET quantity = 300.000, reserved_quantity = 0 WHERE product_variant_id = $1`, [P1L]);

    // ---------- X7: approve + contending checkout + cancel (mandatory trio) ----------
    await db.query(`UPDATE inventory SET quantity = 1.000, reserved_quantity = 0 WHERE product_variant_id = $1`, [P1L]);
    const ox7 = await (async () => {
      const cart = await mkCart([[P330, "2"]]);
      const o = await jpost(`/api/store/orders`,
        { customerId: idC1, addressId: idA1, idempotencyKey: key("x7o") }, { "x-guest-token": cart.token });
      return o.body.data.order;
    })();
    const ox7items = (await jget(`/api/store/orders/${ox7.id}?customerId=${idC1}`)).body.data.order.items;
    const px7 = await jpost(`/api/admin/orders/${ox7.id}/items/${ox7items[0].id}/replacements`,
      { replacementVariantId: P1L, replacementQuantity: "1" }, ck);
    const idRX7 = px7.body.data.id;
    const cx7 = await mkCart([[P1L, "1"]]);
    const [x7a, x7b, x7c] = await Promise.all([
      jpost(`/api/store/orders/${ox7.id}/replacements/${idRX7}/decide`, { customerId: idC1, action: "approve" }),
      jpost(`/api/store/orders`, { customerId: idC2, addressId: idA2, idempotencyKey: key("x7b") }, { "x-guest-token": cx7.token }),
      jpost(`/api/store/orders/${ox7.id}/cancel`, { customerId: idC1 }),
    ]);
    const trio = [x7a.status, x7b.status, x7c.status];
    t("x7-terminates", trio.every((s) => s === 200 || s === 201 || s === 409), JSON.stringify(trio));
    const invP1L = await reservedOf(P1L);
    const invP330 = await reservedOf(P330);
    t("x7-invariants", num(invP1L.r) >= 0 && num(invP1L.r) <= num(invP1L.q) && num(invP330.r) >= 0, JSON.stringify([invP1L, invP330]));
    const o7row = await q(`SELECT status FROM orders WHERE id = $1`, [ox7.id]);
    const r7row = await q(`SELECT status, replacement_order_item_id FROM order_item_replacements WHERE id = $1`, [idRX7]);
    const approvedOk = x7a.status === 200;
    const cancelledOk = x7c.status === 200;
    const coherent =
      (!approvedOk && r7row[0].status === "PROPOSED") ||
      (approvedOk && (r7row[0].status === "CUSTOMER_APPROVED") &&
        (o7row[0].status === "CONFIRMED" || (o7row[0].status === "CANCELLED" && cancelledOk)));
    t("x7-coherent", coherent, `${o7row[0].status}/${r7row[0].status}/${JSON.stringify(trio)}`);
    if (approvedOk && !cancelledOk) {
      t("x7-hold-conserved", invP1L.r === "1.000");
    } else if (!approvedOk && x7b.status === 201) {
      t("x7-hold-conserved", invP1L.r === "1.000");
    } else {
      t("x7-hold-conserved", invP1L.r === "0.000", JSON.stringify(trio));
    }
    await db.query(`UPDATE inventory SET quantity = 300.000, reserved_quantity = 0 WHERE product_variant_id = $1`, [P1L]);

    // ---------- X8: RBAC change mid-session (owner session: users/roles keys) ----------
    const cko = { cookie: owner.cookie };
    const tagX8 = Date.now().toString(36);
    const r8 = await jpost(`/api/admin/roles`, { name: `BA10_X8_${tagX8}`.toUpperCase() }, cko);
    const idR8 = r8.body.data.id;
    cleanupRoles.push(idR8);
    const permUsersView = await q(`SELECT id FROM permissions WHERE key = 'users.view'`);
    await jpost(`/api/admin/roles/${idR8}/grants`, { permissionId: permUsersView[0].id }, cko);
    const u8b = await jpost(`/api/admin/users`, { name: "BA10 X8b", email: `ba10-x8b-${tagX8}@example.com` }, cko);
    const idU8b = u8b.body.data.id;
    cleanupUsers.push(idU8b);
    await jpost(`/api/admin/users/${idU8b}/roles`, { roleId: idR8 }, cko);
    await jpost(`/api/admin/users/${idU8b}/password`, { password: "Ba10-X8-Pass-0002!" }, cko);
    const sessU8 = await loginAs(`ba10-x8b-${tagX8}@example.com`, "Ba10-X8-Pass-0002!");
    const ckU8 = { cookie: sessU8.cookie };
    const [x8a, x8b] = await Promise.all([
      jpatch(`/api/admin/users/${idU8b}`, { isActive: false }, cko),
      jget(`/api/admin/users?limit=1`, ckU8),
    ]);
    t("x8a-deactivate-then-401or200", (x8a.status === 200) && (x8b.status === 200 || x8b.status === 401), JSON.stringify([x8a.status, x8b.status]));
    const afterDeact = await jget(`/api/admin/users?limit=1`, ckU8);
    t("x8a-final-401", afterDeact.status === 401);
    await jpatch(`/api/admin/users/${idU8b}`, { isActive: true }, cko);
    const [x8c, x8d] = await Promise.all([
      jpatch(`/api/admin/roles/${idR8}`, { isActive: false }, cko),
      jget(`/api/admin/users?limit=1`, ckU8),
    ]);
    t("x8b-roleoff-then-403or200", x8c.status === 200 && (x8d.status === 200 || x8d.status === 403), JSON.stringify([x8c.status, x8d.status]));
    const afterRoleOff = await jget(`/api/admin/users?limit=1`, ckU8);
    t("x8b-final-403", afterRoleOff.status === 403);
    await jpatch(`/api/admin/roles/${idR8}`, { isActive: true }, cko);
    await jpatch(`/api/admin/users/${idU8b}`, { isActive: false }, cko);
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
      for (const uid of cleanupUsers) {
        await db.query(`DELETE FROM audit_logs WHERE user_id = $1`, [uid]).catch(() => {});
        await db.query(`DELETE FROM admin_sessions WHERE user_id = $1`, [uid]).catch(() => {});
        await db.query(`DELETE FROM user_roles WHERE user_id = $1`, [uid]).catch(() => {});
        await db.query(`DELETE FROM users WHERE id = $1`, [uid]).catch(() => {});
      }
      for (const rid of cleanupRoles) {
        await db.query(`DELETE FROM role_permissions WHERE role_id = $1`, [rid]).catch(() => {});
        await db.query(`DELETE FROM user_roles WHERE role_id = $1`, [rid]).catch(() => {});
        await db.query(`DELETE FROM roles WHERE id = $1`, [rid]).catch(() => {});
      }
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

const cleanupUsers = [];
const cleanupRoles = [];

main().catch((e) => {
  console.error(`XMODULE_SUITE_FAILED: ${e.constructor.name}: ${String(e.message).slice(0, 200)}`);
  console.error(String(e.stack).split("\n").slice(0, 4).join(" | "));
  process.exit(1);
});
