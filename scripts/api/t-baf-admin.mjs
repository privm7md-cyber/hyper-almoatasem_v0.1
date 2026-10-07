// BA-F admin application verification (real PostgreSQL, scratch-only).
// Usage: node scripts/api/t-baf-admin.mjs --db <name> --port <port>
// Covers the admin application end to end through the REAL routes (no test
// doubles on the admin path): role members listing, coupon usage reporting,
// order date-range filter, coupon disable-vs-checkout race, cross-module
// permission isolation, SUPER_ADMIN guards, and audit pairing for new flows.
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
  console.log(JSON.stringify({ suite: "baf-admin", db: dbName, total: results.length, failures: failures.length, failed: failures, passed: results.filter((r) => r.pass).map((r) => r.name) }, null, 2));
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
const P330 = "01800000-0000-7000-8000-000000000201";
const SEED_PRODUCT = "01800000-0000-7000-8000-000000000200";
const UNKNOWN = "04800000-0000-7000-8000-000000009999";
const P_F1 = "01095000011";
const P_F2 = "01095000022";
const CANON = (p) => "2010" + p.slice(3);
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

  const jcall = async (method, path, body, headers = {}) => {
    const r = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const get = (path, cookie = null, headers = {}) =>
    fetch(`${baseUrl}${path}`, { headers: { ...(cookie ? { cookie } : {}), ...headers } })
      .then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
  const post = (path, data, cookie = null, headers = {}) => jcall("POST", path, data,
    { ...(cookie ? { cookie } : {}), ...headers });
  const patch = (path, data, cookie = null, headers = {}) => jcall("PATCH", path, data,
    { ...(cookie ? { cookie } : {}), ...headers });
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
  const key = (p) => `baf-${p}-${stamp}-${keySeq.n++}`;
  const cartIds = new Set();
  const promoIds = new Set();
  const couponIds = new Set();
  const roleIds = new Set();
  const noSecrets = (o) => !JSON.stringify(o).includes("passwordHash") && !JSON.stringify(o).includes("password_hash")
    && !JSON.stringify(o).includes("argon2") && !JSON.stringify(o).includes("token_hash")
    && !JSON.stringify(o).includes("__Host-admin-session");
  const auditIdsBefore = new Set((await q(`SELECT id::text AS id FROM audit_logs`)).map((r) => r.id));

  const mkGuest = async (lines = []) => {
    const g = await post(`/api/store/cart`, {});
    cartIds.add(g.body.data.cart.id);
    const tok = g.body.data.guestToken;
    for (const [vid, qty] of lines) {
      await fetch(`${baseUrl}/api/store/cart/items`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-guest-token": tok },
        body: JSON.stringify({ productVariantId: vid, quantity: qty }),
      });
    }
    return { id: g.body.data.cart.id, tok };
  };
  const checkout = async (guestTok, sessTok, addrId, k, extra = {}) => {
    if (guestTok && sessTok) {
      await post(`/api/store/cart/merge`, {}, null, { "x-guest-token": guestTok, ...H(sessTok) });
    }
    const r = await fetch(`${baseUrl}/api/store/orders`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(sessTok ? H(sessTok) : {}) },
      body: JSON.stringify({ addressId: addrId, idempotencyKey: k, ...extra }),
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
  const mkPromo = async (promo, target, ck) => {
    const p = await post(`/api/admin/promotions`, promo, ck);
    const id = p.body.data.id;
    promoIds.add(id);
    if (target) await post(`/api/admin/promotions/${id}/targets`, target, ck);
    return id;
  };
  const activate = async (id, ck) => patch(`/api/admin/promotions/${id}`, { status: "ACTIVE" }, ck);
  const reservedOf = async (v) =>
    (await q(`SELECT reserved_quantity::text r FROM inventory WHERE product_variant_id = $1`, [v]))[0].r;

  try {
    // Fail-closed server identity guard (same rationale as t-bac-shopping).
    const srvIdent = await get(`/api/store/catalog/products?limit=100`);
    const srvHasFixture = srvIdent.status === 200 && JSON.stringify(srvIdent.body).includes(SEED_PRODUCT);
    console.error(`[env] server-identity probe: catalog=${srvIdent.status} scratchFixture=${srvHasFixture}`);
    if (!srvHasFixture) {
      console.error(`REFUSED_WRONG_SERVER_DB`);
      await db.end().catch(() => {});
      process.exit(1);
    }
    const owner = await loginAs(OWNER_EMAIL, OWNER_PW);
    const store = await loginAs(STORE_EMAIL, STORE_PW);
    const bare = await loginAs(BARE_EMAIL, BARE_PW);
    t("logins-ok", owner.status === 201 && store.status === 201 && bare.status === 201,
      `${owner.status}/${store.status}/${bare.status}`);
    if (owner.status !== 201 || store.status !== 201 || bare.status !== 201
      || !owner.cookie || !store.cookie || !bare.cookie) {
      console.error(`REFUSED_LOGIN (retry after rollover)`);
      await db.end().catch(() => {});
      process.exit(1);
    }
    const cko = owner.cookie;
    const ck = store.cookie;
    const ckb = bare.cookie;
    // Post-login round-trip: server writes must be visible to this connection.
    const envProbeName = `BAF envprobe ${stamp}`;
    const envProbe = await post(`/api/admin/promotions`, { name: envProbeName, type: "PERCENTAGE", scope: "LINE", discountPercent: "10.00" }, ck);
    const envProbeId = envProbe.body.data?.id ?? null;
    const envSeen = Number((await q(`SELECT count(*)::int AS n FROM promotions WHERE id = $1::uuid`, [envProbeId]))[0].n);
    if (envProbeId) {
      await db.query(`DELETE FROM promotion_targets WHERE promotion_id = $1::uuid`, [envProbeId]).catch(() => {});
      await db.query(`DELETE FROM promotion_rules WHERE promotion_id = $1::uuid`, [envProbeId]).catch(() => {});
      await db.query(`DELETE FROM promotions WHERE id = $1::uuid`, [envProbeId]).catch(() => {});
    }
    t("env-server-db-matches-suite-db", envProbe.status === 201 && envSeen === 1,
      `create=${envProbe.status} seen=${envSeen}`);
    if (envProbe.status !== 201 || envSeen !== 1) {
      console.error(`REFUSED_WRONG_SERVER_DB`);
      await db.end().catch(() => {});
      process.exit(1);
    }
    // Stray-state guard.
    const strayPromos = Number((await q(`SELECT count(*)::int AS n FROM promotions WHERE status = 'ACTIVE'`))[0].n);
    const strayCust = Number((await q(`SELECT count(*)::int AS n FROM customers WHERE phone IN ($1,$2)`,
      [CANON(P_F1), CANON(P_F2)]))[0].n);
    const strayRoles = Number((await q(`SELECT count(*)::int AS n FROM roles WHERE name LIKE 'BAF%'`))[0].n);
    t("env-clean", strayPromos === 0 && strayCust === 0 && strayRoles === 0,
      `activePromos=${strayPromos} leftoverCust=${strayCust} leftoverRoles=${strayRoles}`);
    if (strayPromos !== 0 || strayCust !== 0 || strayRoles !== 0) {
      console.error(`REFUSED_DIRTY_ENV`);
      await db.end().catch(() => {});
      process.exit(1);
    }

    // Fixture user ids (read-only lookup, no mutation).
    const usersRows = await q(`SELECT id::text AS id, email FROM users WHERE email IN ($1,$2,$3)`,
      [STORE_EMAIL, BARE_EMAIL, OWNER_EMAIL]);
    const userIdOf = (email) => usersRows.find((r) => r.email === email)?.id;
    t("fixture-users-present", !!userIdOf(STORE_EMAIL) && !!userIdOf(BARE_EMAIL) && !!userIdOf(OWNER_EMAIL));

    // ================= ROLE MEMBERS =================
    const rNew = await post(`/api/admin/roles`, { name: `BAFROLE${stamp}`.toUpperCase().slice(0, 20), description: "BA-F members probe" }, cko);
    const idRole = rNew.body?.data?.id;
    if (idRole) roleIds.add(idRole);
    t("role-create-201", rNew.status === 201 && !!idRole && noSecrets(rNew.body), `${rNew.status}`);
    const as1 = await post(`/api/admin/users/${userIdOf(STORE_EMAIL)}/roles`, { roleId: idRole }, cko);
    const as2 = await post(`/api/admin/users/${userIdOf(BARE_EMAIL)}/roles`, { roleId: idRole }, cko);
    t("role-assign-2", as1.status === 201 && as2.status === 201, `${as1.status}/${as2.status}`);
    const mem = await get(`/api/admin/roles/${idRole}/members?limit=10`, cko);
    const memArr = mem.body?.data ?? [];
    t("members-list-2", mem.status === 200 && memArr.length === 2
      && memArr.some((u) => u.id === userIdOf(STORE_EMAIL)) && memArr.some((u) => u.id === userIdOf(BARE_EMAIL))
      && memArr.every((u) => noSecrets(u)), `${mem.status}/${memArr.length}`);
    const memPage = await get(`/api/admin/roles/${idRole}/members?limit=1`, cko);
    t("members-pagination", memPage.status === 200 && memPage.body?.data?.length === 1
      && typeof memPage.body?.meta?.nextCursor === "string", `${memPage.status}`);
    const memMiss = await get(`/api/admin/roles/${UNKNOWN}/members?limit=10`, cko);
    t("members-unknown-404", memMiss.status === 404, String(memMiss.status));
    const memBad = await get(`/api/admin/roles/not-a-uuid/members?limit=10`, cko);
    t("members-malformed-400", memBad.status === 400, String(memBad.status));
    t("members-anon-401", (await get(`/api/admin/roles/${idRole}/members?limit=10`)).status === 401);
    t("members-bare-403", (await get(`/api/admin/roles/${idRole}/members?limit=10`, ckb)).status === 403);

    // ================= COUPON USAGE REPORTING =================
    const ssF1 = await sess(P_F1, "Baf1");
    const idCF1 = ssF1.id;
    const tCF1 = ssF1.tok;
    const aF1 = await post(`/api/admin/customers/${idCF1}/addresses`, { city: "Matai", phone: P_F1, isDefault: true }, ck);
    const idAF1 = aF1.body?.data?.id;
    const idPar = await mkPromo(
      { name: `BAF par ${stamp}`, type: "FIXED_AMOUNT", scope: "ORDER", discountAmount: "5.00", priority: 100 },
      null, ck);
    await activate(idPar, ck);
    const cpU = await post(`/api/admin/coupons`, { promotionId: idPar, code: `BAFU${stamp}`.toUpperCase().slice(0, 10) }, ck);
    const idCpU = cpU.body?.data?.id;
    const codeU = cpU.body?.data?.code;
    couponIds.add(idCpU);
    t("coupon-ready", !!idCpU && !!codeU, `${codeU}`);
    const gU = await mkGuest([[P330, "1"]]);
    const oU = await checkout(gU.tok, tCF1, idAF1, key("use"), { couponCode: codeU });
    t("coupon-checkout-201", oU.status === 201, `${oU.status}`);
    const usedAfter = Number((await q(`SELECT used_count FROM coupons WHERE id = $1::uuid`, [idCpU]))[0].used_count);
    t("coupon-used-once", usedAfter === 1, String(usedAfter));
    const rep = await get(`/api/admin/coupons/${idCpU}/usages?limit=10`, ck);
    const repArr = rep.body?.data ?? [];
    t("usages-list-1", rep.status === 200 && repArr.length === 1
      && repArr[0].couponId === idCpU && repArr[0].customerId === idCF1
      && repArr[0].orderId === oU.body?.data?.order?.id
      && num(repArr[0].estimatedDiscount) === 5 && noSecrets(rep.body),
      `${rep.status}/${repArr.length}`);
    // Reads must not mutate counters: re-read, counters identical.
    const rep2 = await get(`/api/admin/coupons/${idCpU}/usages?limit=10`, ck);
    const usedAgain = Number((await q(`SELECT used_count FROM coupons WHERE id = $1::uuid`, [idCpU]))[0].used_count);
    t("usages-read-no-bump", rep2.status === 200 && usedAgain === 1 && rep2.body?.data?.length === 1);
    const repPage = await get(`/api/admin/coupons/${idCpU}/usages?limit=1`, ck);
    t("usages-pagination", repPage.status === 200 && repPage.body?.meta?.nextCursor === null,
      `${repPage.status}`);
    t("usages-unknown-404", (await get(`/api/admin/coupons/${UNKNOWN}/usages?limit=10`, ck)).status === 404);
    t("usages-anon-401", (await get(`/api/admin/coupons/${idCpU}/usages?limit=10`)).status === 401);
    t("usages-bare-403", (await get(`/api/admin/coupons/${idCpU}/usages?limit=10`, ckb)).status === 403);

    // ================= ORDER DATE FILTER =================
    const gD1 = await mkGuest([[P330, "1"]]);
    const oD1 = await checkout(gD1.tok, tCF1, idAF1, key("date1"));
    const gD2 = await mkGuest([[P330, "1"]]);
    const oD2 = await checkout(gD2.tok, tCF1, idAF1, key("date2"));
    t("date-orders-ready", oD1.status === 201 && oD2.status === 201, `${oD1.status}/${oD2.status}`);
    const pastIso = new Date(Date.now() - 86400_000).toISOString();
    const futureIso = new Date(Date.now() + 86400_000).toISOString();
    const fFuture = await get(`/api/admin/orders?limit=20&dateFrom=${encodeURIComponent(futureIso)}`, ck);
    t("date-from-future-empty", fFuture.status === 200 && (fFuture.body?.data ?? []).length === 0,
      `${fFuture.status}`);
    const fPast = await get(`/api/admin/orders?limit=20&dateTo=${encodeURIComponent(pastIso)}`, ck);
    t("date-to-past-empty", fPast.status === 200 && (fPast.body?.data ?? []).length === 0,
      `${fPast.status}`);
    const fWide = await get(`/api/admin/orders?limit=100&dateFrom=${encodeURIComponent(pastIso)}&dateTo=${encodeURIComponent(futureIso)}&customerId=${idCF1}`, ck);
    const fWideIds = (fWide.body?.data ?? []).map((o) => o.id);
    t("date-wide-contains-both", fWide.status === 200
      && fWideIds.includes(oD1.body?.data?.order?.id) && fWideIds.includes(oD2.body?.data?.order?.id),
      `${fWide.status}/${fWideIds.length}`);
    const fInv = await get(`/api/admin/orders?limit=20&dateFrom=${encodeURIComponent(futureIso)}&dateTo=${encodeURIComponent(pastIso)}`, ck);
    t("date-inverted-400", fInv.status === 400, String(fInv.status));
    const fBad = await get(`/api/admin/orders?limit=20&dateFrom=not-a-date`, ck);
    t("date-malformed-400", fBad.status === 400, String(fBad.status));

    // ================= DISABLE-VS-CHECKOUT RACE =================
    // Coupon ACTIVE + checkout concurrently: exactly one branch wins, and the
    // losing branch leaves no partial state (no usage without order, no order
    // without usage).
    const cpR = await post(`/api/admin/coupons`, { promotionId: idPar, code: `BAFR${stamp}`.toUpperCase().slice(0, 10) }, ck);
    const idCpR = cpR.body?.data?.id;
    const codeR = cpR.body?.data?.code;
    couponIds.add(idCpR);
    const gR = await mkGuest([[P330, "1"]]);
    const kR = key("disrace");
    const resBeforeR = await reservedOf(P330);
    const [disRes, oRes] = await Promise.all([
      patch(`/api/admin/coupons/${idCpR}`, { isActive: false }, ck),
      checkout(gR.tok, tCF1, idAF1, kR, { couponCode: codeR }),
    ]);
    const usedR = Number((await q(`SELECT used_count FROM coupons WHERE id = $1::uuid`, [idCpR]))[0].used_count);
    const usageRows = Number((await q(`SELECT count(*)::int AS n FROM coupon_usages WHERE coupon_id = $1::uuid`, [idCpR]))[0].n);
    const orderRows = Number((await q(`SELECT count(*)::int AS n FROM orders WHERE idempotency_key = $1`, [kR]))[0].n);
    if (oRes.status === 201) {
      t("disable-race-checkout-won", disRes.status === 200 && usedR === 1 && usageRows === 1 && orderRows === 1,
        `checkout=201 disable=${disRes.status} used=${usedR}`);
    } else if (oRes.status === 422) {
      t("disable-race-disable-won", usedR === 0 && usageRows === 0 && orderRows === 0
        && (await reservedOf(P330)) === resBeforeR,
        `checkout=422 disable=${disRes.status} used=${usedR}`);
    } else {
      t("disable-race-deterministic", false, `unexpected checkout=${oRes.status} disable=${disRes.status}`);
    }

    // ================= CROSS-MODULE ISOLATION (bare) =================
    // A permissionless admin is denied everywhere; anonymous is unauthenticated.
    const isoPaths = [
      ["catalog-write", "POST", `/api/admin/catalog/brands`, { name: `BAF no ${stamp}`, slug: `baf-no-${stamp}` }],
      ["inventory-write", "POST", `/api/admin/inventory/adjust`, { productVariantId: P330, delta: "1", movementType: "ADJUSTMENT" }],
      ["orders-cancel", "POST", `/api/admin/orders/${oD1.body?.data?.order?.id}/cancel`, {}],
      ["customer-write", "POST", `/api/admin/customers/${idCF1}/addresses`, { city: "X", phone: P_F1 }],
      ["promotion-write", "POST", `/api/admin/promotions`, { name: `BAF no ${stamp}`, type: "PERCENTAGE", scope: "LINE", discountPercent: "1.00" }],
      ["coupon-write", "POST", `/api/admin/coupons`, { promotionId: idPar, code: `BAFNO${stamp}`.toUpperCase().slice(0, 10) }],
      ["user-create", "POST", `/api/admin/users`, { name: "No", email: `no-${stamp}@example.com` }],
      ["role-grant", "POST", `/api/admin/roles/${idRole}/grants`, { permissionId: UNKNOWN }],
      ["settings-write", "PATCH", `/api/admin/settings/delivery.default_fee`, { value: "20.00" }],
      ["audit-read", "GET", `/api/admin/audit-logs?limit=5`, null],
    ];
    for (const [nm, method, path, body] of isoPaths) {
      const rr = method === "GET"
        ? await get(path, ckb)
        : await jcall(method, path, body, { cookie: ckb });
      t(`isolation-bare-403-${nm}`, rr.status === 403, `${nm}=${rr.status}`);
    }
    t("isolation-anon-401", (await get(`/api/admin/audit-logs?limit=5`)).status === 401
      && (await post(`/api/admin/roles`, { name: "NOPE" })).status === 401);

    // ================= SUPER_ADMIN GUARDS (spot re-verify) =================
    const meDeact = await patch(`/api/admin/users/${userIdOf(OWNER_EMAIL)}`, { isActive: false }, cko);
    t("guard-self-deactivate-403", meDeact.status === 403, String(meDeact.status));
    // Audit pairing spot check: the test role creation must have an audit row.
    const roleAudit = await q(`SELECT count(*)::int AS n FROM audit_logs WHERE entity_id = $1::uuid`, [idRole]);
    t("audit-pairs-role-create", Number(roleAudit[0].n) >= 1, String(roleAudit[0].n));
  } finally {
    try {
      const auditIdsAfter = (await q(`SELECT id::text AS id FROM audit_logs`)).map((r) => r.id);
      const mine = auditIdsAfter.filter((id) => !auditIdsBefore.has(id));
      if (mine.length > 0) {
        await db.query(`DELETE FROM audit_logs WHERE id = ANY($1::uuid[])`, [mine]).catch(() => {});
      }
      // Remove role assignments on fixture users, then the test role.
      for (const em of [STORE_EMAIL, BARE_EMAIL]) {
        const ur = await db.query(`SELECT ur.id FROM user_roles ur JOIN users u ON u.id = ur.user_id
          JOIN roles r ON r.id = ur.role_id WHERE u.email = $1 AND r.name LIKE 'BAF%'`, [em]).catch(() => ({ rows: [] }));
        for (const row of ur.rows) {
          await db.query(`DELETE FROM user_roles WHERE id = $1`, [row.id]).catch(() => {});
        }
      }
      for (const id of roleIds) {
        await db.query(`DELETE FROM role_permissions WHERE role_id = $1`, [id]).catch(() => {});
        await db.query(`DELETE FROM user_roles WHERE role_id = $1`, [id]).catch(() => {});
        await db.query(`DELETE FROM roles WHERE id = $1`, [id]).catch(() => {});
      }
      const ordRows = await db.query(
        `SELECT o.id FROM orders o JOIN customers c ON c.id = o.customer_id WHERE c.phone IN ($1,$2)`,
        [CANON(P_F1), CANON(P_F2)],
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
    } catch { /* scratch hygiene best-effort */ }
    await db.end().catch(() => {});
  }
  done();
}

main().catch((e) => {
  console.error(`BAF_SUITE_FAILED: ${e.constructor.name}: ${String(e.message).slice(0, 200)}`);
  process.exit(1);
});
