// BA-6 orders API suite (scratch-only, needs built server pointed at DB).
// Usage: node scripts/api/t-orders.mjs --db <name> --port <port>
// Covers: creation (snapshots, reserve, history, CHECKED_OUT), price drift,
// line revalidation (dead/unit/step), stock-failure atomicity, idempotent
// replay + key-conflict, ownership-scoped reads, customer + admin cancel,
// RBAC matrix. Frozen fixtures read-only (prices toggled via API with
// revert); all carts/orders/customers created here are removed in cleanup.
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
  console.log(JSON.stringify({ suite: "orders", db: dbName, total: results.length, failures: failures.length, failed: failures.map((f) => f.name), passed: results.filter((r) => r.pass).map((r) => r.name) }, null, 2));
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

const ROMI_V = "01800000-0000-7000-8000-000000000101";
const P330 = "01800000-0000-7000-8000-000000000201";
const P1L = "01800000-0000-7000-8000-000000000202";
const P25L = "01800000-0000-7000-8000-000000000203";
const UNKNOWN = "04800000-0000-7000-8000-000000009999";
const P_C1 = "01092000011";
const P_C2 = "01092000022";
const CANON = (p) => "2010" + p.slice(3);
const STORE_EMAIL = "store-cat-test@example.com";
const STORE_PW = "Cat-Test-Store-Pass-0002!";
const OWNER_EMAIL = "owner@hyper-al-moatasem.local";
const OWNER_PW = "Cat-Test-Owner-Pass-0001!";
const BARE_EMAIL = "bare-cat-test@example.com";
const BARE_PW = "Cat-Test-Bare-Pass-0003!";

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

  const get = async (path, token = null, extra = {}) => {
    const r = await fetch(`${baseUrl}${path}`, { headers: { ...(token ? { "x-guest-token": token } : {}), ...extra } });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const post = async (path, data, token = null, extra = {}) => {
    const r = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { "x-guest-token": token } : {}), ...extra },
      body: JSON.stringify(data),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
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
  // Isolated customer with a storefront address (PHASE 2: session + address
  // via the store APIs). Each checkout-behavior block gets its own customer
  // so merged carts never accumulate lines across tests.
  const newCust = async (phone, firstName) => {
    const s = await sess(phone, firstName);
    const a = await post(`/api/store/customers/addresses`,
      { city: "Cairo", phone }, null, H(s.tok));
    return { id: s.id, tok: s.tok, addr: a.body?.data?.id ?? null };
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
  const loginGet = async (path, cookie) => {
    const r = await fetch(`${baseUrl}${path}`, { headers: { cookie } });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const loginPost = async (path, data, cookie) => {
    const r = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(data ?? {}),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };

  const cartIds = new Set();
  const orderIds = new Set();
  const trackCart = (body) => {
    const id = body?.data?.cart?.id;
    if (id) cartIds.add(id);
  };
  const trackOrder = (body) => {
    const id = body?.data?.order?.id;
    if (id) orderIds.add(id);
  };
  const num = (s) => Number(s);
  const mkGuestCart = async (lines) => {
    const g = await post(`/api/store/cart`, {});
    trackCart(g.body);
    const tok = g.body.data.guestToken;
    for (const [vid, qty] of lines) await post(`/api/store/cart/items`, { productVariantId: vid, quantity: qty }, tok);
    return { id: g.body.data.cart.id, token: tok };
  };
  const reservedOf = async (v) =>
    (await q(`SELECT reserved_quantity::text r FROM inventory WHERE product_variant_id = $1`, [v]))[0].r;
  const movCount = async (v) =>
    Number((await q(`SELECT count(*)::int AS n FROM inventory_movements WHERE product_variant_id = $1`, [v]))[0].n);

  try {
    // ---------- guards ----------
    const px = await q(`SELECT id, price::text p FROM product_variants WHERE id IN ($1,$2,$3)`, [P330, ROMI_V, P1L]);
    const pmap = Object.fromEntries(px.map((r) => [r.id, r.p]));
    t("fixture-prices", pmap[P330] === "15.00" && pmap[ROMI_V] === "320.00" && pmap[P1L] === "30.00", JSON.stringify(pmap));
    const fee = await q(`SELECT value_text v FROM store_settings WHERE key = 'delivery.default_fee'`);
    t("fee-setting", fee[0]?.v === "20.00", fee[0]?.v);

    // ---------- customers + address (sessions, PHASE 2) ----------
    const ss1 = await sess(P_C1, "Order1");
    const ss2 = await sess(P_C2, "Order2");
    const idC1 = ss1.id;
    const idC2 = ss2.id;
    const tC1 = ss1.tok;
    const tC2 = ss2.tok;
    const store = await loginAs(STORE_EMAIL, STORE_PW);
    const owner = await loginAs(OWNER_EMAIL, OWNER_PW);
    const bare = await loginAs(BARE_EMAIL, BARE_PW);
    const a1 = await loginPost(`/api/admin/customers/${idC1}/addresses`,
      { label: "home", city: "Cairo", area: "Nasr", street: "Abbas", buildingNumber: "12", phone: P_C1, isDefault: true }, store.cookie);
    const a2 = await loginPost(`/api/admin/customers/${idC2}/addresses`, { city: "Giza", phone: P_C2 }, store.cookie);
    const idA1 = a1.body.data.id;
    const idA2 = a2.body.data.id;
    t("customers-addresses-ready", !!idC1 && !!idC2 && !!idA1 && !!idA2);

    // ---------- successful creation ----------
    const mvP330 = await movCount(P330);
    const mvRomi = await movCount(ROMI_V);
    const g1 = await mkGuestCart([[P330, "2"], [ROMI_V, "0.500"]]);
    await mergeTo(g1.token, tC1);
    const o1 = await post(`/api/store/orders`, { addressId: idA1, idempotencyKey: "ba6-k-0001" }, null, H(tC1));
    trackOrder(o1.body);
    const O1 = o1.body?.data?.order;
    t("create-201", o1.status === 201 && O1 && O1.status === "CONFIRMED" && /^HM-[0-9]{8}-[0-9]{6}$/.test(O1.orderNumber));
    // Decimals normalize trailing zeros ("190.00" -> "190") — numerically
    // exact; clients parse as decimal (BA-2 precedent). Compare via num().
    t("create-totals", O1 && num(O1.subtotalEstimated) === 190 && num(O1.discountTotal) === 0 && num(O1.deliveryFee) === 20 && num(O1.totalEstimated) === 210);
    t("create-snapshots", O1 && O1.items.length === 2
      && O1.items.some((i) => i.productVariantId === P330 && num(i.unitPrice) === 15 && num(i.requestedQuantity) === 2
        && num(i.estimatedTotal) === 30 && i.unit === "PIECE" && i.itemStatus === "PENDING"
        && i.productCode === "6221001000331" && i.codeType === "BARCODE")
      && O1.items.some((i) => i.productVariantId === ROMI_V && num(i.unitPrice) === 320 && num(i.requestedQuantity) === 0.5
        && num(i.estimatedTotal) === 160 && i.unit === "KG" && i.productCode === "2010106" && i.codeType === "INTERNAL_CODE"));
    t("create-customer-snapshot", O1 && O1.customerName === "Order1" && O1.customerPhone === CANON(P_C1)
      && O1.delivery.city === "Cairo" && O1.delivery.phone === CANON(P_C1));
    t("create-history", O1 && O1.history.length === 2 && O1.history[0].oldStatus === null && O1.history[0].newStatus === "NEW"
      && O1.history[1].oldStatus === "NEW" && O1.history[1].newStatus === "CONFIRMED"
      && O1.history.every((h) => h.actorType === "CUSTOMER"));
    t("create-reserved", (await reservedOf(P330)) === "2.000" && (await reservedOf(ROMI_V)) === "0.500");
    t("create-no-movements", (await movCount(P330)) === mvP330 && (await movCount(ROMI_V)) === mvRomi);
    const cartGone = await get(`/api/store/cart`, g1.token);
    t("cart-checked-out", cartGone.status === 404);

    // ---------- snapshot immunity (live price moves, order frozen) ----------
    const { status: pstat } = await (async () => {
      const r = await fetch(`${baseUrl}/api/admin/catalog/variants/${P330}/price`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: store.cookie },
        body: JSON.stringify({ price: "17.00", reason: "ba6 drift test" }),
      });
      return { status: r.status };
    })();
    t("price-bump-ok", pstat === 200);
    const o1again = await get(`/api/store/orders/${O1.id}`, null, H(tC1));
    const kept = o1again.body?.data?.order;
    t("snapshot-immune", o1again.status === 200 && num(kept.subtotalEstimated) === 190
      && num(kept.items.find((i) => i.productVariantId === P330).unitPrice) === 15
      && num(kept.items.find((i) => i.productVariantId === P330).estimatedTotal) === 30);
    const pback = await (async () => {
      const r = await fetch(`${baseUrl}/api/admin/catalog/variants/${P330}/price`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: store.cookie },
        body: JSON.stringify({ price: "15.00", reason: "ba6 revert" }),
      });
      return r.status;
    })();
    t("price-reverted", pback === 200);

    // ---------- price drift rejects (409, cart ACTIVE, nothing reserved) ----------
    const gD = await mkGuestCart([[P330, "1"]]);
    await fetch(`${baseUrl}/api/admin/catalog/variants/${P330}/price`, {
      method: "PATCH", headers: { "content-type": "application/json", cookie: store.cookie },
      body: JSON.stringify({ price: "17.00", reason: "ba6 drift" }),
    });
    const beforeDrift = await reservedOf(P330);
    await mergeTo(gD.token, tC1);
    const drift = await post(`/api/store/orders`, { addressId: idA1, idempotencyKey: "ba6-k-drift" }, null, H(tC1));
    t("drift-409", drift.status === 409 && drift.body.error.code === "CONFLICT");
    t("drift-no-side-effects", (await reservedOf(P330)) === beforeDrift
      && (await get(`/api/store/cart`, null, H(tC1))).status === 200);
    await fetch(`${baseUrl}/api/admin/catalog/variants/${P330}/price`, {
      method: "PATCH", headers: { "content-type": "application/json", cookie: store.cookie },
      body: JSON.stringify({ price: "15.00", reason: "ba6 revert" }),
    });

    // ---------- line revalidation (isolated customers) ----------
    const ncDead = await newCust("01092000031", "OrderDead");
    const gDead = await mkGuestCart([[P1L, "1"]]);
    await db.query(`UPDATE product_variants SET is_active = FALSE WHERE id = $1`, [P1L]);
    await mergeTo(gDead.token, ncDead.tok);
    const dead = await post(`/api/store/orders`, { addressId: ncDead.addr, idempotencyKey: "ba6-k-dead" }, null, H(ncDead.tok));
    t("dead-variant-422", dead.status === 422);
    await db.query(`UPDATE product_variants SET is_active = TRUE WHERE id = $1`, [P1L]);
    const ncStep = await newCust("01092000032", "OrderStep");
    const gStep = await mkGuestCart([[P330, "1"]]);
    await db.query(`INSERT INTO cart_items (id, cart_id, product_variant_id, quantity, unit_snapshot, unit_price_snapshot, price_checked_at)
      VALUES (gen_random_uuid(), $1, $2, 0.100, 'KG', 320.00, now())`, [gStep.id, ROMI_V]);
    await mergeTo(gStep.token, ncStep.tok);
    const step = await post(`/api/store/orders`, { addressId: ncStep.addr, idempotencyKey: "ba6-k-step" }, null, H(ncStep.tok));
    t("step-violation-422", step.status === 422);
    const ncUnit = await newCust("01092000033", "OrderUnit");
    const gUnit = await mkGuestCart([[P330, "1"]]);
    await db.query(`UPDATE cart_items SET unit_snapshot = 'GRAM' WHERE cart_id = $1 AND product_variant_id = $2`, [gUnit.id, P330]);
    await mergeTo(gUnit.token, ncUnit.tok);
    const unit = await post(`/api/store/orders`, { addressId: ncUnit.addr, idempotencyKey: "ba6-k-unit" }, null, H(ncUnit.tok));
    t("unit-mismatch-422", unit.status === 422);
    const ncEmpty = await newCust("01092000034", "OrderEmpty");
    const gEmpty = await post(`/api/store/cart`, {});
    trackCart(gEmpty.body);
    await mergeTo(gEmpty.body.data.guestToken, ncEmpty.tok);
    const empty = await post(`/api/store/orders`, { addressId: ncEmpty.addr, idempotencyKey: "ba6-k-empty" }, null, H(ncEmpty.tok));
    t("empty-cart-422", empty.status === 422);
    const ncNoCart = await newCust("01092000035", "OrderNoCart");
    const noCart = await post(`/api/store/orders`, { addressId: ncNoCart.addr, idempotencyKey: "ba6-k-nocart" }, null, H(ncNoCart.tok));
    t("missing-cart-404", noCart.status === 404);
    const gBadCust = await mkGuestCart([[P330, "1"]]);
    await mergeTo(gBadCust.token, tC1);
    const badSess = await post(`/api/store/orders`, { addressId: idA1, idempotencyKey: "ba6-k-badsess" }, null,
      H("v1.04800000-0000-7000-8000-000000009999.1790000000." + "ab".repeat(32)));
    t("forged-session-401", badSess.status === 401);
    const badAddr = await post(`/api/store/orders`, { addressId: UNKNOWN, idempotencyKey: "ba6-k-badaddr" }, null, H(tC1));
    t("unknown-address-404", badAddr.status === 404);
    const crossAddr = await post(`/api/store/orders`, { addressId: idA2, idempotencyKey: "ba6-k-xaddr" }, null, H(tC1));
    t("cross-address-404", crossAddr.status === 404);
    const badKey = await post(`/api/store/orders`, { addressId: idA1, idempotencyKey: "has space" }, null, H(tC1));
    t("bad-key-400", badKey.status === 400);
    const noKey = await post(`/api/store/orders`, { addressId: idA1 }, null, H(tC1));
    t("missing-key-400", noKey.status === 400);

    // ---------- stock-failure atomicity (multi-line, second line short) ----------
    await db.query(`UPDATE inventory SET quantity = 5.000, reserved_quantity = 0 WHERE product_variant_id = $1`, [P25L]);
    const ncShort = await newCust("01092000036", "OrderShort");
    const gShort = await mkGuestCart([[P330, "1"], [P25L, "150"]]);
    await mergeTo(gShort.token, ncShort.tok);
    const resBefore = await reservedOf(P330);
    const short = await post(`/api/store/orders`, { addressId: ncShort.addr, idempotencyKey: "ba6-k-short" }, null, H(ncShort.tok));
    t("short-409", short.status === 409);
    const noOrder = await q(`SELECT count(*)::int AS n FROM orders WHERE idempotency_key = 'ba6-k-short'`);
    t("short-no-partial", noOrder[0].n === 0 && (await reservedOf(P330)) === resBefore
      && (await reservedOf(P25L)) === "0.000" && (await get(`/api/store/cart`, null, H(ncShort.tok))).status === 200);
    await db.query(`UPDATE inventory SET quantity = 150.000, reserved_quantity = 0 WHERE product_variant_id = $1`, [P25L]);

    // ---------- idempotency replay + conflict (isolated customer) ----------
    const ncRp = await newCust("01092000037", "OrderReplay");
    const gRp = await mkGuestCart([[P330, "1"]]);
    await mergeTo(gRp.token, ncRp.tok);
    const rp1 = await post(`/api/store/orders`, { addressId: ncRp.addr, idempotencyKey: "ba6-k-replay" }, null, H(ncRp.tok));
    trackOrder(rp1.body);
    const resAfterFirst = await reservedOf(P330);
    const rp2 = await post(`/api/store/orders`, { addressId: ncRp.addr, idempotencyKey: "ba6-k-replay" }, null, H(ncRp.tok));
    t("replay-200", rp2.status === 200 && rp2.body.meta?.replay === true && rp2.body.data.order.id === rp1.body.data.order.id);
    t("replay-no-dup-reserve", (await reservedOf(P330)) === resAfterFirst);
    const keyRows = await q(`SELECT count(*)::int AS n FROM orders WHERE idempotency_key = 'ba6-k-replay'`);
    t("replay-single-row", keyRows[0].n === 1);
    const gCf = await mkGuestCart([[P330, "1"]]);
    await mergeTo(gCf.token, ncRp.tok);
    const cf = await post(`/api/store/orders`, { addressId: ncRp.addr, idempotencyKey: "ba6-k-replay" }, null, H(ncRp.tok));
    t("key-conflict-409", cf.status === 409);

    // ---------- reads ----------
    const got = await get(`/api/store/orders/${O1.id}`, null, H(tC1));
    t("get-own-200", got.status === 200 && got.body.data.order.id === O1.id && got.body.data.order.items.length === 2);
    const foreign = await get(`/api/store/orders/${O1.id}`, null, H(tC2));
    t("get-foreign-404", foreign.status === 404);
    const noSess = await get(`/api/store/orders/${O1.id}`);
    t("get-no-session-401", noSess.status === 401);
    const listed = await get(`/api/store/orders?limit=20`, null, H(tC1));
    t("list-own-200", listed.status === 200 && listed.body.data.every((o) => o.id !== undefined)
      && listed.body.data.some((o) => o.id === O1.id) && !listed.body.data.some((o) => o.customerPhone === CANON(P_C2)));
    const listed2 = await get(`/api/store/orders?limit=20`, null, H(tC2));
    t("list-isolation", listed2.status === 200 && !listed2.body.data.some((o) => o.id === O1.id));

    // ---------- customer cancel ----------
    const mvBeforeCancel = await movCount(P330);
    const resBeforeCancel = await reservedOf(P330);
    const cx = await post(`/api/store/orders/${O1.id}/cancel`, {}, null, H(tC1));
    const CX = cx.body?.data?.order;
    t("cancel-200", cx.status === 200 && CX.status === "CANCELLED"
      && CX.history.some((h) => h.newStatus === "CANCELLED" && h.actorType === "CUSTOMER"));
    // O1 held P330x2 of the outstanding reservations (the replay order holds
    // its own x1) — cancel must release exactly O1's share; Romi returns to 0.
    t("cancel-released", num(resBeforeCancel) - num(await reservedOf(P330)) === 2 && (await reservedOf(ROMI_V)) === "0.000");
    t("cancel-no-movements", (await movCount(P330)) === mvBeforeCancel);
    const cx2 = await post(`/api/store/orders/${O1.id}/cancel`, {}, null, H(tC1));
    t("cancel-twice-409", cx2.status === 409);
    const cxForeign = await post(`/api/store/orders/${O1.id}/cancel`, {}, null, H(tC2));
    t("cancel-foreign-404", cxForeign.status === 404);

    // ---------- admin cancel + reads + RBAC (isolated customer) ----------
    const ncAd = await newCust("01092000038", "OrderAdmin");
    const gAd = await mkGuestCart([[P330, "1"]]);
    await mergeTo(gAd.token, ncAd.tok);
    const oAd = await post(`/api/store/orders`, { addressId: ncAd.addr, idempotencyKey: "ba6-k-admin" }, null, H(ncAd.tok));
    trackOrder(oAd.body);
    const idAd = oAd.body.data.order.id;
    const anonAdmin = await get(`/api/admin/orders?limit=5`);
    t("admin-anon-401", anonAdmin.status === 401);
    const bareAdmin = await loginGet(`/api/admin/orders?limit=5`, bare.cookie);
    t("admin-bare-403", bareAdmin.status === 403);
    const admList = await loginGet(`/api/admin/orders?limit=20`, store.cookie);
    t("admin-list-200", admList.status === 200 && admList.body.data.some((o) => o.id === idAd));
    const admStatus = await loginGet(`/api/admin/orders?status=CONFIRMED&limit=20`, store.cookie);
    t("admin-filter-status", admStatus.status === 200 && admStatus.body.data.every((o) => o.status === "CONFIRMED"));
    const admBadStatus = await loginGet(`/api/admin/orders?status=PENDING&limit=5`, store.cookie);
    t("admin-bad-status-400", admBadStatus.status === 400);
    const admDetail = await loginGet(`/api/admin/orders/${idAd}`, owner.cookie);
    t("admin-detail-200", admDetail.status === 200 && admDetail.body.data.order.items.length === 1);
    const admMiss = await loginGet(`/api/admin/orders/${UNKNOWN}`, store.cookie);
    t("admin-detail-404", admMiss.status === 404);
    const admCancel = await loginPost(`/api/admin/orders/${idAd}/cancel`, null, store.cookie);
    t("admin-cancel-200", admCancel.status === 200 && admCancel.body.data.order.status === "CANCELLED");
    const admCancelAgain = await loginPost(`/api/admin/orders/${idAd}/cancel`, null, store.cookie);
    t("admin-cancel-again-409", admCancelAgain.status === 409);
    const admCancelMiss = await loginPost(`/api/admin/orders/${UNKNOWN}/cancel`, null, store.cookie);
    t("admin-cancel-404", admCancelMiss.status === 404);
    const bareCancel = await loginPost(`/api/admin/orders/${idAd}/cancel`, null, bare.cookie);
    t("admin-cancel-bare-403", bareCancel.status === 403);
    // PREPARING-unpicked cancel is fulfillment scope (Phase 4 widened cancel
    // to the frozen machine: NEW|CONFIRMED|PREPARING when nothing is picked).
    // Real PREPARING order via API (no SQL-forged states): checkout → prepare.
    // Dedicated customer: the shared carts above carry leftover lines.
    const ncPrep = await newCust("01092000039", "OrderPrepCancel");
    const gPrep = await mkGuestCart([[P330, "1"]]);
    await mergeTo(gPrep.token, ncPrep.tok);
    const oPrep = await post(`/api/store/orders`, { addressId: ncPrep.addr, idempotencyKey: "ba6-k-prepcancel" }, null, H(ncPrep.tok));
    const idPrep = oPrep.body?.data?.order?.id;
    await post(`/api/admin/orders/${idPrep}/prepare`, {}, store.cookie);
    const resBeforePrepCx = await reservedOf(P330);
    const admPrep = await loginPost(`/api/admin/orders/${idPrep}/cancel`, null, store.cookie);
    t("admin-preparing-unpicked-200", admPrep.status === 200
      && num(await reservedOf(P330)) === num(resBeforePrepCx) - 1, `${admPrep.status}`);
  } finally {
    // Hygiene: release + remove BA-6 rows (history → items → orders → carts → customers).
    try {
      const ordRows = await db.query(
        `SELECT o.id FROM orders o JOIN customers c ON c.id = o.customer_id WHERE c.phone IN ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [CANON(P_C1), CANON(P_C2), CANON("01092000031"), CANON("01092000032"), CANON("01092000033"), CANON("01092000034"), CANON("01092000035"), CANON("01092000036"), CANON("01092000037"), CANON("01092000038"), CANON("01092000039")],
      ).catch(() => ({ rows: [] }));
      for (const o of ordRows.rows) {
        // No test order ever picks lines (BA-6 has no picking), so every
        // leftover reservation is exactly its requested quantities.
        const items = await db.query(`SELECT product_variant_id, requested_quantity FROM order_items WHERE order_id = $1`, [o.id]).catch(() => ({ rows: [] }));
        for (const it of items.rows) {
          await db.query(`UPDATE inventory SET reserved_quantity = reserved_quantity - $2 WHERE product_variant_id = $1`,
            [it.product_variant_id, it.requested_quantity]).catch(() => {});
        }
        await db.query(`DELETE FROM order_status_history WHERE order_id = $1`, [o.id]).catch(() => {});
        await db.query(`DELETE FROM order_items WHERE order_id = $1`, [o.id]).catch(() => {});
        await db.query(`DELETE FROM orders WHERE id = $1`, [o.id]).catch(() => {});
      }
      for (const id of cartIds) {
        await db.query(`DELETE FROM cart_items WHERE cart_id = $1`, [id]).catch(() => {});
        await db.query(`DELETE FROM carts WHERE id = $1`, [id]).catch(() => {});
      }
      for (const ph of [P_C1, P_C2, "01092000031", "01092000032", "01092000033", "01092000034", "01092000035", "01092000036", "01092000037", "01092000038", "01092000039"].map(CANON)) {
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
      for (const ph of [P_C1, P_C2, "01092000031", "01092000032", "01092000033", "01092000034", "01092000035", "01092000036", "01092000037", "01092000038", "01092000039"].map(CANON)) {
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
  console.error(`ORDERS_SUITE_FAILED: ${e.constructor.name}: ${String(e.message).slice(0, 200)}`);
  process.exit(1);
});

