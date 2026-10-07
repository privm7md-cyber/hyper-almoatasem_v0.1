// PHASE 4 order fulfillment + picking verification (real PostgreSQL, scratch-only).
// Usage: node scripts/api/t-fulfillment.mjs --db <name> --port <port>
// Covers the fulfillment lifecycle end to end through the REAL admin routes
// (no test doubles): CONFIRMED→PREPARING→READY_FOR_DELIVERY→
// OUT_FOR_DELIVERY→DELIVERED, illegal/repeat/backward transitions, piece +
// weighted picking (exact/partial/envelope-breach), out-of-stock marking,
// READY gate (pending lines, open proposals), replacement integration
// (approve/reject), PREPARING cancel widening, inventory commit math +
// SALE movements, money finalization, concurrency (prepare/pick/ready
// races, pick-vs-cancel), audit pairing, RBAC (anon/bare/customer denied),
// and the customer read view of fulfilled data.
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
  console.log(JSON.stringify({ suite: "fulfillment", db: dbName, total: results.length, failures: failures.length, failed: failures.map((f) => f.name), passed: results.filter((r) => r.pass).map((r) => r.name) }, null, 2));
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
const P_F1 = "01098000051";
const P_F2 = "01098000052";
const CANON = (p) => "2010" + p.slice(3);
const CPW = "Cust-Test-Pass-0001!";
const P330 = "01800000-0000-7000-8000-000000000201";
const ROMI_V = "01800000-0000-7000-8000-000000000101";
const H = (tok) => ({ "x-customer-token": tok });
const num = (s) => Number(s);

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

  const hdrs = (cookieOrHeaders) =>
    typeof cookieOrHeaders === "string" ? { cookie: cookieOrHeaders } : (cookieOrHeaders ?? {});
  const jcall = async (method, path, body, cookieOrHeaders = {}) => {
    const r = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "content-type": "application/json", ...hdrs(cookieOrHeaders) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const get = async (path, cookieOrHeaders = {}) => {
    const r = await fetch(`${baseUrl}${path}`, { headers: { ...hdrs(cookieOrHeaders) } });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const post = (path, data, headers = {}) => jcall("POST", path, data, headers);
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
  const key = (p) => `ful-${p}-${stamp}-${keySeq.n++}`;
  const cartIds = new Set();
  const orderIds = new Set();

  const sess = async (phone, firstName) => {
    const reg = await post(`/api/store/customers/register`, { phone, firstName, password: CPW });
    if (reg.status === 201) {
      return { id: reg.body?.data?.customer?.id ?? null, tok: reg.body?.data?.customerToken ?? null };
    }
    const r = await post(`/api/store/customers/session`, { phone, password: CPW });
    return { id: r.body?.data?.customer?.id ?? null, tok: r.body?.data?.customerToken ?? null };
  };
  const mkOrder = async (sessTok, addrId, lines, k) => {
    const g = await post(`/api/store/cart`, {}, H(sessTok));
    cartIds.add(g.body?.data?.cart?.id);
    for (const [vid, qty] of lines) {
      await post(`/api/store/cart/items`, { productVariantId: vid, quantity: qty }, H(sessTok));
    }
    const o = await post(`/api/store/orders`, { addressId: addrId, idempotencyKey: k }, H(sessTok));
    if (o.body?.data?.order?.id) orderIds.add(o.body.data.order.id);
    return o.body?.data?.order ?? null;
  };
  const mkAddr = async (sessTok, phone) => {
    const a = await post(`/api/store/customers/addresses`, { city: "Matai", phone }, H(sessTok));
    return a.body?.data?.id ?? null;
  };
  const reservedOf = async (v) =>
    (await q(`SELECT reserved_quantity::text r, quantity::text q FROM inventory WHERE product_variant_id = $1`, [v]))[0];
  const auditN = async (action, entityId) =>
    Number((await q(`SELECT count(*)::int AS n FROM audit_logs WHERE action = $1 AND entity_id = $2::uuid`, [action, entityId]))[0].n);
  const auditIdsBefore = new Set((await q(`SELECT id::text AS id FROM audit_logs`)).map((r) => r.id));

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

    const s1 = await sess(P_F1, "Ful1");
    const idC1 = s1.id;
    const tC1 = s1.tok;
    const idA1 = await mkAddr(tC1, P_F1);
    t("fixtures-ready", !!idC1 && !!tC1 && !!idA1, `${!!idC1}/${!!tC1}/${!!idA1}`);
    if (!idC1 || !tC1 || !idA1) {
      console.error(`REFUSED_FIXTURES: session/address setup failed (stale scratch state?)`);
      await db.end().catch(() => {});
      process.exit(1);
    }

    // ================= TRANSITIONS =================
    const OJ = await mkOrder(tC1, idA1, [[P330, "2"], [ROMI_V, "0.125"]], key("j"));
    t("order-confirmed", !!OJ && OJ.status === "CONFIRMED", `${OJ?.status}`);
    const oId = OJ.id;
    const lineP = OJ.items.find((i) => i.productVariantId === P330);
    const lineW = OJ.items.find((i) => i.productVariantId === ROMI_V);
    const badSkip = await post(`/api/admin/orders/${oId}/dispatch`, {}, ck);
    t("dispatch-from-confirmed-409", badSkip.status === 409, `${badSkip.status}`);
    const badReady = await post(`/api/admin/orders/${oId}/ready`, {}, ck);
    t("ready-from-confirmed-409", badReady.status === 409, `${badReady.status}`);
    const badDeliver = await post(`/api/admin/orders/${oId}/deliver`, {}, ck);
    t("deliver-from-confirmed-409", badDeliver.status === 409, `${badDeliver.status}`);
    const prep = await post(`/api/admin/orders/${oId}/prepare`, {}, ck);
    t("prepare-200", prep.status === 200 && prep.body?.data?.order?.status === "PREPARING", `${prep.status}`);
    const prepAgain = await post(`/api/admin/orders/${oId}/prepare`, {}, ck);
    t("prepare-repeat-409", prepAgain.status === 409, `${prepAgain.status}`);
    const badUnknown = await post(`/api/admin/orders/04800000-0000-7000-8000-000000009999/prepare`, {}, ck);
    t("prepare-unknown-404", badUnknown.status === 404, `${badUnknown.status}`);
    const badUuid = await post(`/api/admin/orders/not-a-uuid/prepare`, {}, ck);
    t("prepare-malformed-400", badUuid.status === 400, `${badUuid.status}`);

    // ================= PICKING =================
    // Piece exact → FULFILLED; weighted 0.132 on 0.125 (in-envelope) → PARTIALLY_FULFILLED.
    const resBefore = await reservedOf(P330);
    const resBeforeW = await reservedOf(ROMI_V);
    const pkP = await post(`/api/admin/orders/${oId}/items/${lineP.id}/pick`, { actualQuantity: "2" }, ck);
    t("pick-piece-200", pkP.status === 200
      && pkP.body?.data?.order?.items?.find((i) => i.id === lineP.id)?.itemStatus === "FULFILLED"
      && num(pkP.body.data.order.items.find((i) => i.id === lineP.id)?.actualQuantity) === 2
      && num(pkP.body.data.order.items.find((i) => i.id === lineP.id)?.finalTotal) === 30, `${pkP.status}`);
    const pkW = await post(`/api/admin/orders/${oId}/items/${lineW.id}/pick`, { actualQuantity: "0.132" }, ck);
    const wAfter = pkW.body?.data?.order?.items?.find((i) => i.id === lineW.id);
    t("pick-weight-partial-200", pkW.status === 200 && wAfter?.itemStatus === "PARTIALLY_FULFILLED"
      && num(wAfter?.actualQuantity) === 0.132 && num(wAfter?.finalTotal) === 42.24, `${pkW.status}/${wAfter?.finalTotal}`);
    // Inventory commit math: quantity -= actual, reserved -= requested (full hold released).
    const resAfter = await reservedOf(P330);
    const resAfterW = await reservedOf(ROMI_V);
    t("pick-inventory-commit", num(resAfter.q) === num(resBefore.q) - 2 && num(resAfter.r) === num(resBefore.r) - 2
      && num(resAfterW.q) === num(resBeforeW.q) - 0.132 && num(resAfterW.r) === num(resBeforeW.r) - 0.125,
      `${resAfter.q}/${resAfter.r}`);
    const saleMove = await q(`SELECT quantity::text AS qty, previous_quantity::text AS prev, new_quantity::text AS nw
      FROM inventory_movements WHERE product_variant_id = $1 AND movement_type = 'SALE' ORDER BY created_at DESC LIMIT 1`, [P330]);
    t("pick-sale-movement", saleMove.length === 1 && num(saleMove[0].qty) === -2
      && num(saleMove[0].prev) + num(saleMove[0].qty) === num(saleMove[0].nw), JSON.stringify(saleMove[0]));
    // Repeat pick → 409; pick on non-PREPARING tested later via full chain.
    const pkAgain = await post(`/api/admin/orders/${oId}/items/${lineP.id}/pick`, { actualQuantity: "2" }, ck);
    t("pick-repeat-409", pkAgain.status === 409, `${pkAgain.status}`);
    // Envelope breach → 422, nothing written. Use a fresh order for a clean PENDING line.
    const s2 = await sess(P_F2, "Ful2");
    const idA2 = await mkAddr(s2.tok, P_F2);
    const oB = await mkOrder(s2.tok, idA2, [[ROMI_V, "0.125"]], key("breach"));
    await post(`/api/admin/orders/${oB.id}/prepare`, {}, ck);
    const lineB = oB.items.find((i) => i.productVariantId === ROMI_V);
    const resBBefore = await reservedOf(ROMI_V);
    const pkBreach = await post(`/api/admin/orders/${oB.id}/items/${lineB.id}/pick`, { actualQuantity: "0.500" }, ck);
    t("pick-envelope-breach-422", pkBreach.status === 422, `${pkBreach.status}`);
    const lineBAfter = await q(`SELECT item_status s, actual_quantity aq FROM order_items WHERE id = $1`, [lineB.id]);
    t("pick-breach-no-write", lineBAfter[0].s === "PENDING" && lineBAfter[0].aq === null
      && (await reservedOf(ROMI_V)).r === resBBefore.r, JSON.stringify(lineBAfter[0]));
    // Piece over-pick → 422 (PIECE tolerance 0).
    const oP = await mkOrder(s2.tok, idA2, [[P330, "1"]], key("overpiece"));
    await post(`/api/admin/orders/${oP.id}/prepare`, {}, ck);
    const lineP2 = oP.items.find((i) => i.productVariantId === P330);
    const pkPieceOver = await post(`/api/admin/orders/${oP.id}/items/${lineP2.id}/pick`, { actualQuantity: "2" }, ck);
    t("pick-piece-over-422", pkPieceOver.status === 422, `${pkPieceOver.status}`);
    // Malformed actuals → 400.
    for (const [nm, qty, want] of [["zero", "0", 400], ["negative", "-1", 400], ["nan", "abc", 400], ["num", 2, 400]]) {
      const r = await post(`/api/admin/orders/${oP.id}/items/${lineP2.id}/pick`, { actualQuantity: qty }, ck);
      t(`pick-${nm}-400`, r.status === want, `${r.status}`);
    }
    // Stock-short at commit → 409 (deplete below actual, restore hold after).
    // Snapshot the legitimate hold first: the depletion below wipes it.
    const shortHold = await reservedOf(P330);
    await db.query(`UPDATE inventory SET quantity = 0.100, reserved_quantity = 0 WHERE product_variant_id = $1`, [P330]);
    const pkShort = await post(`/api/admin/orders/${oP.id}/items/${lineP2.id}/pick`, { actualQuantity: "1" }, ck);
    t("pick-stock-short-409", pkShort.status === 409, `${pkShort.status}`);
    await db.query(`UPDATE inventory SET quantity = 500.000, reserved_quantity = $2 WHERE product_variant_id = $1`, [P330, shortHold.r]);
    // Unknown line → 404.
    const pkMiss = await post(`/api/admin/orders/${oP.id}/items/04800000-0000-7000-8000-000000009999/pick`, { actualQuantity: "1" }, ck);
    t("pick-unknown-line-404", pkMiss.status === 404, `${pkMiss.status}`);

    // ================= UNAVAILABLE =================
    const resUBefore = await reservedOf(P330);
    const unav = await post(`/api/admin/orders/${oP.id}/items/${lineP2.id}/unavailable`, {}, ck);
    t("unavailable-200", unav.status === 200
      && unav.body?.data?.order?.items?.find((i) => i.id === lineP2.id)?.itemStatus === "UNAVAILABLE", `${unav.status}`);
    const resUAfter = await reservedOf(P330);
    t("unavailable-keeps-hold", num(resUAfter.r) === num(resUBefore.r), `${resUBefore.r}->${resUAfter.r}`);
    const unavAgain = await post(`/api/admin/orders/${oP.id}/items/${lineP2.id}/unavailable`, {}, ck);
    t("unavailable-repeat-409", unavAgain.status === 409, `${unavAgain.status}`);
    const pickAfterUnav = await post(`/api/admin/orders/${oP.id}/items/${lineP2.id}/pick`, { actualQuantity: "1" }, ck);
    t("pick-after-unavailable-409", pickAfterUnav.status === 409, `${pickAfterUnav.status}`);

    // ================= READY GATE =================
    // oB still has a PENDING line (breach rejected) → 409.
    const readyBlocked = await post(`/api/admin/orders/${oB.id}/ready`, {}, ck);
    t("ready-pending-blocked-409", readyBlocked.status === 409, `${readyBlocked.status}`);
    // Resolve oB via unavailable (short-ship path), then READY with finals.
    // The unsubstituted hold releases at READY (nothing is double-released).
    await post(`/api/admin/orders/${oB.id}/items/${lineB.id}/unavailable`, {}, ck);
    const resBHold = await reservedOf(ROMI_V);
    const readyB = await post(`/api/admin/orders/${oB.id}/ready`, {}, ck);
    const oBReady = readyB.body?.data?.order;
    t("ready-short-ship-200", readyB.status === 200 && oBReady?.status === "READY_FOR_DELIVERY"
      && num(oBReady?.subtotalFinal) === 0 && num(oBReady?.totalFinal) === 20, `${readyB.status}/${oBReady?.subtotalFinal}/${oBReady?.totalFinal}`);
    t("ready-releases-short-hold", num((await reservedOf(ROMI_V)).r) === num(resBHold.r) - 0.125, `${resBHold.r}`);
    // Journey order: both lines picked → READY with exact money.
    // sub 30.00 + 42.24 = 72.24, discount 0 (no promos), delivery 20 → 92.24.
    const readyJ = await post(`/api/admin/orders/${oId}/ready`, {}, ck);
    const oJReady = readyJ.body?.data?.order;
    t("ready-200-finals", readyJ.status === 200 && oJReady?.status === "READY_FOR_DELIVERY"
      && num(oJReady?.subtotalFinal) === 72.24 && num(oJReady?.totalFinal) === 92.24, `${readyJ.status}/${oJReady?.subtotalFinal}/${oJReady?.totalFinal}`);
    const readyAgain = await post(`/api/admin/orders/${oId}/ready`, {}, ck);
    t("ready-repeat-409", readyAgain.status === 409, `${readyAgain.status}`);

    // ================= REPLACEMENT INTEGRATION =================
    // oP: UNAVAILABLE P330 line → staff propose P1L substitute → customer approve → substitute PENDING → pick → READY.
    const pR = await post(`/api/admin/orders/${oP.id}/items/${lineP2.id}/replacements`,
      { replacementVariantId: "01800000-0000-7000-8000-000000000202", replacementQuantity: "1" }, ck);
    t("repl-proposed-201", pR.status === 201, `${pR.status}`);
    const readyOpenProp = await post(`/api/admin/orders/${oP.id}/ready`, {}, ck);
    t("ready-open-proposal-blocked-409", readyOpenProp.status === 409, `${readyOpenProp.status}`);
    const dR = await post(`/api/store/orders/${oP.id}/replacements/${pR.body?.data?.id}/decide`, { action: "approve" }, H(s2.tok));
    t("repl-approved-200", dR.status === 200, `${dR.status}`);
    try {
      const fs = await import("node:fs");
      fs.writeFileSync("C:\\Windows\\Temp\\ful-dr.log", `dR=${dR.status} pR=${pR.status} body=${JSON.stringify(dR.body).slice(0, 300)}\n`);
    } catch { /* ignore */ }
    const oPAfter = await get(`/api/admin/orders/${oP.id}`, ck);
    const subItem = (oPAfter.body?.data?.order?.items ?? []).find((i) => i.productVariantId === "01800000-0000-7000-8000-000000000202" && i.itemStatus === "PENDING");
    t("repl-substitute-pending", !!subItem, `${(oPAfter.body?.data?.order?.items ?? []).map((i) => i.itemStatus)}`);
    const pkSub = await post(`/api/admin/orders/${oP.id}/items/${subItem.id}/pick`, { actualQuantity: "1" }, ck);
    t("repl-substitute-picked", pkSub.status === 200, `${pkSub.status}`);
    const readyP = await post(`/api/admin/orders/${oP.id}/ready`, {}, ck);
    const oPReady = readyP.body?.data?.order;
    t("ready-with-substitute-200", readyP.status === 200 && oPReady?.status === "READY_FOR_DELIVERY"
      && num(oPReady?.subtotalFinal) === 30 && num(oPReady?.totalFinal) === 50, `${readyP.status}/${oPReady?.subtotalFinal}/${oPReady?.totalFinal}`);
    // Reject path: fresh order, OOS, propose, reject → UNAVAILABLE stands → READY short.
    const oRj = await mkOrder(s2.tok, idA2, [[P330, "1"]], key("reject"));
    await post(`/api/admin/orders/${oRj.id}/prepare`, {}, ck);
    const lineRj = oRj.items.find((i) => i.productVariantId === P330);
    await post(`/api/admin/orders/${oRj.id}/items/${lineRj.id}/unavailable`, {}, ck);
    const pRj = await post(`/api/admin/orders/${oRj.id}/items/${lineRj.id}/replacements`,
      { replacementVariantId: "01800000-0000-7000-8000-000000000202", replacementQuantity: "1" }, ck);
    const dRj = await post(`/api/store/orders/${oRj.id}/replacements/${pRj.body?.data?.id}/decide`, { action: "reject" }, H(s2.tok));
    t("repl-rejected-200", dRj.status === 200, `${dRj.status}`);
    const readyRj = await post(`/api/admin/orders/${oRj.id}/ready`, {}, ck);
    t("ready-after-reject-200", readyRj.status === 200
      && num(readyRj.body?.data?.order?.subtotalFinal) === 0, `${readyRj.status}`);

    // ================= DELIVERY CHAIN =================
    const disp = await post(`/api/admin/orders/${oId}/dispatch`, {}, ck);
    t("dispatch-200", disp.status === 200 && disp.body?.data?.order?.status === "OUT_FOR_DELIVERY", `${disp.status}`);
    const dispAgain = await post(`/api/admin/orders/${oId}/dispatch`, {}, ck);
    t("dispatch-repeat-409", dispAgain.status === 409, `${dispAgain.status}`);
    const delEarly = await post(`/api/admin/orders/${oB.id}/deliver`, {}, ck);
    t("deliver-skips-dispatch-409", delEarly.status === 409, `${delEarly.status}`);
    const del = await post(`/api/admin/orders/${oId}/deliver`, {}, ck);
    t("deliver-200-terminal", del.status === 200 && del.body?.data?.order?.status === "DELIVERED", `${del.status}`);
    const delAgain = await post(`/api/admin/orders/${oId}/deliver`, {}, ck);
    t("deliver-repeat-409", delAgain.status === 409, `${delAgain.status}`);
    const prepDelivered = await post(`/api/admin/orders/${oId}/prepare`, {}, ck);
    t("prepare-delivered-409", prepDelivered.status === 409, `${prepDelivered.status}`);

    // ================= CANCEL SEMANTICS =================
    // PREPARING-unpicked cancel works (widened); a picked line blocks
    // cancel (409); post-READY/post-DELIVERED cancel 409s.
    const oC = await mkOrder(tC1, idA1, [[P330, "1"]], key("cancelprep"));
    await post(`/api/admin/orders/${oC.id}/prepare`, {}, ck);
    const cxPrep = await post(`/api/store/orders/${oC.id}/cancel`, {}, H(tC1));
    t("cancel-preparing-unpicked-200", cxPrep.status === 200, `${cxPrep.status}`);
    // Isolate: the cancelled order's cart stays ACTIVE with its lines.
    await jcall("DELETE", `/api/store/cart/items`, undefined, H(tC1));
    const oCP = await mkOrder(tC1, idA1, [[P330, "1"]], key("cancelpicked"));
    await post(`/api/admin/orders/${oCP.id}/prepare`, {}, ck);
    const cpItem = oCP.items.find((i) => i.productVariantId === P330);
    await post(`/api/admin/orders/${oCP.id}/items/${cpItem.id}/pick`, { actualQuantity: "1" }, ck);
    const cxPicked = await post(`/api/store/orders/${oCP.id}/cancel`, {}, H(tC1));
    t("cancel-picked-409", cxPicked.status === 409, `${cxPicked.status}`);
    const cxReady = await post(`/api/store/orders/${oId}/cancel`, {}, H(tC1));
    t("cancel-delivered-409", cxReady.status === 409, `${cxReady.status}`);

    // ================= CONCURRENCY =================
    const oCC = await mkOrder(tC1, idA1, [[P330, "1"]], key("concprep"));
    const [cpA, cpB] = await Promise.all([
      post(`/api/admin/orders/${oCC.id}/prepare`, {}, ck),
      post(`/api/admin/orders/${oCC.id}/prepare`, {}, ck),
    ]);
    t("race-prepare-once", [cpA.status, cpB.status].sort().join(",") === "200,409", `${cpA.status}/${cpB.status}`);
    const oCK = await mkOrder(tC1, idA1, [[P330, "1"]], key("concpick"));
    await post(`/api/admin/orders/${oCK.id}/prepare`, {}, ck);
    const cpLine = oCK.items.find((i) => i.productVariantId === P330);
    const [pkA, pkB] = await Promise.all([
      post(`/api/admin/orders/${oCK.id}/items/${cpLine.id}/pick`, { actualQuantity: "1" }, ck),
      post(`/api/admin/orders/${oCK.id}/items/${cpLine.id}/pick`, { actualQuantity: "1" }, ck),
    ]);
    t("race-pick-once", [pkA.status, pkB.status].sort().join(",") === "200,409", `${pkA.status}/${pkB.status}`);
    const [rdA, rdB] = await Promise.all([
      post(`/api/admin/orders/${oCK.id}/ready`, {}, ck),
      post(`/api/admin/orders/${oCK.id}/ready`, {}, ck),
    ]);
    t("race-ready-once", [rdA.status, rdB.status].sort().join(",") === "200,409", `${rdA.status}/${rdB.status}`);
    // Pick vs customer-cancel race: exactly one wins, state stays coherent.
    const oPC = await mkOrder(tC1, idA1, [[P330, "1"]], key("pickcancel"));
    await post(`/api/admin/orders/${oPC.id}/prepare`, {}, ck);
    const pcLine = oPC.items.find((i) => i.productVariantId === P330);
    const [pcPick, pcCx] = await Promise.all([
      post(`/api/admin/orders/${oPC.id}/items/${pcLine.id}/pick`, { actualQuantity: "1" }, ck),
      post(`/api/store/orders/${oPC.id}/cancel`, {}, H(tC1)),
    ]);
    const pcPair = [pcPick.status, pcCx.status].sort().join(",");
    t("race-pick-cancel-settles", pcPair === "200,409" || pcPair === "409,200", `${pcPick.status}/${pcCx.status}`);
    const pcFinal = await get(`/api/admin/orders/${oPC.id}`, ck);
    t("race-pick-cancel-coherent", (pcFinal.body?.data?.order?.status === "CANCELLED"
      && (pcFinal.body?.data?.order?.items ?? []).every((i) => i.actualQuantity === null))
      || (pcFinal.body?.data?.order?.status === "PREPARING"
        && (pcFinal.body?.data?.order?.items ?? []).some((i) => i.actualQuantity === "1")),
      `${pcFinal.body?.data?.order?.status}`);

    // ================= AUDIT =================
    t("audit-prepare", (await auditN("orders.advance", oId)) >= 1, "prepare audited");
    t("audit-pick", (await auditN("orders.pick", cpLine.id)) >= 1, "pick audited");
    t("audit-ready", (await auditN("orders.ready", oId)) >= 1, "ready audited");

    // ================= RBAC =================
    const anonPrep = await post(`/api/admin/orders/${oId}/prepare`, {});
    const barePrep = await post(`/api/admin/orders/${oId}/prepare`, {}, ckb);
    t("rbac-anon-401", anonPrep.status === 401, `${anonPrep.status}`);
    t("rbac-bare-403", barePrep.status === 403, `${barePrep.status}`);
    const custPrep = await post(`/api/admin/orders/${oId}/prepare`, {}, H(tC1));
    t("rbac-customer-401", custPrep.status === 401, `${custPrep.status}`);
    const custPick = await post(`/api/admin/orders/${oId}/items/${lineP.id}/pick`, { actualQuantity: "2" }, H(tC1));
    t("rbac-customer-pick-401", custPick.status === 401, `${custPick.status}`);

    // ================= CUSTOMER VIEW =================
    const custView = await get(`/api/store/orders/${oId}`, H(tC1));
    const cv = custView.body?.data?.order;
    t("customer-view-fulfilled", custView.status === 200 && cv?.status === "DELIVERED"
      && num(cv?.subtotalFinal) === 72.24 && num(cv?.totalFinal) === 92.24
      && cv?.items?.every((i) => i.actualQuantity !== undefined && i.finalTotal !== undefined && i.itemStatus !== undefined),
      `${custView.status}/${cv?.status}`);
  } finally {
    try {
      const auditIdsAfter = (await q(`SELECT id::text AS id FROM audit_logs`)).map((r) => r.id);
      const mine = auditIdsAfter.filter((id) => !auditIdsBefore.has(id));
      if (mine.length > 0) {
        await db.query(`DELETE FROM audit_logs WHERE id = ANY($1::uuid[])`, [mine]).catch(() => {});
      }
      const ordRows = await db.query(
        `SELECT o.id FROM orders o JOIN customers c ON c.id = o.customer_id WHERE c.phone IN ($1,$2)`,
        [CANON(P_F1), CANON(P_F2)],
      ).catch(() => ({ rows: [] }));
      for (const o of ordRows.rows) {
        const items = await db.query(`SELECT product_variant_id, requested_quantity, actual_quantity FROM order_items WHERE order_id = $1`, [o.id]).catch(() => ({ rows: [] }));
        for (const it of items.rows) {
          // Release whatever is still held (requested minus committed actual).
          const held = Number(it.requested_quantity) - Number(it.actual_quantity ?? 0);
          if (held > 0) {
            await db.query(`UPDATE inventory SET reserved_quantity = reserved_quantity - $2, quantity = quantity + $2 WHERE product_variant_id = $1`,
              [it.product_variant_id, held]).catch(() => {});
          }
          // Undo committed actuals (test-only reversal of SALE postings).
          const committed = Number(it.actual_quantity ?? 0);
          if (committed > 0) {
            await db.query(`UPDATE inventory SET reserved_quantity = reserved_quantity + $2, quantity = quantity + $2 WHERE product_variant_id = $1`,
              [it.product_variant_id, committed]).catch(() => {});
          }
        }
        await db.query(`DELETE FROM order_item_replacements WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id = $1)`, [o.id]).catch(() => {});
        await db.query(`DELETE FROM order_discounts WHERE order_id = $1`, [o.id]).catch(() => {});
        await db.query(`DELETE FROM coupon_usages WHERE order_id = $1`, [o.id]).catch(() => {});
        await db.query(`DELETE FROM order_status_history WHERE order_id = $1`, [o.id]).catch(() => {});
        await db.query(`DELETE FROM order_items WHERE order_id = $1`, [o.id]).catch(() => {});
        await db.query(`DELETE FROM orders WHERE id = $1`, [o.id]).catch(() => {});
        await db.query(`DELETE FROM inventory_movements WHERE reference_id = $1`, [o.id]).catch(() => {});
      }
      for (const ph of [P_F1, P_F2].map(CANON)) {
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
      for (const ph of [P_F1, P_F2].map(CANON)) {
        await db.query(`DELETE FROM customers WHERE phone = $1`, [ph]).catch(() => {});
      }
      for (const email of [OWNER_EMAIL, STORE_EMAIL, BARE_EMAIL]) {
        await db.query(`DELETE FROM admin_sessions WHERE user_id = (SELECT id FROM users WHERE email = $1)`, [email]).catch(() => {});
      }
      for (const id of cartIds) {
        await db.query(`DELETE FROM cart_items WHERE cart_id = $1`, [id]).catch(() => {});
        await db.query(`DELETE FROM carts WHERE id = $1`, [id]).catch(() => {});
      }
      await db.query(`UPDATE inventory SET quantity = 500.000, reserved_quantity = 0 WHERE product_variant_id = $1`, [P330]).catch(() => {});
      await db.query(`UPDATE inventory SET quantity = 47.350, reserved_quantity = 0 WHERE product_variant_id = $1`, [ROMI_V]).catch(() => {});
    } catch { /* scratch hygiene best-effort */ }
    await db.end().catch(() => {});
  }
  done();
}

main().catch((e) => {
  console.error(`FULFILLMENT_SUITE_FAILED: ${e.constructor.name}: ${String(e.message).slice(0, 200)}`);
  process.exit(1);
});

