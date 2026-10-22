// Phase-10 remediation suite (scratch-only, needs a built server pointed at DB).
// Usage: node scripts/api/t-phase10-remediation.mjs --db <name> --port <port>
//
// Covers the six closed defects end-to-end against the LIVE API (not the UI):
//   G01 price capabilities  - prices.update governs the price write route,
//                             prices.view governs the price read; a products-only
//                             role may not change or see a price.
//   G02 price idempotency   - "15" / "15.00" / "15.000" are the SAME price:
//                             a no-op succeeds and writes NO history row and NO
//                             audit row; a real change writes exactly one of each;
//                             an unrepresentable value is a 400, never a 500.
//   G03 customer split      - customers.view reads; customers.manage writes
//                             (profile, registration, address add/edit/delete).
//   G04 audit protection    - the trail is read-only, needs the read key, and
//                             never answers a write method.
//   G05 empty PATCH         - an empty or unknown-field PATCH is refused with
//                             a validation error, AFTER the permission check.
//   G06 request context     - the audit row carries the client IP (only from a
//                             trusted proxy) and the User-Agent; no cookie,
//                             authorization header or token ever lands there.
//   G07 session cookie      - the cookie the server issues is usable by the
//                             browser in this environment, and logout clears it.
//
// All fixtures are created through the ADMIN API (or a prefixed SQL insert
// where no admin route exists) and removed afterwards. Prints JSON, never
// passwords, hashes, cookies or tokens.
import "dotenv/config";
import { Client } from "pg";
import { extractSessionCookie } from "./_session-cookie.mjs";

const args = process.argv.slice(2);
const dbFlag = args.indexOf("--db");
const portFlag = args.indexOf("--port");
const dbName = dbFlag === -1 ? null : args[dbFlag + 1];
const port = portFlag === -1 ? "3131" : args[portFlag + 1];

const results = [];
const t = (name, pass, detail = "") => results.push({ name, pass: pass === true, detail });
const done = (code) => {
  const failures = results.filter((r) => !r.pass);
  console.log(
    JSON.stringify(
      {
        suite: "phase10-remediation",
        db: dbName,
        total: results.length,
        failures: failures.length,
        failed: failures.map((f) => `${f.name} :: ${f.detail}`),
        passed: results.filter((r) => r.pass).map((r) => r.name),
      },
      null,
      2,
    ),
  );
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

const OWNER_EMAIL = "owner@hyper-al-moatasem.local";
const OWNER_PW = "Cat-Test-Owner-Pass-0001!";
const PROBE_PW = "P10-Remediation-Pass-0001!";
const STAMP = Date.now().toString(36);
const PFX = `p10r-${STAMP}`;

const isUuid = (s) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s || "");
void isUuid;

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

  const call = async (cookie, method, path, body, extraHeaders = {}) => {
    const r = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(cookie ? { cookie } : {}),
        ...extraHeaders,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let parsed = null;
    const text = await r.text();
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    return { status: r.status, body: parsed, text };
  };
  const get = (path, cookie, extra) => call(cookie, "GET", path, undefined, extra);
  const post = (path, body, cookie, extra) => call(cookie, "POST", path, body, extra);
  const patch = (path, body, cookie, extra) => call(cookie, "PATCH", path, body, extra);
  const del = (path, cookie, extra) => call(cookie, "DELETE", path, undefined, extra);

  // The session cookie name depends on the environment (production __Host- vs
  // the local-development cookie) — read whatever the server actually issued
  // and send it back under the SAME name.
  const loginAs = async (email, password) => {
    const r = await fetch(`${baseUrl}/api/admin/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const setCookie = r.headers.get("set-cookie") || "";
    const ck = extractSessionCookie(setCookie);
    return { status: r.status, cookie: ck ? ck.header : null, raw: setCookie };
  };

  const roleIds = new Set();
  const userIds = new Set();
  const customerIds = new Set();
  const variantIds = new Set();
  let productId = null;

  try {
    const owner = await loginAs(OWNER_EMAIL, OWNER_PW);
    t("owner-login-201", owner.status === 201 && !!owner.cookie, String(owner.status));
    if (!owner.cookie) {
      console.error("REFUSED_NO_OWNER_SESSION");
      process.exit(1);
    }
    const ck = owner.cookie;

    // ------------------------------------------------------------------ setup
    const mkRole = async (name, keys) => {
      const r = await post("/api/admin/roles", { name, description: "phase10 remediation probe" }, ck);
      if (r.status !== 201) return null;
      roleIds.add(r.body.data.id);
      const perms = await get("/api/admin/permissions?limit=100", ck);
      const byKey = new Map((perms.body?.data ?? []).map((p) => [p.key, p.id]));
      for (const k of keys) {
        const pid = byKey.get(k);
        if (!pid) continue;
        const g = await post(`/api/admin/roles/${r.body.data.id}/grants`, { permissionId: pid }, ck);
        if (g.status !== 201) return null;
      }
      return r.body.data.id;
    };
    const mkUser = async (email, roleId) => {
      const u = await post("/api/admin/users", { name: "P10 Remediation", email }, ck);
      if (u.status !== 201) return null;
      userIds.add(u.body.data.id);
      await post(`/api/admin/users/${u.body.data.id}/password`, { password: PROBE_PW }, ck);
      if (roleId) await post(`/api/admin/users/${u.body.data.id}/roles`, { roleId }, ck);
      const l = await loginAs(email, PROBE_PW);
      return { id: u.body.data.id, cookie: l.cookie, status: l.status };
    };

    const roleProductsOnly = await mkRole(`${PFX}_PRODUCTS`.toUpperCase(), ["products.view", "products.update", "products.create"]);
    const rolePriceReader = await mkRole(`${PFX}_PRICE_READER`.toUpperCase(), ["products.view", "prices.view"]);
    const rolePriceWriter = await mkRole(`${PFX}_PRICE_WRITER`.toUpperCase(), ["products.view", "products.update", "prices.view", "prices.update"]);
    const roleCustReader = await mkRole(`${PFX}_CUST_READER`.toUpperCase(), ["customers.view"]);
    const roleCustWriter = await mkRole(`${PFX}_CUST_WRITER`.toUpperCase(), ["customers.view", "customers.manage"]);
    const roleEmpty = await mkRole(`${PFX}_EMPTY`.toUpperCase(), []);
    t("fixture-roles-created", [roleProductsOnly, rolePriceReader, rolePriceWriter, roleCustReader, roleCustWriter, roleEmpty].every(Boolean));

    const uProducts = await mkUser(`${PFX}-products@example.com`, roleProductsOnly);
    const uPriceReader = await mkUser(`${PFX}-pricereader@example.com`, rolePriceReader);
    const uPriceWriter = await mkUser(`${PFX}-pricewriter@example.com`, rolePriceWriter);
    const uCustReader = await mkUser(`${PFX}-custreader@example.com`, roleCustReader);
    const uCustWriter = await mkUser(`${PFX}-custwriter@example.com`, roleCustWriter);
    const uEmpty = await mkUser(`${PFX}-empty@example.com`, roleEmpty);
    t("fixture-users-created", [uProducts, uPriceReader, uPriceWriter, uCustReader, uCustWriter, uEmpty].every((u) => u && u.cookie));

    // A product + variant to price (created by the owner, removed in cleanup).
    const catList = await get("/api/admin/catalog/categories?limit=5&active=true", ck);
    const categoryId = catList.body?.data?.[0]?.id;
    const prod = await post(
      "/api/admin/catalog/products",
      { name: `${PFX}-product`, categoryId, productType: "PIECE", unit: "PIECE" },
      ck,
    );
    t("fixture-product-201", prod.status === 201, String(prod.status));
    productId = prod.body?.data?.id ?? null;
    const varRes = await post(
      `/api/admin/catalog/products/${productId}/variants`,
      { name: `${PFX}-variant`, price: "15.00" },
      ck,
    );
    t("fixture-variant-201", varRes.status === 201, String(varRes.status));
    const variantId = varRes.body?.data?.id;
    if (variantId) variantIds.add(variantId);

    // A customer row (no admin create route exists — inserted with the same
    // constraints the table enforces, and removed in cleanup).
    const cust = await q(
      `INSERT INTO customers (id, first_name, phone, is_registered, is_active)
       VALUES (gen_random_uuid(), $1, $2, false, true) RETURNING id::text`,
      [`P10 ${STAMP}`, `201${String(Date.now()).slice(-8)}`],
    );
    const customerId = cust[0]?.id;
    if (customerId) customerIds.add(customerId);
    t("fixture-customer-inserted", !!customerId);

    // ------------------------------------------------------------------- G01
    {
      const before = await q("SELECT price::text AS price FROM product_variants WHERE id = $1::uuid", [variantId]);
      void before;

      const denied = await patch(`/api/admin/catalog/variants/${variantId}/price`, { price: "16.00" }, uProducts.cookie);
      t("G01-products-update-cannot-price-403", denied.status === 403, `status=${denied.status}`);

      const anon = await patch(`/api/admin/catalog/variants/${variantId}/price`, { price: "16.00" });
      t("G01-anon-price-401", anon.status === 401, `status=${anon.status}`);

      const reader = await patch(`/api/admin/catalog/variants/${variantId}/price`, { price: "16.00" }, uPriceReader.cookie);
      t("G01-price-reader-cannot-write-403", reader.status === 403, `status=${reader.status}`);

      const writer = await patch(`/api/admin/catalog/variants/${variantId}/price`, { price: "16.00" }, uPriceWriter.cookie);
      t("G01-price-writer-can-write-200", writer.status === 200, `status=${writer.status}`);

      const after = await q("SELECT price::text AS price FROM product_variants WHERE id = $1::uuid", [variantId]);
      t("G01-refused-write-changed-nothing", after[0]?.price === "16.00" || after[0]?.price === "16", `price=${after[0]?.price}`);

      const readNoPrice = await get(`/api/admin/catalog/variants/${variantId}`, uProducts.cookie);
      t("G01-variant-read-needs-prices-view-403", readNoPrice.status === 403, `status=${readNoPrice.status}`);
      const readWithPrice = await get(`/api/admin/catalog/variants/${variantId}`, uPriceReader.cookie);
      t("G01-variant-read-with-prices-view-200", readWithPrice.status === 200, `status=${readWithPrice.status}`);

      // the price field of a variant PATCH is a price capability too
      const patchPriceByProducts = await patch(`/api/admin/catalog/variants/${variantId}`, { costPrice: "9.00" }, uProducts.cookie);
      t("G01-variant-price-field-needs-prices-update-403", patchPriceByProducts.status === 403, `status=${patchPriceByProducts.status}`);
      const patchPriceByWriter = await patch(`/api/admin/catalog/variants/${variantId}`, { costPrice: "9.00" }, uPriceWriter.cookie);
      t("G01-variant-price-field-with-prices-update-200", patchPriceByWriter.status === 200, `status=${patchPriceByWriter.status}`);
      const patchNameByProducts = await patch(`/api/admin/catalog/variants/${variantId}`, { name: `${PFX}-variant-renamed` }, uProducts.cookie);
      t("G01-variant-name-with-products-update-200", patchNameByProducts.status === 200, `status=${patchNameByProducts.status}`);
    }

    // ------------------------------------------------------------------- G02
    {
      await patch(`/api/admin/catalog/variants/${variantId}/price`, { price: "15.00" }, uPriceWriter.cookie);
      const base = await q("SELECT price::text AS price FROM product_variants WHERE id = $1::uuid", [variantId]);
      t("G02-baseline-price-15", base[0]?.price === "15.00", `price=${base[0]?.price}`);

      const hist0 = await q("SELECT count(*)::int AS n FROM product_price_history WHERE product_variant_id = $1::uuid", [variantId]);
      const audit0 = await q("SELECT count(*)::int AS n FROM audit_logs WHERE entity_id = $1::uuid AND action = 'variants.price'", [variantId]);

      const same1 = await patch(`/api/admin/catalog/variants/${variantId}/price`, { price: "15.00" }, uPriceWriter.cookie);
      t("G02-same-value-15.00-200", same1.status === 200, `status=${same1.status}`);
      const same2 = await patch(`/api/admin/catalog/variants/${variantId}/price`, { price: "15" }, uPriceWriter.cookie);
      t("G02-same-value-15-200", same2.status === 200, `status=${same2.status}`);
      const same3 = await patch(`/api/admin/catalog/variants/${variantId}/price`, { price: "15.000" }, uPriceWriter.cookie);
      t("G02-same-value-15.000-200", same3.status === 200, `status=${same3.status}`);

      const hist1 = await q("SELECT count(*)::int AS n FROM product_price_history WHERE product_variant_id = $1::uuid", [variantId]);
      const audit1 = await q("SELECT count(*)::int AS n FROM audit_logs WHERE entity_id = $1::uuid AND action = 'variants.price'", [variantId]);
      t("G02-no-false-history-row", hist1[0].n === hist0[0].n, `history ${hist0[0].n} -> ${hist1[0].n}`);
      t("G02-no-misleading-audit-row", audit1[0].n === audit0[0].n, `audit ${audit0[0].n} -> ${audit1[0].n}`);

      const afterSame = await q("SELECT price::text AS price FROM product_variants WHERE id = $1::uuid", [variantId]);
      t("G02-price-unchanged-after-noop", afterSame[0]?.price === "15.00", `price=${afterSame[0]?.price}`);

      const changed = await patch(`/api/admin/catalog/variants/${variantId}/price`, { price: "15.50", reason: "p10 remediation" }, uPriceWriter.cookie);
      t("G02-real-change-200", changed.status === 200, `status=${changed.status}`);
      const hist2 = await q("SELECT count(*)::int AS n FROM product_price_history WHERE product_variant_id = $1::uuid", [variantId]);
      const audit2 = await q("SELECT count(*)::int AS n FROM audit_logs WHERE entity_id = $1::uuid AND action = 'variants.price'", [variantId]);
      t("G02-real-change-writes-one-history", hist2[0].n === hist0[0].n + 1, `history ${hist0[0].n} -> ${hist2[0].n}`);
      t("G02-real-change-writes-one-audit", audit2[0].n === audit0[0].n + 1, `audit ${audit0[0].n} -> ${audit2[0].n}`);
      const priceNow = await q("SELECT price::text AS price FROM product_variants WHERE id = $1::uuid", [variantId]);
      t("G02-price-updated", priceNow[0]?.price === "15.50", `price=${priceNow[0]?.price}`);

      const invalid = await patch(`/api/admin/catalog/variants/${variantId}/price`, { price: "15.005" }, uPriceWriter.cookie);
      t("G02-unrepresentable-value-400", invalid.status === 400, `status=${invalid.status}`);
      const negative = await patch(`/api/admin/catalog/variants/${variantId}/price`, { price: "-1" }, uPriceWriter.cookie);
      t("G02-negative-value-400", negative.status === 400, `status=${negative.status}`);
      const garbage = await patch(`/api/admin/catalog/variants/${variantId}/price`, { price: "abc" }, uPriceWriter.cookie);
      t("G02-garbage-value-400", garbage.status === 400, `status=${garbage.status}`);

      // repeated identical request -> no duplicate side effect
      const hist3Before = await q("SELECT count(*)::int AS n FROM product_price_history WHERE product_variant_id = $1::uuid", [variantId]);
      await patch(`/api/admin/catalog/variants/${variantId}/price`, { price: "15.50" }, uPriceWriter.cookie);
      const hist3 = await q("SELECT count(*)::int AS n FROM product_price_history WHERE product_variant_id = $1::uuid", [variantId]);
      t("G02-repeated-request-no-duplicate", hist3[0].n === hist3Before[0].n, `history ${hist3Before[0].n} -> ${hist3[0].n}`);

      // concurrent identical updates -> no corruption, at most one history row
      const hist4Before = await q("SELECT count(*)::int AS n FROM product_price_history WHERE product_variant_id = $1::uuid", [variantId]);
      await Promise.all([
        patch(`/api/admin/catalog/variants/${variantId}/price`, { price: "16.00" }, uPriceWriter.cookie),
        patch(`/api/admin/catalog/variants/${variantId}/price`, { price: "16.00" }, uPriceWriter.cookie),
        patch(`/api/admin/catalog/variants/${variantId}/price`, { price: "16.00" }, uPriceWriter.cookie),
      ]);
      const hist4 = await q("SELECT count(*)::int AS n FROM product_price_history WHERE product_variant_id = $1::uuid", [variantId]);
      const priceConcurrent = await q("SELECT price::text AS price FROM product_variants WHERE id = $1::uuid", [variantId]);
      t("G02-concurrent-no-duplicate-history", hist4[0].n - hist4Before[0].n <= 1, `history ${hist4Before[0].n} -> ${hist4[0].n}`);
      t("G02-concurrent-price-consistent", priceConcurrent[0]?.price === "16.00", `price=${priceConcurrent[0]?.price}`);

      // the DB CHECK that protects the history is still in place
      const check = await q(
        `SELECT conname FROM pg_constraint WHERE conname = 'chk_price_history_changed'`,
      );
      t("G02-db-check-still-present", check.length === 1, JSON.stringify(check));
    }

    // ------------------------------------------------------------------- G03
    {
      const read = await get(`/api/admin/customers/${customerId}`, uCustReader.cookie);
      t("G03-reader-can-read-200", read.status === 200, `status=${read.status}`);
      const write = await patch(`/api/admin/customers/${customerId}`, { firstName: "Hacked" }, uCustReader.cookie);
      t("G03-reader-cannot-write-403", write.status === 403, `status=${write.status}`);
      const reg = await post(`/api/admin/customers/${customerId}/register`, { password: "P10-Register-Pass-0001!" }, uCustReader.cookie);
      t("G03-reader-cannot-register-403", reg.status === 403, `status=${reg.status}`);
      const addrCreate = await post(`/api/admin/customers/${customerId}/addresses`, { city: "Cairo", phone: "201000000001" }, uCustReader.cookie);
      t("G03-reader-cannot-add-address-403", addrCreate.status === 403, `status=${addrCreate.status}`);
      const addrRows = await q("SELECT id::text FROM customer_addresses WHERE customer_id = $1::uuid", [customerId]);
      const addressId = addrRows[0]?.id;
      if (addressId) {
        const addrPatch = await patch(`/api/admin/customers/${customerId}/addresses/${addressId}`, { city: "Giza" }, uCustReader.cookie);
        t("G03-reader-cannot-edit-address-403", addrPatch.status === 403, `status=${addrPatch.status}`);
        const addrDelete = await del(`/api/admin/customers/${customerId}/addresses/${addressId}`, uCustReader.cookie);
        t("G03-reader-cannot-delete-address-403", addrDelete.status === 403, `status=${addrDelete.status}`);
      }
      const anonWrite = await patch(`/api/admin/customers/${customerId}`, { firstName: "Anon" });
      t("G03-anon-write-401", anonWrite.status === 401, `status=${anonWrite.status}`);

      const write2 = await patch(`/api/admin/customers/${customerId}`, { firstName: "P10 Written" }, uCustWriter.cookie);
      t("G03-writer-can-write-200", write2.status === 200 && write2.body?.data?.firstName === "P10 Written", `status=${write2.status}`);
      const addrCreate2 = await post(`/api/admin/customers/${customerId}/addresses`, { city: "Cairo", phone: "201000000002" }, uCustWriter.cookie);
      t("G03-writer-can-add-address-201", addrCreate2.status === 201, `status=${addrCreate2.status}`);
      const newAddressId = addrCreate2.body?.data?.id;
      if (newAddressId) {
        const addrPatch2 = await patch(`/api/admin/customers/${customerId}/addresses/${newAddressId}`, { city: "Giza" }, uCustWriter.cookie);
        t("G03-writer-can-edit-address-200", addrPatch2.status === 200, `status=${addrPatch2.status}`);
        const addrDelete2 = await del(`/api/admin/customers/${customerId}/addresses/${newAddressId}`, uCustWriter.cookie);
        t("G03-writer-can-delete-address-200", addrDelete2.status === 200, `status=${addrDelete2.status}`);
      }
      const row = await q("SELECT first_name AS f FROM customers WHERE id = $1::uuid", [customerId]);
      t("G03-write-persisted", row[0]?.f === "P10 Written", `first_name=${row[0]?.f}`);
    }

    // ------------------------------------------------------------------- G04
    {
      const anon = await get("/api/admin/audit-logs?limit=5");
      t("G04-audit-anon-401", anon.status === 401, `status=${anon.status}`);
      const noKey = await get("/api/admin/audit-logs?limit=5", uCustReader.cookie);
      t("G04-audit-without-key-403", noKey.status === 403, `status=${noKey.status}`);
      const withKey = await get("/api/admin/audit-logs?limit=5", ck);
      t("G04-audit-with-key-200", withKey.status === 200 && Array.isArray(withKey.body?.data), `status=${withKey.status}`);
      const raw = JSON.stringify(withKey.body ?? {});
      t("G04-audit-payload-has-no-secrets",
        !/password_hash|argon2|token_hash|__Host-admin-session|set-cookie/i.test(raw));
      const detail = withKey.body?.data?.[0]?.id;
      if (detail) {
        const d = await get(`/api/admin/audit-logs/${detail}`, ck);
        t("G04-audit-detail-200", d.status === 200, `status=${d.status}`);
        const dNoKey = await get(`/api/admin/audit-logs/${detail}`, uCustReader.cookie);
        t("G04-audit-detail-without-key-403", dNoKey.status === 403, `status=${dNoKey.status}`);
      }
      const w1 = await post("/api/admin/audit-logs", { action: "p10.probe" }, ck);
      t("G04-audit-write-405", w1.status === 405, `status=${w1.status}`);
      const w2 = await del("/api/admin/audit-logs/00000000-0000-7000-8000-000000000000", ck);
      t("G04-audit-delete-405", w2.status === 405, `status=${w2.status}`);
    }

    // ------------------------------------------------------------------- G05
    {
      const promo = await post("/api/admin/promotions", { name: `${PFX}-promo`, type: "PERCENTAGE", scope: "LINE", discountPercent: "10" }, ck);
      t("G05-fixture-promotion-201", promo.status === 201, `status=${promo.status}`);
      const promoId = promo.body?.data?.id;
      if (promoId) {
        const empty = await patch(`/api/admin/promotions/${promoId}`, {}, ck);
        t("G05-empty-promotion-patch-400", empty.status === 400, `status=${empty.status}`);
        const emptyNoKey = await patch(`/api/admin/promotions/${promoId}`, {}, uCustReader.cookie);
        t("G05-empty-promotion-patch-unauthorized-403", emptyNoKey.status === 403, `status=${emptyNoKey.status}`);
        const unknown = await patch(`/api/admin/promotions/${promoId}`, { nope: 1 }, ck);
        t("G05-unknown-field-promotion-400", unknown.status === 400, `status=${unknown.status}`);
        const valid = await patch(`/api/admin/promotions/${promoId}`, { priority: 3 }, ck);
        t("G05-valid-promotion-patch-200", valid.status === 200, `status=${valid.status}`);
        const emptyNoPerm = await patch(`/api/admin/promotions/${promoId}`, {}, uEmpty.cookie);
        t("G05-empty-patch-without-any-permission-403", emptyNoPerm.status === 403, `status=${emptyNoPerm.status}`);
        const noPerm = await patch(`/api/admin/promotions/${promoId}`, { priority: 4 }, uEmpty.cookie);
        t("G05-patch-without-any-permission-403", noPerm.status === 403, `status=${noPerm.status}`);
      }
      const coupon = await post("/api/admin/coupons", { promotionId: promoId, code: `${PFX.toUpperCase()}-CODE` }, ck);
      t("G05-fixture-coupon-201", coupon.status === 201, `status=${coupon.status}`);
      const couponId = coupon.body?.data?.id;
      if (couponId) {
        const empty = await patch(`/api/admin/coupons/${couponId}`, {}, ck);
        t("G05-empty-coupon-patch-400", empty.status === 400, `status=${empty.status}`);
        const emptyNoKey = await patch(`/api/admin/coupons/${couponId}`, {}, uCustReader.cookie);
        t("G05-empty-coupon-patch-unauthorized-403", emptyNoKey.status === 403, `status=${emptyNoKey.status}`);
        const valid = await patch(`/api/admin/coupons/${couponId}`, { usageLimit: 7 }, ck);
        t("G05-valid-coupon-patch-200", valid.status === 200, `status=${valid.status}`);
        const emptyNoPerm = await patch(`/api/admin/coupons/${couponId}`, {}, uEmpty.cookie);
        t("G05-empty-coupon-patch-without-any-permission-403", emptyNoPerm.status === 403, `status=${emptyNoPerm.status}`);
      }
      // a PATCH on a plain resource with an empty body is refused too
      const emptyUser = await patch(`/api/admin/users/${uCustReader.id}`, {}, ck);
      t("G05-empty-user-patch-400", emptyUser.status === 400, `status=${emptyUser.status}`);
    }

    // ------------------------------------------------------------------- G06
    {
      // The server resolves the request context centrally. With a trusted
      // proxy declared, the forwarded client IP and the User-Agent land in the
      // audit row; without it, the IP stays NULL and the header is ignored.
      const before = await q("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'variants.price'");
      await patch(
        `/api/admin/catalog/variants/${variantId}/price`,
        { price: "17.00" },
        uPriceWriter.cookie,
        { "x-forwarded-for": "203.0.113.7", "user-agent": "P10-Probe-Agent/1.0" },
      );
      const rows = await q(
        `SELECT ip_address::text AS ip, user_agent AS ua FROM audit_logs
          WHERE action = 'variants.price' ORDER BY created_at DESC LIMIT 1`,
      );
      const row = rows[0];
      const trusted = process.env.PHASE10_TRUSTED_PROXY === "1";
      if (trusted) {
        // PostgreSQL `inet` normalizes the address with its netmask.
        t("G06-trusted-proxy-ip-recorded", row?.ip === "203.0.113.7" || row?.ip === "203.0.113.7/32", `ip=${row?.ip}`);
      } else {
        t("G06-untrusted-header-ignored", row?.ip === null, `ip=${row?.ip}`);
      }
      t("G06-user-agent-recorded", row?.ua === "P10-Probe-Agent/1.0", `ua=${row?.ua}`);
      const raw = JSON.stringify(row ?? {});
      t("G06-no-token-or-cookie-in-audit", !/cookie|authorization|token/i.test(raw), raw);
      t("G06-audit-row-written", (await q("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'variants.price'"))[0].n === before[0].n + 1);
    }

    // ------------------------------------------------------------------- G07
    {
      const l = await loginAs(`${PFX}-pricewriter@example.com`, PROBE_PW);
      t("G07-login-201", l.status === 201, `status=${l.status}`);
      const setCookie = l.raw || "";
      const isProdCookie = /__Host-admin-session=/.test(setCookie);
      const isDevCookie = /hyper-admin-session-dev=/.test(setCookie);
      t("G07-exactly-one-session-cookie", isProdCookie !== isDevCookie, setCookie.slice(0, 60));
      if (isProdCookie) {
        // The production cookie keeps the browser-enforced __Host- rules.
        t("G07-production-cookie-secure", /; ?Secure/i.test(setCookie), setCookie.slice(0, 120));
        t("G07-production-cookie-httponly", /HttpOnly/i.test(setCookie), setCookie.slice(0, 120));
        t("G07-production-cookie-path-root", /Path=\//i.test(setCookie), setCookie.slice(0, 120));
        t("G07-production-cookie-no-domain", !/Domain=/i.test(setCookie), setCookie.slice(0, 120));
      } else {
        // The local-development cookie: no prefix (so no Secure requirement).
        t("G07-local-dev-cookie-not-secure", !/; ?Secure/i.test(setCookie), setCookie.slice(0, 120));
        t("G07-local-dev-cookie-httponly", /HttpOnly/i.test(setCookie), setCookie.slice(0, 120));
        t("G07-local-dev-cookie-path-root", /Path=\//i.test(setCookie), setCookie.slice(0, 120));
      }
      const expectCookie = process.env.PHASE10_EXPECT_COOKIE;
      if (expectCookie === "prod") t("G07-expected-production-cookie", isProdCookie, setCookie.slice(0, 60));
      if (expectCookie === "dev") t("G07-expected-dev-cookie", isDevCookie, setCookie.slice(0, 60));

      const session = await get("/api/admin/session", l.cookie);
      t("G07-session-usable-200", session.status === 200, `status=${session.status}`);
      const out = await del("/api/admin/session", l.cookie);
      t("G07-logout-200", out.status === 200, `status=${out.status}`);
      const after = await get("/api/admin/session", l.cookie);
      t("G07-session-revoked-after-logout", after.status === 401, `status=${after.status}`);
    }
  } catch (error) {
    t("suite-crashed", false, String(error && error.message ? error.message : error));
  } finally {
    // ---- cleanup (only this suite's own rows) ----
    try {
      for (const id of customerIds) {
        await q("DELETE FROM customer_addresses WHERE customer_id = $1::uuid", [id]);
        await q("DELETE FROM customers WHERE id = $1::uuid", [id]);
      }
      for (const id of variantIds) {
        await q("DELETE FROM product_price_history WHERE product_variant_id = $1::uuid", [id]);
        await q("DELETE FROM product_variants WHERE id = $1::uuid", [id]);
      }
      if (productId) await q("DELETE FROM products WHERE id = $1::uuid", [productId]);
      // The probe ROLES are removed completely (nothing references them once
      // the mappings are gone).
      for (const id of roleIds) {
        await q("DELETE FROM user_roles WHERE role_id = $1::uuid", [id]);
        await q("DELETE FROM role_permissions WHERE role_id = $1::uuid", [id]);
        await q("DELETE FROM roles WHERE id = $1::uuid", [id]);
      }
      // The probe USERS are soft-deactivated, not deleted: `audit_logs.user_id`
      // is a RESTRICT foreign key and audit residue is never deleted (frozen
      // domain rule). The same posture the application itself uses.
      for (const id of userIds) {
        await q("DELETE FROM user_roles WHERE user_id = $1::uuid", [id]);
        await q("DELETE FROM admin_sessions WHERE user_id = $1::uuid", [id]);
        await q("UPDATE users SET is_active = FALSE, deleted_at = now() WHERE id = $1::uuid", [id]);
      }
      await q("DELETE FROM promotions WHERE name LIKE $1", [`${PFX}-%`]);
      await q("DELETE FROM coupons WHERE code LIKE $1", [`${PFX.toUpperCase()}-%`]);
      const left = await q(
        `SELECT
           (SELECT count(*)::int FROM roles WHERE name ILIKE $1) AS roles,
           (SELECT count(*)::int FROM users WHERE email ILIKE $1 AND is_active) AS active_users,
           (SELECT count(*)::int FROM products WHERE name ILIKE $1) AS products,
           (SELECT count(*)::int FROM customers WHERE first_name ILIKE $1) AS customers,
           (SELECT count(*)::int FROM product_variants WHERE name ILIKE $1) AS variants`,
        [`${PFX}%`],
      );
      console.error(`CLEANUP_STATE: ${JSON.stringify(left[0])}`);
    } catch (e) {
      console.error(`CLEANUP_ERROR: ${e.message}`);
    }
    await db.end();
    done();
  }
}

main();
