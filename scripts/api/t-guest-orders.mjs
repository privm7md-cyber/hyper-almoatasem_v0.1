// BG-GUEST-ORDER verification (real PostgreSQL, scratch-only).
// Usage: node scripts/api/t-guest-orders.mjs --db <name> --port <port>
// Covers true account-less guest orders end to end through the REAL routes
// (no test doubles): guest creation (201 + one-time credential, NULL
// customer_id, GUEST/NULL history), token auth (read/cancel/decide),
// separation (guest-A x guest-B, guest x customer, number/phone alone),
// expiry 410 / revocation 401 / rotation, keep-same idempotent replay,
// concurrency (single winner), no-link on later registration, per-customer
// coupon 422 + global coupon path, fulfillment smoke to DELIVERED, rate
// buckets (create 10 + read 60, isolated fake-IP scopes), raw-token
// non-persistence (DB + responses + errors + admin surfaces), and full
// registered-customer regression alongside. Direct SQL only for fixture
// guards, fault injection (expiry/buckets), and cleanup.
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
  console.log(JSON.stringify({ suite: "guest-orders", db: dbName, total: results.length, failures: failures.length, failed: failures.map((f) => f.name), passed: results.filter((r) => r.pass).map((r) => r.name) }, null, 2));
  process.exitCode = code ?? (failures.length === 0 ? 0 : 2);
};

const ALLOWED = [
  "hyper_almoatasem_scratch",
  "hyper_almoatasem_scratch_official_20260923",
  "hyper_almoatasem_hardening_20260924",
  "hyper_almoatasem_staging_20260924",
];

const OWNER_EMAIL = "owner@hyper-al-moatasem.local";
const OWNER_PW = "Cat-Test-Owner-Pass-0001!";
const STORE_EMAIL = "store-cat-test@example.com";
const STORE_PW = "Cat-Test-Store-Pass-0002!";
const BARE_EMAIL = "bare-cat-test@example.com";
const BARE_PW = "Cat-Test-Bare-Pass-0003!";
const CPW = "Cust-Test-Pass-0001!";
const P330 = "01800000-0000-7000-8000-000000000201";
const P1L = "01800000-0000-7000-8000-000000000202";
const H = (tok) => ({ "x-customer-token": tok });
const G = (tok, xff) => ({ "x-guest-token": tok, ...(xff ? { "x-forwarded-for": xff } : {}) });
// Every guest read carries a fresh fake IP so the 60/15min read bucket
// never fills across reruns (each scope sees attempts=1); dedicated
// fixed-IP scopes below cover the over/under-limit proofs explicitly.
const GT = (tok) => ({ "x-guest-order-token": tok, "x-forwarded-for": xff() });
const HEX64 = /^[0-9a-f]{64}$/;
const num = (s) => Number(s);
// Canonical phone form stored in DB (frozen R8 ladder): "010..." → "2010"+rest.
const CANON = (p) => "2010" + p.slice(3);
// Isolated fake-IP scopes for guest traffic (real-IP buckets untouched).
const xffState = { n: 11 };
const xff = () => `10.9.8.${xffState.n++}`;

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
    const r = await fetch(`${baseUrl}${path}`, { headers: { ...headers } });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const post = (path, data, headers = {}) => jcall("POST", path, data, headers);
  const patch = (path, data, headers = {}) => jcall("PATCH", path, data, headers);
  const loginAs = async (email, password) => {
    const r = await fetch(`${baseUrl}/api/admin/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await r.json().catch(() => ({}));
    const m = (r.headers.get("set-cookie") || "").match(/__Host-admin-session=([^;]+)/);
    return { status: r.status, body, cookie: m ? `__Host-admin-session=${m[1]}` : null };
  };

  const stamp = Date.now().toString(36);
  const keySeq = { n: 0 };
  const key = (p) => `ggo-${p}-${stamp}-${keySeq.n++}`;
  const cartIds = new Set();
  const orderIds = new Set();
  const phones = new Set();
  const promoIds = new Set();
  const couponIds = new Set();


  const sess = async (phone, firstName) => {
    const reg = await post(`/api/store/customers/register`, { phone, firstName, password: CPW });
    phones.add(phone);
    if (reg.status === 201) {
      return { id: reg.body?.data?.customer?.id ?? null, tok: reg.body?.data?.customerToken ?? null };
    }
    const r = await post(`/api/store/customers/session`, { phone, password: CPW });
    return { id: r.body?.data?.customer?.id ?? null, tok: r.body?.data?.customerToken ?? null };
  };
  const mkGuestCart = async (lines) => {
    const g = await post(`/api/store/cart`, {});
    const tok = g.body?.data?.guestToken;
    cartIds.add(g.body?.data?.cart?.id);
    for (const [vid, qty] of lines) {
      await post(`/api/store/cart/items`, { productVariantId: vid, quantity: qty }, { "x-guest-token": tok });
    }
    return tok;
  };
  const guestPayload = (phone, k, extra = {}) => ({
    guestContact: { firstName: "Ghaz", lastName: null },
    guestAddress: { city: "Matai", area: null, village: null, street: "St 9", buildingNumber: "7", landmark: null, phone },
    idempotencyKey: k,
    ...extra,
  });
  const mkGuestOrder = async (lines, phone, k, extra = {}) => {
    const tok = await mkGuestCart(lines);
    const o = await post(`/api/store/orders`, guestPayload(phone, k, extra), G(tok, xff()));
    if (o.body?.data?.order?.id) orderIds.add(o.body.data.order.id);
    return { res: o, cartTok: tok };
  };
  const mkAddr = async (sessTok, phone) => {
    const a = await post(`/api/store/customers/addresses`, { city: "Matai", phone }, H(sessTok));
    return a.body?.data?.id ?? null;
  };
  const reservedOf = async (v) =>
    (await q(`SELECT reserved_quantity::text r FROM inventory WHERE product_variant_id = $1`, [v]))[0].r;
  const orderRowOf = async (id) =>
    (await q(`SELECT customer_id::text c, status s FROM orders WHERE id = $1`, [id]))[0];
  const histOf = async (id) =>
    await q(`SELECT actor_type a, actor_id::text i FROM order_status_history WHERE order_id = $1 ORDER BY created_at, id`, [id]);
  const credOf = async (id) =>
    (await q(`SELECT token_hash::text h, expires_at > now() live, revoked_at IS NULL unrev FROM guest_order_credentials WHERE order_id = $1`, [id]))[0];

  try {
    const owner = await loginAs(OWNER_EMAIL, OWNER_PW);
    const store = await loginAs(STORE_EMAIL, STORE_PW);
    const bare = await loginAs(BARE_EMAIL, BARE_PW);
    t("logins-ok", owner.status === 201 && store.status === 201 && bare.status === 201,
      `${owner.status}/${store.status}/${bare.status}`);
    if (owner.status !== 201 || store.status !== 201 || bare.status !== 201) {
      console.error(`REFUSED_LOGIN (retry after rollover)`);
      await db.end().catch(() => {});
      process.exit(1);
    }
    const ck = store.cookie;
    const ckb = bare.cookie;

    const PG1 = `01096${String(Date.now()).slice(-6)}`;
    const PG2 = `01097${String(Date.now() + 7).slice(-6)}`;

    // ---------- guest creation ----------
    const g1 = await mkGuestOrder([[P330, "2"]], PG1, key("g1"));
    const o1 = g1.res.body?.data?.order;
    const tok1 = g1.res.body?.data?.guestOrderToken;
    t("guest-create-201", g1.res.status === 201 && !!o1?.id && HEX64.test(tok1 ?? ""), `${g1.res.status}`);
    t("guest-customer-null", (await orderRowOf(o1.id)).c === null, JSON.stringify(await orderRowOf(o1.id)));
    const h1 = await histOf(o1.id);
    t("guest-history-guest-null", h1.length === 2 && h1.every((h) => h.a === "GUEST" && h.i === null), JSON.stringify(h1));
    const c1 = await credOf(o1.id);
    t("cred-hash-only", !!c1 && HEX64.test(c1.h) && c1.h !== tok1 && c1.live && c1.unrev, JSON.stringify({ ...c1, h: c1.h.slice(0, 8) }));
    t("raw-never-persisted", (await q(`SELECT count(*)::int n FROM guest_order_credentials WHERE token_hash = $1`, [tok1]))[0].n === 0);

    // ---------- token auth: read ----------
    const r1 = await get(`/api/store/orders/${o1.id}`, GT(tok1));
    t("guest-read-200", r1.status === 200 && r1.body?.data?.order?.id === o1.id, `${r1.status}`);
    t("guest-read-shape", r1.body?.data?.order?.orderNumber?.startsWith("HM-") && Array.isArray(r1.body?.data?.order?.items), "shape");
    t("no-token-in-read", !JSON.stringify(r1.body).includes(tok1), "leak-check");

    // ---------- separation ----------
    const g2 = await mkGuestOrder([[P330, "1"]], PG2, key("g2"));
    const o2 = g2.res.body?.data?.order;
    const tok2 = g2.res.body?.data?.guestOrderToken;
    // Invalid-for-this-order credentials answer 401 (never 404): right-token
    // × wrong-order must be indistinguishable from garbage-token, otherwise
    // the status would oracle order existence (SI-07). Unknown ids likewise
    // 401 for unauthenticated callers; 404 only for authed-but-foreign reads.
    t("guest-cross-401", (await get(`/api/store/orders/${o1.id}`, GT(tok2))).status === 401, "A×B");
    t("number-alone-401", (await get(`/api/store/orders/${o1.id}`)).status === 401, "no token");
    t("phone-alone-401", (await get(`/api/store/orders/${o1.id}`, { "x-guest-token": g2.cartTok })).status === 401, "cart token");
    t("wrong-order-token-401", (await get(`/api/store/orders/${o2.id}`, GT(tok1))).status === 401, "tokenA×orderB");

    // ---------- registered regression alongside ----------
    const s1 = await sess(PG1.replace(/^01096/, "01095"), "GReg");
    const idA1 = await mkAddr(s1.tok, PG1.replace(/^01096/, "01095"));
    const cart = await post(`/api/store/cart`, {}, H(s1.tok));
    cartIds.add(cart.body?.data?.cart?.id);
    await post(`/api/store/cart/items`, { productVariantId: P330, quantity: "1" }, H(s1.tok));
    const ro = await post(`/api/store/orders`, { addressId: idA1, idempotencyKey: key("reg") }, H(s1.tok));
    const roId = ro.body?.data?.order?.id;
    if (roId) orderIds.add(roId);
    t("registered-201", ro.status === 201 && !!roId, `${ro.status}`);
    t("registered-customer-set", roId && (await orderRowOf(roId)).c === s1.id, "ownership");
    t("registered-no-token", ro.body?.data?.guestOrderToken === undefined, "no credential field");
    t("registered-history-customer", (await histOf(roId)).every((h) => h.a === "CUSTOMER" && h.i === s1.id), "actor");
    t("customer-cannot-read-guest-404", (await get(`/api/store/orders/${o1.id}`, H(s1.tok))).status === 404, "separation");

    // ---------- ambiguity / misuse ----------
    const gAmb = await mkGuestCart([[P330, "1"]]);
    t("guest-with-addressId-400", (await post(`/api/store/orders`, { addressId: idA1, idempotencyKey: key("amb1") }, G(gAmb, xff()))).status === 400, "guest+addressId");
    t("session-with-guest-payload-400", (await post(`/api/store/orders`, guestPayload(PG1, key("amb2")), H(s1.tok))).status === 400, "session+guest");
    await db.query(`DELETE FROM cart_items WHERE cart_id IN (SELECT id FROM carts WHERE session_id IS NOT NULL AND status='ACTIVE' AND id NOT IN (SELECT cart_id FROM orders WHERE cart_id IS NOT NULL))`).catch(() => {});

    // ---------- replay keep-same ----------
    const gR = await mkGuestCart([[P330, "1"]]);
    const kR = key("replay");
    const rA = await post(`/api/store/orders`, guestPayload(PG1, kR), G(gR, xff()));
    const idR = rA.body?.data?.order?.id;
    if (idR) orderIds.add(idR);
    const tokR = rA.body?.data?.guestOrderToken;
    const rB = await post(`/api/store/orders`, guestPayload(PG1, kR), G(gR, xff()));
    t("replay-200-same", rB.status === 200 && rB.body?.data?.order?.id === idR && rB.body?.meta?.replay === true, `${rB.status}`);
    t("replay-no-token", rB.body?.data?.guestOrderToken === undefined && rB.body?.meta?.guestTokenIssued === false, "keep-same");
    t("replay-token-still-valid", (await get(`/api/store/orders/${idR}`, GT(tokR))).status === 200, "original works");
    const kR2 = key("replay2");
    const gR2 = await mkGuestCart([[P330, "1"]]);
    const cA = post(`/api/store/orders`, guestPayload(PG1, kR2), G(gR2, xff()));
    const cB = post(`/api/store/orders`, guestPayload(PG1, kR2), G(gR2, xff()));
    const [cRa, cRb] = await Promise.all([cA, cB]);
    const cIds = [cRa.body?.data?.order?.id, cRb.body?.data?.order?.id];
    if (cRa.body?.data?.order?.id) orderIds.add(cRa.body.data.order.id);
    t("concurrent-single", new Set(cIds).size === 1 && new Set([cRa.status, cRb.status]).size === 2, `${cRa.status}/${cRb.status}`);
    t("diff-cart-409", (await post(`/api/store/orders`, guestPayload(PG1, kR), G(await mkGuestCart([[P330, "1"]]), xff()))).status === 409, "key reuse");

    // ---------- guest cancel ----------
    const gC = await mkGuestOrder([[P330, "1"]], PG1, key("cancel"));
    const oC = gC.res.body?.data?.order;
    const tokC = gC.res.body?.data?.guestOrderToken;
    const resBefore = await reservedOf(P330);
    const cx = await post(`/api/store/orders/${oC.id}/cancel`, {}, GT(tokC));
    t("guest-cancel-200", cx.status === 200 && cx.body?.data?.order?.status === "CANCELLED", `${cx.status}`);
    t("guest-cancel-releases", num(resBefore) - num(await reservedOf(P330)) === 1, "hold");
    t("guest-cancel-history", (await histOf(oC.id)).some((h) => h.a === "GUEST" && h.i === null), "actor");
    t("guest-cancel-twice-409", (await post(`/api/store/orders/${oC.id}/cancel`, {}, GT(tokC))).status === 409, "replay");

    // ---------- replacement decide as guest ----------
    const gP = await mkGuestOrder([[P330, "1"]], PG1, key("rep"));
    const oP = gP.res.body?.data?.order;
    const tokP = gP.res.body?.data?.guestOrderToken;
    const itemsP = (await get(`/api/store/orders/${oP.id}`, GT(tokP))).body?.data?.order?.items ?? [];
    const lineP = itemsP.find((i) => i.productVariantId === P330);
    const pP = await post(`/api/admin/orders/${oP.id}/items/${lineP.id}/replacements`,
      { replacementVariantId: P1L, replacementQuantity: "1" }, { cookie: ck });
    const repId = pP.body?.data?.id;
    t("propose-201", pP.status === 201 && !!repId, `${pP.status}`);
    const repList = await get(`/api/store/orders/${oP.id}/replacements`, GT(tokP));
    t("guest-repl-list-200", repList.status === 200 && Array.isArray(repList.body?.data), `${repList.status}`);
    const dP = await post(`/api/store/orders/${oP.id}/replacements/${repId}/decide`, { action: "approve" }, GT(tokP));
    t("guest-approve-200", dP.status === 200 && dP.body?.data?.status === "CUSTOMER_APPROVED", `${dP.status}`);
    const decRow = (await q(`SELECT decided_by_type t, decided_by_id i FROM order_item_replacements WHERE id = $1`, [repId]))[0];
    t("guest-decider-guest-null", decRow.t === "GUEST" && decRow.i === null, JSON.stringify(decRow));
    const gQ = await mkGuestOrder([[P330, "1"]], PG2, key("rep2"));
    const oQ = gQ.res.body?.data?.order;
    const tokQ = gQ.res.body?.data?.guestOrderToken;
    const itemsQ = (await get(`/api/store/orders/${oQ.id}`, GT(tokQ))).body?.data?.order?.items ?? [];
    const pQ = await post(`/api/admin/orders/${oQ.id}/items/${itemsQ.find((i) => i.productVariantId === P330).id}/replacements`,
      { replacementVariantId: P1L, replacementQuantity: "1" }, { cookie: ck });
    const dQ = await post(`/api/store/orders/${oQ.id}/replacements/${pQ.body?.data?.id}/decide`, { action: "reject" }, GT(tokQ));
    t("guest-reject-200", dQ.status === 200 && dQ.body?.data?.status === "CUSTOMER_REJECTED", `${dQ.status}`);

    // ---------- no-link on later registration ----------
    const regSame = await post(`/api/store/customers/register`, { phone: PG1, firstName: "Later", password: CPW });
    phones.add(PG1);
    const sLater = regSame.status === 201
      ? { id: regSame.body?.data?.customer?.id, tok: regSame.body?.data?.customerToken }
      : await (async () => {
        const r = await post(`/api/store/customers/session`, { phone: PG1, password: CPW });
        return { id: r.body?.data?.customer?.id, tok: r.body?.data?.customerToken };
      })();
    t("later-register-ok", !!sLater.id && !!sLater.tok, `${regSame.status}`);
    t("guest-stays-guest", (await orderRowOf(o1.id)).c === null, "no backfill");
    t("token-survives-registration", (await get(`/api/store/orders/${o1.id}`, GT(tok1))).status === 200, "credential intact");
    t("session-cannot-read-guest", (await get(`/api/store/orders/${o1.id}`, H(sLater.tok))).status === 404, "separation");
    const myList = await get(`/api/store/orders?limit=20`, H(sLater.tok));
    t("history-excludes-guest", myList.status === 200 && !(myList.body?.data ?? []).some((o) => o.id === o1.id), "no merge");

    // ---------- coupons: per-customer 422, global path + NULL usage ----------
    const idPar = (await post(`/api/admin/promotions`, { name: `GGO par ${stamp}`, type: "FIXED_AMOUNT", scope: "ORDER", discountAmount: "5.00", priority: 100 }, { cookie: ck })).body?.data?.id;
    if (idPar) promoIds.add(idPar);
    await patch(`/api/admin/promotions/${idPar}`, { status: "ACTIVE" }, { cookie: ck });
    const codeLim = `GGOL${stamp}`.toUpperCase().slice(0, 10);
    const codeOpen = `GGOO${stamp}`.toUpperCase().slice(0, 10);
    const cpLim = await post(`/api/admin/coupons`, { promotionId: idPar, code: codeLim, perCustomerLimit: 1 }, { cookie: ck });
    const cpOpen = await post(`/api/admin/coupons`, { promotionId: idPar, code: codeOpen }, { cookie: ck });
    if (cpLim.body?.data?.id) couponIds.add(cpLim.body.data.id);
    if (cpOpen.body?.data?.id) couponIds.add(cpOpen.body.data.id);
    const gCp = await mkGuestOrder([[P330, "2"]], PG1, key("cpn"), { couponCode: codeLim });
    t("guest-limited-coupon-422", gCp.res.status === 422, `${gCp.res.status}`);
    const gCp2 = await mkGuestOrder([[P330, "2"]], PG1, key("cpn2"), { couponCode: codeOpen });
    const oCp2 = gCp2.res.body?.data?.order;
    if (oCp2?.id) orderIds.add(oCp2.id);
    t("guest-open-coupon-201", gCp2.res.status === 201, `${gCp2.res.status}`);
    t("guest-usage-null-customer", oCp2 && (await q(`SELECT customer_id::text c FROM coupon_usages WHERE order_id = $1`, [oCp2.id]))[0]?.c === null, "NULL usage");

    // ---------- expiry 410 / revoke 401 / rotate ----------
    const gE = await mkGuestOrder([[P330, "1"]], PG1, key("exp"));
    const oE = gE.res.body?.data?.order;
    const tokE = gE.res.body?.data?.guestOrderToken;
    await db.query(`UPDATE guest_order_credentials SET expires_at = now() - interval '1 minute' WHERE order_id = $1`, [oE.id]);
    t("expired-410", (await get(`/api/store/orders/${oE.id}`, GT(tokE))).status === 410, "gone");
    await db.query(`UPDATE guest_order_credentials SET expires_at = now() + interval '10 minutes' WHERE order_id = $1`, [oE.id]);
    t("unexpired-again-200", (await get(`/api/store/orders/${oE.id}`, GT(tokE))).status === 200, "restored");
    const rv = await post(`/api/admin/orders/${oE.id}/credential/revoke`, {}, { cookie: ck });
    t("revoke-200", rv.status === 200 && rv.body?.data?.revoked === true, `${rv.status}`);
    t("no-token-in-revoke", !JSON.stringify(rv.body).includes(tokE), "leak-check");
    t("revoked-401", (await get(`/api/store/orders/${oE.id}`, GT(tokE))).status === 401, "dead");
    const rt = await post(`/api/admin/orders/${oE.id}/credential/rotate`, {}, { cookie: ck });
    const tokE2 = rt.body?.data?.guestOrderToken;
    t("rotate-200-fresh", rt.status === 200 && HEX64.test(tokE2 ?? "") && tokE2 !== tokE, `${rt.status}`);
    t("rotated-works", (await get(`/api/store/orders/${oE.id}`, GT(tokE2))).status === 200, "new lives");
    t("revoke-unknown-404", (await post(`/api/admin/orders/01800000-0000-7000-8000-ffffffffffff/credential/revoke`, {}, { cookie: ck })).status === 404, "no oracle");
    t("rotate-registered-404", (await post(`/api/admin/orders/${roId}/credential/rotate`, {}, { cookie: ck })).status === 404, "customer order");
    t("revoke-bare-403", (await post(`/api/admin/orders/${oE.id}/credential/revoke`, {}, { cookie: ckb })).status === 403, "rbac");
    t("revoke-anon-401", (await post(`/api/admin/orders/${oE.id}/credential/revoke`, {})).status === 401, "auth");

    // ---------- rate buckets (isolated fake-IP scopes) ----------
    const win = (await q(`SELECT (date_trunc('hour', now()) + (floor(date_part('minute', now()) / 15) * interval '15 minutes'))::text w`))[0].w;
    await db.query(`INSERT INTO guest_order_rate_limits (bucket_key, window_start, attempts) VALUES ('guest-order:ip:9.9.9.9', $1::timestamptz, 10)`, [win]);
    const gRl = await mkGuestCart([[P330, "1"]]);
    t("create-over-limit-429", (await post(`/api/store/orders`, guestPayload(PG1, key("rl1")), G(gRl, "9.9.9.9"))).status === 429, "bucket");
    await db.query(`DELETE FROM guest_order_rate_limits WHERE bucket_key = 'guest-order:ip:9.9.9.9'`);
    // NOTE: the key string is captured once — key() consumes a sequence
    // number, so re-calling it for the lookup row would miss (leak).
    const kRl2 = key("rl2");
    const rl2res = await post(`/api/store/orders`, guestPayload(PG1, kRl2), G(gRl, "9.9.9.9"));
    t("create-under-limit-201", rl2res.status === 201, "recovered");
    if (rl2res.body?.data?.order?.id) orderIds.add(rl2res.body.data.order.id);
    await db.query(`INSERT INTO guest_order_rate_limits (bucket_key, window_start, attempts) VALUES ('guest-order:read-ip:9.9.9.8', $1::timestamptz, 60)`, [win]);
    const rlReq = await fetch(`${baseUrl}/api/store/orders/${o1.id}`, { headers: { ...GT(tok1), "x-forwarded-for": "9.9.9.8" } });
    t("read-over-limit-429", rlReq.status === 429, `${rlReq.status}`);
    await db.query(`DELETE FROM guest_order_rate_limits WHERE bucket_key LIKE 'guest-order:%9.9.9.%'`);
    t("read-under-limit-200", (await get(`/api/store/orders/${o1.id}`, GT(tok1))).status === 200, "recovered");

    // ---------- fulfillment smoke on guest order → DELIVERED ----------
    const gF = await mkGuestOrder([[P330, "2"]], PG1, key("ful"));
    const oF = gF.res.body?.data?.order;
    const tokF = gF.res.body?.data?.guestOrderToken;
    const itemsF = (await get(`/api/store/orders/${oF.id}`, GT(tokF))).body?.data?.order?.items ?? [];
    const lineF = itemsF.find((i) => i.productVariantId === P330);
    const qtyBefore = (await q(`SELECT quantity::text qq FROM inventory WHERE product_variant_id = $1`, [P330]))[0].qq;
    t("prep-200", (await post(`/api/admin/orders/${oF.id}/prepare`, {}, { cookie: ck })).status === 200, "admin");
    t("pick-200", (await post(`/api/admin/orders/${oF.id}/items/${lineF.id}/pick`, { actualQuantity: "2" }, { cookie: ck })).status === 200, "actual");
    t("ready-200", (await post(`/api/admin/orders/${oF.id}/ready`, {}, { cookie: ck })).status === 200, "money");
    t("dispatch-200", (await post(`/api/admin/orders/${oF.id}/dispatch`, {}, { cookie: ck })).status === 200, "out");
    t("deliver-200", (await post(`/api/admin/orders/${oF.id}/deliver`, {}, { cookie: ck })).status === 200, "done");
    const oFrow = await orderRowOf(oF.id);
    t("guest-delivered", oFrow.s === "DELIVERED" && oFrow.c === null, JSON.stringify(oFrow));
    t("guest-commit-math", num(qtyBefore) - num((await q(`SELECT quantity::text qq FROM inventory WHERE product_variant_id = $1`, [P330]))[0].qq) === 2, "stock");
    const trackF = await get(`/api/store/orders/${oF.id}`, GT(tokF));
    t("guest-tracking-final", trackF.status === 200 && trackF.body?.data?.order?.status === "DELIVERED" && trackF.body.data.order.totalFinal !== null, "finals");

    // ---------- error-body leakage sweep ----------
    const badTok = "ff".repeat(32);
    const e1 = await get(`/api/store/orders/${o1.id}`, GT(badTok));
    const e2 = await post(`/api/store/orders/${o1.id}/cancel`, {}, GT(badTok));
    const e3 = await get(`/api/store/orders/01800000-0000-7000-8000-ffffffffffff`, GT(tok1));
    t("errors-clean", e1.status === 401 && e2.status === 401 && e3.status === 401
      && ![e1, e2, e3].some((r) => JSON.stringify(r.body).includes(tok1) || JSON.stringify(r.body).includes(badTok)), "no leak");
  } finally {
    // ---------- cleanup (mirrors t-replacements hygiene: holds released
    // per non-REPLACED line, then rows removed FK-safe; REPLACED originals
    // hold nothing — approval already released them).
    try {
      const leftovers = await db.query(
        `SELECT o.id::text id, o.status s FROM orders o WHERE o.id = ANY($1::uuid[]) AND o.status NOT IN ('CANCELLED','DELIVERED')`,
        [[...orderIds]]).catch(() => ({ rows: [] }));
      for (const o of leftovers.rows) {
        const items = await db.query(`SELECT product_variant_id, requested_quantity FROM order_items WHERE order_id = $1 AND item_status <> 'REPLACED'`, [o.id]).catch(() => ({ rows: [] }));
        for (const it of items.rows) {
          await db.query(`UPDATE inventory SET reserved_quantity = reserved_quantity - $2 WHERE product_variant_id = $1`, [it.product_variant_id, it.requested_quantity]).catch(() => {});
        }
      }
      const ids = [...orderIds];
      if (ids.length > 0) {
        await db.query(`DELETE FROM guest_order_credentials WHERE order_id = ANY($1::uuid[])`, [ids]).catch(() => {});
        await db.query(`DELETE FROM order_item_replacements WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id = ANY($1::uuid[]))`, [ids]).catch(() => {});
        await db.query(`DELETE FROM order_discounts WHERE order_id = ANY($1::uuid[])`, [ids]).catch(() => {});
        await db.query(`DELETE FROM coupon_usages WHERE order_id = ANY($1::uuid[])`, [ids]).catch(() => {});
        await db.query(`DELETE FROM order_status_history WHERE order_id = ANY($1::uuid[])`, [ids]).catch(() => {});
        await db.query(`DELETE FROM order_items WHERE order_id = ANY($1::uuid[])`, [ids]).catch(() => {});
        await db.query(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [ids]).catch(() => {});
      }
      for (const id of cartIds) {
        await db.query(`DELETE FROM cart_items WHERE cart_id = $1`, [id]).catch(() => {});
        await db.query(`DELETE FROM carts WHERE id = $1`, [id]).catch(() => {});
      }
      for (const cid of couponIds) {
        await db.query(`DELETE FROM coupon_usages WHERE coupon_id = $1`, [cid]).catch(() => {});
        await db.query(`DELETE FROM coupons WHERE id = $1`, [cid]).catch(() => {});
      }
      for (const pid of promoIds) {
        await db.query(`UPDATE promotions SET status = 'DISABLED' WHERE id = $1`, [pid]).catch(() => {});
        await db.query(`DELETE FROM promotion_targets WHERE promotion_id = $1`, [pid]).catch(() => {});
        await db.query(`DELETE FROM promotions WHERE id = $1`, [pid]).catch(() => {});
      }
      for (const ph of [...phones].map(CANON)) {
        const rows = await db.query(`SELECT id FROM customers WHERE phone = $1`, [ph]).catch(() => ({ rows: [] }));
        for (const r of rows.rows) {
          await db.query(`DELETE FROM customer_sessions WHERE customer_id = $1`, [r.id]).catch(() => {});
          await db.query(`DELETE FROM customer_addresses WHERE customer_id = $1`, [r.id]).catch(() => {});
        }
      }
      for (const ph of [...phones].map(CANON)) {
        await db.query(`DELETE FROM customers WHERE phone = $1`, [ph]).catch(() => {});
      }
      for (const email of [STORE_EMAIL, OWNER_EMAIL, BARE_EMAIL]) {
        await db.query(`DELETE FROM admin_sessions WHERE user_id = (SELECT id FROM users WHERE email = $1)`, [email]).catch(() => {});
      }
    } catch { /* scratch hygiene best-effort */ }
    await db.end().catch(() => {});
  }
  done();
}

main().catch((e) => {
  console.error(`GUEST_SUITE_FAILED: ${e.constructor.name}: ${String(e.message).slice(0, 200)}`);
  process.exit(1);
});
