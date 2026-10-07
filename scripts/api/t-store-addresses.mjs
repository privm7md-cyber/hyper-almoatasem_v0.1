// PHASE 1+2 storefront address API verification (real PostgreSQL, scratch-only).
// Usage: node scripts/api/t-store-addresses.mjs --db <name> --port <port>
// Covers the storefront address book end to end through the REAL routes
// (no test doubles) under PHASE 2 identity: the owner is server-derived
// from the verified customer session — no customerId travels anywhere.
// create / list / get / patch / delete, strict validation, unauthenticated
// refusal (401) on all five operations, forged/tampered/random token
// rejection, explicit cross-customer (A session -> B address) refusal,
// checkout compatibility (own address 201, foreign 404, sessionless 401),
// and proof that self-service mutations write no audit rows.
// Direct SQL is used only for fixture guards, fault verification, and
// cleanup. Prints JSON, no secrets.
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
  console.log(JSON.stringify({ suite: "store-addresses", db: dbName, total: results.length, failures: failures.length, failed: failures.map((f) => f.name), passed: results.filter((r) => r.pass).map((r) => r.name) }, null, 2));
  process.exitCode = code ?? (failures.length === 0 ? 0 : 2);
};

const ALLOWED = [
  "hyper_almoatasem_scratch",
  "hyper_almoatasem_scratch_official_20260923",
  "hyper_almoatasem_hardening_20260924",
  "hyper_almoatasem_staging_20260924",
];

const P_A = "01097000011";
const P_B = "01097000022";
const P_C = "01097000033";
const CANON = (p) => "2010" + p.slice(3);
const P330 = "01800000-0000-7000-8000-000000000201";
const H = (tok) => ({ "x-customer-token": tok });

const addrBody = (phone, extra = {}) => ({
  city: "Matai",
  area: "Markaz",
  street: "El-Gomhoreya",
  buildingNumber: "12",
  landmark: "Near mosque",
  phone,
  ...extra,
});

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
  try {
    const cat = await fetch(`${baseUrl}/api/store/catalog/products?limit=1`);
    const catBody = await cat.json().catch(() => ({}));
    if (!JSON.stringify(catBody).includes("01800000-0000-7000-8000-000000000200")) {
      console.error(`REFUSED_WRONG_SERVER_DB: server is not bound to scratch fixtures`);
      process.exit(1);
    }
  } catch (e) {
    console.error(`REFUSED_NO_SERVER: catalog probe failed (${String(e.message).slice(0, 80)})`);
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
    return { status: r.status, body: await r.json().catch(() => ({})), headers: r.headers };
  };
  const get = async (path, headers = {}) => {
    const r = await fetch(`${baseUrl}${path}`, { headers });
    return { status: r.status, body: await r.json().catch(() => ({})), headers: r.headers };
  };
  const post = (path, data, headers = {}) => jcall("POST", path, data, headers);
  const patch = (path, data, headers = {}) => jcall("PATCH", path, data, headers);
  const del = (path, headers = {}) => jcall("DELETE", path, undefined, headers);

  const noSecrets = (o) => !JSON.stringify(o).includes("passwordHash") && !JSON.stringify(o).includes("password_hash")
    && !JSON.stringify(o).includes("argon2") && !JSON.stringify(o).includes("token_hash")
    && !JSON.stringify(o).includes("__Host-admin-session");

  const stamp = Date.now().toString(36);
  const keySeq = { n: 0 };
  const key = (p) => `saddr-${p}-${stamp}-${keySeq.n++}`;

  const PW = "Cust-Test-Pass-0001!";
  const sess = async (phone, firstName) => {
    // PHASE 2.5: register (fresh → 201 + session) or login (existing → 200).
    const reg = await post(`/api/store/customers/register`, { phone, firstName, password: PW });
    if (reg.status === 201) {
      return {
        status: reg.status,
        id: reg.body?.data?.customer?.id ?? null,
        tok: reg.body?.data?.customerToken ?? null,
        body: reg.body,
        headers: reg.headers,
      };
    }
    const r = await post(`/api/store/customers/session`, { phone, password: PW });
    return {
      status: r.status,
      id: r.body?.data?.customer?.id ?? null,
      tok: r.body?.data?.customerToken ?? null,
      body: r.body,
      headers: r.headers,
    };
  };

  try {
    // ---------- session bootstrap ----------
    const sA = await sess(P_A, "SaddrA");
    t("setup-session-A", (sA.status === 201 || sA.status === 200) && !!sA.id && !!sA.tok, `${sA.status}`);
    const sB = await sess(P_B, "SaddrB");
    t("setup-session-B", (sB.status === 201 || sB.status === 200) && !!sB.id && !!sB.tok && sB.id !== sA.id, `${sB.status}`);
    const sC = await sess(P_C, "SaddrC");
    t("setup-session-C", !!sC.id && !!sC.tok, `${sC.status}`);
    t("session-shape", /^[0-9a-f]{64}$/i.test(sA.tok || "")
      && typeof sA.body?.data?.expiresAt === "string" && noSecrets(sA.body));
    t("session-sets-cookie", (sA.headers.get("set-cookie") || "").includes("__Host-customer-session="));
    const meA = await get(`/api/store/customers/session`, H(sA.tok));
    t("session-get-current", meA.status === 200 && meA.body?.data?.customer?.id === sA.id, `${meA.status}`);
    const meNone = await get(`/api/store/customers/session`);
    t("session-get-no-session-401", meNone.status === 401, `${meNone.status}`);
    if (!sA.tok || !sB.tok || !sC.tok) return done(2);
    const auditBefore = Number((await q(`SELECT count(*) c FROM audit_logs`))[0].c);

    // ---------- unauthenticated refusal (all five operations) ----------
    const uCreate = await post(`/api/store/customers/addresses`, addrBody(P_A));
    const uList = await get(`/api/store/customers/addresses`);
    t("no-session-create-401", uCreate.status === 401, `${uCreate.status}`);
    t("no-session-list-401", uList.status === 401, `${uList.status}`);
    const uGet = await get(`/api/store/customers/addresses/01800000-0000-7000-8000-000000009999`);
    const uPatch = await patch(`/api/store/customers/addresses/01800000-0000-7000-8000-000000009999`, { city: "X" });
    const uDel = await del(`/api/store/customers/addresses/01800000-0000-7000-8000-000000009999`);
    t("no-session-get-401", uGet.status === 401, `${uGet.status}`);
    t("no-session-patch-401", uPatch.status === 401, `${uPatch.status}`);
    t("no-session-delete-401", uDel.status === 401, `${uDel.status}`);
    const forged = await get(`/api/store/customers/addresses`, { "x-customer-token": "ab".repeat(32) });
    t("forged-token-401", forged.status === 401, `${forged.status}`);
    const tampered = await get(`/api/store/customers/addresses`, H("cd".repeat(32)));
    t("tampered-token-401", tampered.status === 401, `${tampered.status}`);

    // ---------- CREATE ----------
    const a1 = await post(`/api/store/customers/addresses`, addrBody(P_A), H(sA.tok));
    const idAddrA = a1.body?.data?.id ?? null;
    t("create-valid-201", a1.status === 201 && !!idAddrA
      && a1.body.data.customerId === sA.id && a1.body.data.city === "Matai"
      && a1.body.meta !== undefined && noSecrets(a1.body), `${a1.status}`);
    const badPayload = await post(`/api/store/customers/addresses`, { city: "", phone: P_A }, H(sA.tok));
    t("create-invalid-400", badPayload.status === 400, `${badPayload.status}`);
    const unknownField = await post(`/api/store/customers/addresses`, { ...addrBody(P_A), governorate: "Menia" }, H(sA.tok));
    t("create-unknown-field-400", unknownField.status === 400, `${unknownField.status}`);
    const claimField = await post(`/api/store/customers/addresses`, { ...addrBody(P_A), customerId: sB.id }, H(sA.tok));
    t("create-customerId-claim-rejected-400", claimField.status === 400, `${claimField.status}`);
    const b1 = await post(`/api/store/customers/addresses`, addrBody(P_B), H(sB.tok));
    const idAddrB = b1.body?.data?.id ?? null;
    t("create-B-201", b1.status === 201 && !!idAddrB, `${b1.status}`);

    // ---------- LIST ----------
    const lA = await get(`/api/store/customers/addresses`, H(sA.tok));
    t("list-only-own", lA.status === 200 && Array.isArray(lA.body?.data)
      && lA.body.data.length === 1 && lA.body.data[0].id === idAddrA
      && lA.body.data.every((a) => a.customerId === sA.id), `${lA.status}:${lA.body?.data?.length}`);
    const lB = await get(`/api/store/customers/addresses`, H(sB.tok));
    t("list-B-only-own", lB.status === 200 && lB.body.data.length === 1 && lB.body.data[0].id === idAddrB, `${lB.status}`);
    const lC = await get(`/api/store/customers/addresses`, H(sC.tok));
    t("list-empty", lC.status === 200 && Array.isArray(lC.body?.data) && lC.body.data.length === 0, `${lC.status}`);

    // ---------- GET ----------
    const gA = await get(`/api/store/customers/addresses/${idAddrA}`, H(sA.tok));
    t("get-owned-200", gA.status === 200 && gA.body?.data?.id === idAddrA, `${gA.status}`);
    const gForeign = await get(`/api/store/customers/addresses/${idAddrB}`, H(sA.tok));
    t("get-foreign-404", gForeign.status === 404, `${gForeign.status}`);
    const gBadId = await get(`/api/store/customers/addresses/not-a-uuid`, H(sA.tok));
    t("get-invalid-id-400", gBadId.status === 400, `${gBadId.status}`);

    // ---------- PATCH ----------
    const p1 = await patch(`/api/store/customers/addresses/${idAddrA}`, { city: "Samalut", landmark: "Near school" }, H(sA.tok));
    t("patch-owned-200", p1.status === 200 && p1.body?.data?.city === "Samalut"
      && p1.body.data.landmark === "Near school" && p1.body.data.id === idAddrA, `${p1.status}`);
    const pPartial = await patch(`/api/store/customers/addresses/${idAddrA}`, { street: "El-Nasr" }, H(sA.tok));
    t("patch-partial-keeps-rest", pPartial.status === 200 && pPartial.body?.data?.street === "El-Nasr"
      && pPartial.body.data.city === "Samalut", `${pPartial.status}`);
    const pForeign = await patch(`/api/store/customers/addresses/${idAddrB}`, { city: "Matai" }, H(sA.tok));
    t("patch-foreign-404", pForeign.status === 404, `${pForeign.status}`);
    const pIdField = await patch(`/api/store/customers/addresses/${idAddrA}`, { id: idAddrB }, H(sA.tok));
    t("patch-id-immutable-400", pIdField.status === 400, `${pIdField.status}`);
    const pBad = await patch(`/api/store/customers/addresses/${idAddrA}`, { city: "" }, H(sA.tok));
    t("patch-invalid-400", pBad.status === 400, `${pBad.status}`);

    // ---------- self-service writes no audit rows ----------
    const auditAfterWrites = Number((await q(`SELECT count(*) c FROM audit_logs`))[0].c);
    t("self-service-unaudited", auditAfterWrites === auditBefore, `${auditBefore}->${auditAfterWrites}`);

    // ---------- session cookie transport ----------
    const cookieA = `__Host-customer-session=${encodeURIComponent(sA.tok)}`;
    const lCookie = await get(`/api/store/customers/addresses`, { cookie: cookieA });
    t("cookie-transport-200", lCookie.status === 200 && lCookie.body?.data?.length === 1, `${lCookie.status}`);

    // ---------- CHECKOUT integration (session-derived owner) ----------
    const cart = await post(`/api/store/cart`, {}, H(sA.tok));
    const cartOk = (cart.status === 201 || cart.status === 200) && !!cart.body?.data?.cart?.id;
    t("checkout-cart-ready", cartOk, `${cart.status}`);
    let orderId = null;
    if (cartOk) {
      const add = await post(`/api/store/cart/items`, { productVariantId: P330, quantity: "2" }, H(sA.tok));
      t("checkout-cart-add", add.status === 200 || add.status === 201, `${add.status}`);
      const coForeign = await post(`/api/store/orders`, { addressId: idAddrB, idempotencyKey: key("foreign") }, H(sA.tok));
      t("checkout-foreign-address-404", coForeign.status === 404, `${coForeign.status}`);
      const co = await post(`/api/store/orders`, { addressId: idAddrA, idempotencyKey: key("own") }, H(sA.tok));
      orderId = co.body?.data?.order?.id ?? null;
      t("checkout-own-address-201", co.status === 201 && !!orderId, `${co.status}`);
      const coNoSess = await post(`/api/store/orders`, { addressId: idAddrA, idempotencyKey: key("nosess") });
      t("checkout-no-session-401", coNoSess.status === 401, `${coNoSess.status}`);
      if (orderId) {
        const cx = await post(`/api/store/orders/${orderId}/cancel`, {}, H(sA.tok));
        t("checkout-cancel-releases", cx.status === 200, `${cx.status}`);
      } else {
        t("checkout-cancel-releases", false, "no order");
      }
    } else {
      t("checkout-cart-add", false, "cart not ready");
      t("checkout-foreign-address-404", false, "cart not ready");
      t("checkout-own-address-201", false, "cart not ready");
      t("checkout-no-session-401", false, "cart not ready");
      t("checkout-cancel-releases", false, "cart not ready");
    }

    // ---------- DELETE ----------
    const dForeign = await del(`/api/store/customers/addresses/${idAddrB}`, H(sA.tok));
    t("delete-foreign-404", dForeign.status === 404, `${dForeign.status}`);
    const dBadId = await del(`/api/store/customers/addresses/not-a-uuid`, H(sA.tok));
    t("delete-invalid-id-400", dBadId.status === 400, `${dBadId.status}`);
    const dA = await del(`/api/store/customers/addresses/${idAddrA}`, H(sA.tok));
    t("delete-owned-200", dA.status === 200 && dA.body?.data?.deleted === true, `${dA.status}`);
    const gGone = await get(`/api/store/customers/addresses/${idAddrA}`, H(sA.tok));
    t("delete-gone-404", gGone.status === 404, `${gGone.status}`);
    if (orderId) {
      const rows = await q(`SELECT delivery_city FROM orders WHERE id = $1`, [orderId]);
      t("delete-order-snapshot-intact", rows.length === 1 && !!rows[0].delivery_city, `${rows.length}`);
    } else {
      t("delete-order-snapshot-intact", false, "no order");
    }
    const dB = await del(`/api/store/customers/addresses/${idAddrB}`, H(sB.tok));
    t("delete-B-cleanup-200", dB.status === 200, `${dB.status}`);

    // ---------- logout clears the cookie ----------
    const lo = await del(`/api/store/customers/session`, H(sA.tok));
    t("logout-clears-cookie", lo.status === 200 && lo.body?.data?.loggedOut === true
      && (lo.headers.get("set-cookie") || "").includes("__Host-customer-session="), `${lo.status}`);
  } finally {
    try {
      for (const ph of [P_A, P_B, P_C].map(CANON)) {
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
      for (const ph of [P_A, P_B, P_C].map(CANON)) {
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
