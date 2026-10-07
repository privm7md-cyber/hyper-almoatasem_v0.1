// PHASE 2 IDOR + authentication-boundary audit (real PostgreSQL, scratch-only).
// Usage: node scripts/api/t-store-idor.mjs --db <name> --port <port>
// Proves, through the REAL routes: no customer can read/mutate/cancel/decide
// another customer's cart, orders, replacements, addresses, or customer data;
// client-supplied customerId claims are rejected (strict 400) everywhere;
// missing/malformed/forged sessions answer 401; guest-token-only checkout
// answers 401; token+session ambiguity answers 400.
// Direct SQL is used only for fixture guards and cleanup.
// Prints JSON, no secrets.
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
  console.log(JSON.stringify({ suite: "store-idor", db: dbName, total: results.length, failures: failures.length, failed: failures.map((f) => f.name), passed: results.filter((r) => r.pass).map((r) => r.name) }, null, 2));
  process.exitCode = code ?? (failures.length === 0 ? 0 : 2);
};

const ALLOWED = [
  "hyper_almoatasem_scratch",
  "hyper_almoatasem_scratch_official_20260923",
  "hyper_almoatasem_hardening_20260924",
  "hyper_almoatasem_staging_20260924",
];

const P_A = "01098000041";
const P_B = "01098000042";
const CANON = (p) => "2010" + p.slice(3);
const P330 = "01800000-0000-7000-8000-000000000201";
const ROMI_V = "01800000-0000-7000-8000-000000000101";
const H = (tok) => ({ "x-customer-token": tok });
const FORGED = "v1.01800000-0000-7000-8000-000000000201.1790000000." + "ab".repeat(32);

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

  const jcall = async (method, path, body, headers = {}) => {
    const r = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const get = async (path, headers = {}) => {
    const r = await fetch(`${baseUrl}${path}`, { headers });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const post = (path, data, headers = {}) => jcall("POST", path, data, headers);
  const patch = (path, data, headers = {}) => jcall("PATCH", path, data, headers);
  const stamp = Date.now().toString(36);
  const key = (p) => `idor-${p}-${stamp}`;

  const PW = "Cust-Test-Pass-0001!";
  const sess = async (phone, firstName) => {
    const reg = await post(`/api/store/customers/register`, { phone, firstName, password: PW });
    if (reg.status === 201) {
      return { id: reg.body?.data?.customer?.id ?? null, tok: reg.body?.data?.customerToken ?? null };
    }
    const r = await post(`/api/store/customers/session`, { phone, password: PW });
    return { id: r.body?.data?.customer?.id ?? null, tok: r.body?.data?.customerToken ?? null };
  };

  try {
    const sA = await sess(P_A, "IdorA");
    const sB = await sess(P_B, "IdorB");
    if (!sA.tok || !sB.tok) { t("setup-sessions", false, "mint failed"); return done(2); }
    t("setup-sessions", sA.id !== sB.id, "distinct");

    // ---------- customer data isolation ----------
    const meA = await get(`/api/store/customers/session`, H(sA.tok));
    const meB = await get(`/api/store/customers/session`, H(sB.tok));
    t("session-returns-own-A", meA.status === 200 && meA.body?.data?.customer?.id === sA.id, `${meA.status}`);
    t("session-returns-own-B", meB.status === 200 && meB.body?.data?.customer?.id === sB.id
      && !JSON.stringify(meB.body).includes(sA.id), `${meB.status}`);
    t("session-no-token-401", (await get(`/api/store/customers/session`)).status === 401);
    t("session-forged-401", (await get(`/api/store/customers/session`, H(FORGED))).status === 401);
    t("session-malformed-401", (await get(`/api/store/customers/session`, H("not-a-token"))).status === 401);

    // ---------- cart isolation (carts are owner-resolved: B has no handle on A's cart) ----------
    await post(`/api/store/cart`, {}, H(sA.tok));
    await post(`/api/store/cart/items`, { productVariantId: P330, quantity: "7" }, H(sA.tok));
    await post(`/api/store/cart`, {}, H(sB.tok));
    const cartB = await get(`/api/store/cart`, H(sB.tok));
    const bLines = cartB.body?.data?.cart?.lines ?? [];
    t("cart-B-clean", cartB.status === 200 && bLines.length === 0, `${cartB.status}:${bLines.length}`);
    const mutB = await post(`/api/store/cart/items`, { productVariantId: ROMI_V, quantity: "0.250" }, H(sB.tok));
    t("cart-B-mutation-own-only", mutB.status === 200
      && mutB.body?.data?.cart?.lines?.length === 1
      && mutB.body?.data?.cart?.customerId === sB.id, `${mutB.status}`);
    const cartA = await get(`/api/store/cart`, H(sA.tok));
    t("cart-A-untouched", cartA.status === 200
      && (cartA.body?.data?.cart?.lines ?? []).some((l) => l.productVariantId === P330 && Number(l.quantity) === 7),
      `${cartA.status}`);
    const bothSides = await get(`/api/store/cart`, { "x-guest-token": "ab".repeat(32), ...H(sA.tok) });
    t("cart-token-plus-session-400", bothSides.status === 400, `${bothSides.status}`);

    // ---------- addresses: A creates, B cannot touch ----------
    const aA = await post(`/api/store/customers/addresses`, { city: "Matai", phone: P_A }, H(sA.tok));
    const idAddrA = aA.body?.data?.id ?? null;
    t("addr-A-created", aA.status === 201 && !!idAddrA, `${aA.status}`);
    const gAddrB = await get(`/api/store/customers/addresses/${idAddrA}`, H(sB.tok));
    const pAddrB = await patch(`/api/store/customers/addresses/${idAddrA}`, { city: "Elsewhere" }, H(sB.tok));
    const dAddrB = await jcall("DELETE", `/api/store/customers/addresses/${idAddrA}`, undefined, H(sB.tok));
    t("addr-B-get-404", gAddrB.status === 404, `${gAddrB.status}`);
    t("addr-B-patch-404", pAddrB.status === 404, `${pAddrB.status}`);
    t("addr-B-delete-404", dAddrB.status === 404, `${dAddrB.status}`);

    // ---------- orders: A checks out, B cannot read/cancel ----------
    const oA = await post(`/api/store/orders`, { addressId: idAddrA, idempotencyKey: key("a") }, H(sA.tok));
    const idOrdA = oA.body?.data?.order?.id ?? null;
    t("order-A-201", oA.status === 201 && !!idOrdA, `${oA.status}`);
    const gOrdB = await get(`/api/store/orders/${idOrdA}`, H(sB.tok));
    const cOrdB = await post(`/api/store/orders/${idOrdA}/cancel`, {}, H(sB.tok));
    t("order-B-get-404", gOrdB.status === 404, `${gOrdB.status}`);
    t("order-B-cancel-404", cOrdB.status === 404, `${cOrdB.status}`);
    // Forged customerId claims are rejected as unknown fields (strict), never honored.
    const claimOrder = await post(`/api/store/orders`, { customerId: sB.id, addressId: idAddrA, idempotencyKey: key("claim") }, H(sA.tok));
    t("order-customerId-claim-400", claimOrder.status === 400, `${claimOrder.status}`);
    const claimCancel = await post(`/api/store/orders/${idOrdA}/cancel`, { customerId: sB.id }, H(sA.tok));
    t("cancel-customerId-claim-400", claimCancel.status === 400, `${claimCancel.status}`);
    const claimAddr = await post(`/api/store/customers/addresses`, { customerId: sB.id, city: "X", phone: P_A }, H(sA.tok));
    t("address-customerId-claim-400", claimAddr.status === 400, `${claimAddr.status}`);
    const claimEst = await post(`/api/store/orders/estimate`, { customerId: sB.id, lines: [{ productVariantId: P330, quantity: "1" }] }, H(sA.tok));
    t("estimate-customerId-claim-400", claimEst.status === 400, `${claimEst.status}`);

    // ---------- replacements: B cannot list on A's real order ----------
    // (A's order exists → 404 proves foreign-rejection, not just unknown.
    // Decide-side foreign rejection is covered in t-replacements.)
    const repListB = await get(`/api/store/orders/${idOrdA}/replacements`, H(sB.tok));
    t("repl-B-list-404", repListB.status === 404, `${repListB.status}`);
    const repListA = await get(`/api/store/orders/${idOrdA}/replacements`, H(sA.tok));
    t("repl-A-list-200", repListA.status === 200 && Array.isArray(repListA.body?.data), `${repListA.status}`);

    // ---------- guest-token-only checkout refused ----------
    const gG = await post(`/api/store/cart`, {});
    const tokG = gG.body?.data?.guestToken;
    const gidG = gG.body?.data?.cart?.id;
    await post(`/api/store/cart/items`, { productVariantId: P330, quantity: "1" }, { "x-guest-token": tokG });
    const gCo = await post(`/api/store/orders`, { addressId: idAddrA, idempotencyKey: key("guest") }, { "x-guest-token": tokG });
    t("checkout-guest-only-401", gCo.status === 401, `${gCo.status}`);
    await db.query(`DELETE FROM cart_items WHERE cart_id = $1`, [gidG]).catch(() => {});
    await db.query(`DELETE FROM carts WHERE id = $1`, [gidG]).catch(() => {});

    // Cleanup A's order via API (releases holds through the real path).
    const cxA = await post(`/api/store/orders/${idOrdA}/cancel`, {}, H(sA.tok));
    t("cleanup-cancel-200", cxA.status === 200, `${cxA.status}`);
  } finally {
    try {
      for (const ph of [P_A, P_B].map(CANON)) {
        const rows = await q(`SELECT id FROM customers WHERE phone = $1`, [ph]).catch(() => []);
        for (const r of rows) {
          await db.query(`DELETE FROM customer_sessions WHERE customer_id = $1`, [r.id]).catch(() => {});
          await db.query(`DELETE FROM customer_addresses WHERE customer_id = $1`, [r.id]).catch(() => {});
          const cc = await db.query(`SELECT id FROM carts WHERE customer_id = $1`, [r.id]).catch(() => ({ rows: [] }));
          for (const c of cc.rows) {
            await db.query(`DELETE FROM cart_items WHERE cart_id = $1`, [c.id]).catch(() => {});
            await db.query(`DELETE FROM carts WHERE id = $1`, [c.id]).catch(() => {});
          }
          await db.query(`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE customer_id = $1)`, [r.id]).catch(() => {});
          await db.query(`DELETE FROM order_discounts WHERE order_id IN (SELECT id FROM orders WHERE customer_id = $1)`, [r.id]).catch(() => {});
          await db.query(`DELETE FROM order_status_history WHERE order_id IN (SELECT id FROM orders WHERE customer_id = $1)`, [r.id]).catch(() => {});
          await db.query(`DELETE FROM coupon_usages WHERE order_id IN (SELECT id FROM orders WHERE customer_id = $1)`, [r.id]).catch(() => {});
          await db.query(`DELETE FROM orders WHERE customer_id = $1`, [r.id]).catch(() => {});
        }
      }
      for (const ph of [P_A, P_B].map(CANON)) {
        await db.query(`DELETE FROM customers WHERE phone = $1`, [ph]).catch(() => {});
      }
    } catch { /* scratch hygiene best-effort */ }
    await db.end().catch(() => {});
  }
  done();
}

main().catch((e) => {
  console.error(`FATAL: ${String(e && e.message ? e.message : e).slice(0, 160)}`);
  process.exit(1);
});
