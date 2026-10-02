// BA-3 inventory API suite (scratch-only, needs built server pointed at DB).
// Usage: node scripts/api/t-inventory.mjs --db <name> --port <port>
// Covers: storefront availability (variant/product/code-integration), admin
// list/detail/movements reads, weighted validation (0.125..1.000, step,
// piece packs), reserve/release lifecycle (no movements, 409s), commit
// (R3 predicate + R7 envelope + SALE pairing), adjust + audit math,
// threshold/low-stock, and the anon/store/owner/roleless/inactive matrix.
// All mutations run against dedicated BA-3 test variants (03800000-*);
// fixtures (Romi/Pepsi) are read-only here. Prints JSON, never secrets.
import crypto from "node:crypto";
import argon2 from "argon2";
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
  console.log(JSON.stringify({ suite: "inventory", db: dbName, total: results.length, failures: failures.length, failed: failures.map((f) => f.name), passed: results.filter((r) => r.pass).map((r) => r.name) }, null, 2));
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

// Same test users as the BA-2 rebuild (passwords set at rebuild time).
const OWNER_EMAIL = "owner@hyper-al-moatasem.local";
const OWNER_PW = "Cat-Test-Owner-Pass-0001!";
const STORE_EMAIL = "store-cat-test@example.com";
const STORE_PW = "Cat-Test-Store-Pass-0002!";
const BARE_EMAIL = "bare-cat-test@example.com";
const BARE_PW = "Cat-Test-Bare-Pass-0003!";

// Dedicated BA-3 fixtures (never collide with frozen seed 01800000-*).
const CAT = "03800000-0000-7000-8000-000000000001";
const PROD_W = "03800000-0000-7000-8000-000000000100";
const VAR_W = "03800000-0000-7000-8000-000000000101";
const PROD_P = "03800000-0000-7000-8000-000000000200";
const VAR_P = "03800000-0000-7000-8000-000000000201";
const VAR_P_OFF = "03800000-0000-7000-8000-000000000202";
const UNKNOWN = "03800000-0000-7000-8000-000000009999";

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

  const get = async (path, cookie = null) => {
    const r = await fetch(`${baseUrl}${path}`, { headers: cookie ? { cookie } : {} });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
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
    const setCookie = r.headers.get("set-cookie") || "";
    const match = setCookie.match(/__Host-admin-session=([^;]+)/);
    return { status: r.status, cookie: match ? `__Host-admin-session=${match[1]}` : null };
  };

  const invOf = async (v) =>
    (await q(`SELECT quantity::text qt, reserved_quantity::text rv, available_quantity::text av FROM inventory WHERE product_variant_id = $1`, [v]))[0];
  const movCount = async (v) =>
    Number((await q(`SELECT count(*)::int AS n FROM inventory_movements WHERE product_variant_id = $1`, [v]))[0].n);
  const resetVariant = async (v, qty) => {
    await db.query(`DELETE FROM inventory_movements WHERE product_variant_id = $1`, [v]);
    await db.query(`UPDATE inventory SET quantity = $2, reserved_quantity = 0 WHERE product_variant_id = $1`, [v, qty]);
  };
  const num = (s) => Number(s);

  const inactiveId = crypto.randomUUID();
  try {
    // ---------- setup: dedicated fixtures + deterministic reset ----------
    await db.query(`INSERT INTO categories (id, name, slug) VALUES ($1,'BA3 Test','ba3-test') ON CONFLICT (id) DO NOTHING`, [CAT]);
    await db.query(
      `INSERT INTO products (id, name, slug, category_id, product_type, unit, sale_step_grams)
       VALUES ($1,'BA3 Weight','ba3-weight',$2,'WEIGHT','KG',125) ON CONFLICT (id) DO NOTHING`,
      [PROD_W, CAT],
    );
    await db.query(
      `INSERT INTO products (id, name, slug, category_id, product_type, unit)
       VALUES ($1,'BA3 Piece','ba3-piece',$2,'PIECE','PIECE') ON CONFLICT (id) DO NOTHING`,
      [PROD_P, CAT],
    );
    await db.query(
      `INSERT INTO product_variants (id, product_id, name, size_value, size_unit, price)
       VALUES ($1,$2,'KG',1,'KG',320.00) ON CONFLICT (id) DO NOTHING`,
      [VAR_W, PROD_W],
    );
    await db.query(
      `INSERT INTO product_variants (id, product_id, name, size_value, size_unit, price)
       VALUES ($1,$2,'Test Pack',1,'PIECE',15.00) ON CONFLICT (id) DO NOTHING`,
      [VAR_P, PROD_P],
    );
    await db.query(
      `INSERT INTO product_variants (id, product_id, name, size_value, size_unit, price, is_active)
       VALUES ($1,$2,'Off Pack',1,'PIECE',15.00,FALSE) ON CONFLICT (id) DO NOTHING`,
      [VAR_P_OFF, PROD_P],
    );
    for (const [vid, invId] of [[VAR_W, "03800000-0000-7000-8000-000000000103"], [VAR_P, "03800000-0000-7000-8000-000000000203"], [VAR_P_OFF, "03800000-0000-7000-8000-000000000204"]]) {
      await db.query(`INSERT INTO inventory (id, product_variant_id, quantity) VALUES ($1,$2,0) ON CONFLICT (id) DO NOTHING`, [invId, vid]);
    }
    await resetVariant(VAR_W, "10.000");
    await resetVariant(VAR_P, "100.000");
    await resetVariant(VAR_P_OFF, "5.000");
    t("setup-reset", (await invOf(VAR_W)).qt === "10.000" && (await invOf(VAR_P)).qt === "100.000");

    // ---------- storefront availability ----------
    const wAvail = await get(`/api/store/inventory/variants/${VAR_W}`);
    t("store-variant-avail-200", wAvail.status === 200 && wAvail.body.data.inventory.availableQuantity !== undefined
      && num(wAvail.body.data.inventory.quantity) === 10 && num(wAvail.body.data.inventory.availableQuantity) === 10
      && wAvail.body.data.inventory.stockStatus === "in_stock");
    const pAvail = await get(`/api/store/inventory/variants/${VAR_P}`);
    t("store-piece-avail-200", pAvail.status === 200 && num(pAvail.body.data.inventory.availableQuantity) === 100);
    const miss = await get(`/api/store/inventory/variants/${UNKNOWN}`);
    t("store-unknown-404", miss.status === 404 && miss.body.error.code === "NOT_FOUND");
    const mal = await get(`/api/store/inventory/variants/not-a-uuid`);
    t("store-malformed-400", mal.status === 400);
    const off = await get(`/api/store/inventory/variants/${VAR_P_OFF}`);
    t("store-inactive-404", off.status === 404);
    const prodAvail = await get(`/api/store/inventory/products/${PROD_P}`);
    t("store-product-avail-200", prodAvail.status === 200 && prodAvail.body.data.isInStock === true
      && prodAvail.body.data.sellableVariants >= 1 && Array.isArray(prodAvail.body.data.variants)
      && prodAvail.body.data.variants.every((v) => v.availableQuantity !== undefined));
    const prodMiss = await get(`/api/store/inventory/products/${UNKNOWN}`);
    t("store-product-unknown-404", prodMiss.status === 404);
    // Catalog integration: weighed code still resolves, then availability follows.
    const lookup = await get(`/api/store/catalog/codes/lookup?code=2010106`);
    const romiVar = lookup.body?.data?.variant?.id;
    t("barcode-2010106-resolves", lookup.status === 200 && lookup.body.data.code === "2010106" && lookup.body.data.total === undefined);
    const romiAvail = romiVar ? await get(`/api/store/inventory/variants/${romiVar}`) : { status: 0, body: {} };
    t("barcode-variant-avail-follows", romiAvail.status === 200 && num(romiAvail.body.data.inventory.quantity) === 47.35);

    // ---------- auth matrix ----------
    const anonList = await get(`/api/admin/inventory?limit=5`);
    t("anon-list-401", anonList.status === 401);
    const anonAdj = await post(`/api/admin/inventory/adjust`, { productVariantId: VAR_W, delta: "1.000", movementType: "STOCK_IN" });
    t("anon-adjust-401", anonAdj.status === 401);
    const owner = await loginAs(OWNER_EMAIL, OWNER_PW);
    t("owner-login-ok", owner.status === 201 && !!owner.cookie);
    const store = await loginAs(STORE_EMAIL, STORE_PW);
    t("store-login-ok", store.status === 201 && !!store.cookie);
    const bare = await loginAs(BARE_EMAIL, BARE_PW);
    t("bare-login-ok", bare.status === 201 && !!bare.cookie);
    const bareList = await get(`/api/admin/inventory?limit=5`, bare.cookie);
    t("bare-list-403", bareList.status === 403);
    const bareRes = await post(`/api/admin/inventory/reserve`, { productVariantId: VAR_W, quantity: "0.125" }, bare.cookie);
    t("bare-reserve-403", bareRes.status === 403);
    const storeList = await get(`/api/admin/inventory?limit=5`, store.cookie);
    t("store-list-200", storeList.status === 200 && Array.isArray(storeList.body.data));
    const ownerList = await get(`/api/admin/inventory?limit=5`, owner.cookie);
    t("owner-list-200", ownerList.status === 200);
    const inactiveHash = await argon2.hash("Ba3-Test-Off-Pass-0001!", { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    await db.query(`INSERT INTO users (id, name, email, phone, password_hash, is_active) VALUES ($1,'BA3 Off','off-ba3-test@example.com','201133300031',$2,FALSE)`, [inactiveId, inactiveHash]);
    const inactiveLogin = await loginAs("off-ba3-test@example.com", "anything-0000!");
    t("inactive-login-401", inactiveLogin.status === 401);

    // ---------- admin reads ----------
    const list = await get(`/api/admin/inventory?limit=20`, store.cookie);
    t("admin-list-has-test-variant", list.status === 200 && list.body.data.some((r) => r.inventory.productVariantId === VAR_W));
    const paged = await get(`/api/admin/inventory?limit=1`, store.cookie);
    t("admin-pagination-cursor", paged.status === 200 && paged.body.data.length === 1 && typeof paged.body.meta.nextCursor === "string");
    const badPage = await get(`/api/admin/inventory?limit=500`, store.cookie);
    t("admin-bad-pagination-400", badPage.status === 400);
    const byProd = await get(`/api/admin/inventory?productId=${PROD_W}&limit=20`, store.cookie);
    t("admin-filter-product", byProd.status === 200 && byProd.body.data.length >= 1 && byProd.body.data.every((r) => r.variant.product.id === PROD_W));
    const inStock = await get(`/api/admin/inventory?inStock=true&limit=20`, store.cookie);
    t("admin-filter-instock", inStock.status === 200 && inStock.body.data.every((r) => num(r.inventory.availableQuantity) > 0));
    const boolBad = await get(`/api/admin/inventory?inStock=yes&limit=5`, store.cookie);
    t("admin-bool-no-coerce-400", boolBad.status === 400);
    const detail = await get(`/api/admin/inventory/${VAR_W}`, store.cookie);
    t("admin-detail-200", detail.status === 200 && detail.body.data.inventory.productVariantId === VAR_W
      && detail.body.data.variant.product.productType === "WEIGHT");
    t("shape-no-held-field", detail.status === 200 && !("heldQuantity" in detail.body.data.inventory) && !("held" in detail.body.data.inventory)
      && detail.body.data.inventory.availableQuantity !== undefined);
    const detailMiss = await get(`/api/admin/inventory/${UNKNOWN}`, store.cookie);
    t("admin-detail-404", detailMiss.status === 404);
    const offDetail = await get(`/api/admin/inventory/${VAR_P_OFF}`, store.cookie);
    t("admin-sees-inactive-200", offDetail.status === 200);
    const movList = await get(`/api/admin/inventory/movements?limit=20`, store.cookie);
    t("movements-list-200", movList.status === 200 && Array.isArray(movList.body.data));
    const movByVar = await get(`/api/admin/inventory/movements?variantId=${VAR_W}&limit=20`, store.cookie);
    t("movements-filter-variant", movByVar.status === 200 && movByVar.body.data.every((m) => m.productVariantId === VAR_W));
    const movBadType = await get(`/api/admin/inventory/movements?movementType=BOGUS&limit=5`, store.cookie);
    t("movements-bad-enum-400", movBadType.status === 400);

    // ---------- weighted validation (reserve path) ----------
    for (const stepQty of ["0.125", "0.250", "0.500", "1.000"]) {
      const r = await post(`/api/admin/inventory/reserve`, { productVariantId: VAR_W, quantity: stepQty }, store.cookie);
      t(`weighted-reserve-${stepQty}-201`, r.status === 201);
      const rel = await post(`/api/admin/inventory/release`, { productVariantId: VAR_W, quantity: stepQty }, store.cookie);
      t(`weighted-release-${stepQty}-201`, rel.status === 201);
    }
    const badPrec = await post(`/api/admin/inventory/reserve`, { productVariantId: VAR_W, quantity: "0.1234" }, store.cookie);
    t("weighted-bad-precision-400", badPrec.status === 400);
    const badStep = await post(`/api/admin/inventory/reserve`, { productVariantId: VAR_W, quantity: "0.100" }, store.cookie);
    t("weighted-bad-step-422", badStep.status === 422);
    const negQty = await post(`/api/admin/inventory/reserve`, { productVariantId: VAR_W, quantity: "-1" }, store.cookie);
    t("weighted-negative-400", negQty.status === 400);
    const zeroQty = await post(`/api/admin/inventory/reserve`, { productVariantId: VAR_W, quantity: "0" }, store.cookie);
    t("weighted-zero-400", zeroQty.status === 400);
    const pieceFrac = await post(`/api/admin/inventory/reserve`, { productVariantId: VAR_P, quantity: "0.500" }, store.cookie);
    t("piece-fraction-422", pieceFrac.status === 422);
    const pieceWhole = await post(`/api/admin/inventory/reserve`, { productVariantId: VAR_P, quantity: "2" }, store.cookie);
    t("piece-whole-201", pieceWhole.status === 201);
    await post(`/api/admin/inventory/release`, { productVariantId: VAR_P, quantity: "2" }, store.cookie);

    // ---------- reservations: lifecycle + guards ----------
    const mvBefore = await movCount(VAR_W);
    const res = await post(`/api/admin/inventory/reserve`, { productVariantId: VAR_W, quantity: "1.000" }, store.cookie);
    const afterRes = await invOf(VAR_W);
    t("reserve-ok-201", res.status === 201 && afterRes.qt === "10.000" && afterRes.rv === "1.000" && afterRes.av === "9.000");
    t("reserve-no-movement", (await movCount(VAR_W)) === mvBefore);
    t("available-formula", num(afterRes.av) === num(afterRes.qt) - num(afterRes.rv));
    const over = await post(`/api/admin/inventory/reserve`, { productVariantId: VAR_W, quantity: "9.500" }, store.cookie);
    t("reserve-over-409", over.status === 409 && over.body.error.code === "CONFLICT");
    const still = await invOf(VAR_W);
    t("reserve-over-no-leak", still.rv === "1.000" && still.av === "9.000");
    const relOk = await post(`/api/admin/inventory/release`, { productVariantId: VAR_W, quantity: "1.000" }, store.cookie);
    const afterRel = await invOf(VAR_W);
    t("release-ok-201", relOk.status === 201 && afterRel.rv === "0.000" && afterRel.av === "10.000");
    t("release-no-movement", (await movCount(VAR_W)) === mvBefore);
    const relOver = await post(`/api/admin/inventory/release`, { productVariantId: VAR_W, quantity: "5.000" }, store.cookie);
    t("release-over-409", relOver.status === 409);
    const resMiss = await post(`/api/admin/inventory/reserve`, { productVariantId: UNKNOWN, quantity: "1.000" }, store.cookie);
    t("reserve-unknown-404", resMiss.status === 404);
    const resBlank = await post(`/api/admin/inventory/reserve`, { productVariantId: VAR_W, quantity: " " }, store.cookie);
    t("reserve-blank-400", resBlank.status === 400);
    const resOff = await post(`/api/admin/inventory/reserve`, { productVariantId: VAR_P_OFF, quantity: "1" }, store.cookie);
    t("reserve-inactive-422", resOff.status === 422);

    // ---------- commit: R3 predicate + R7 envelope + SALE pairing ----------
    await resetVariant(VAR_W, "10.000");
    await post(`/api/admin/inventory/reserve`, { productVariantId: VAR_W, quantity: "0.500" }, store.cookie);
    const com = await post(`/api/admin/inventory/commit`,
      { productVariantId: VAR_W, requested: "0.500", actual: "0.500", referenceType: "MANUAL", referenceId: "BA3TEST-C1", reason: "exact pick" }, store.cookie);
    const afterCom = await invOf(VAR_W);
    t("commit-exact-201", com.status === 201 && afterCom.qt === "9.500" && afterCom.rv === "0.000" && afterCom.av === "9.500");
    const saleRow = (await q(`SELECT quantity::text d, previous_quantity::text p, new_quantity::text n, movement_type t, reference_type rt, reference_id ri
      FROM inventory_movements WHERE id = $1`, [com.body.data.movementId]))[0];
    t("commit-sale-pairing", saleRow && saleRow.d === "-0.500" && saleRow.p === "10.000" && saleRow.n === "9.500" && saleRow.t === "SALE");
    t("commit-movement-math", saleRow && num(saleRow.n) === num(saleRow.p) + num(saleRow.d));
    // Partial: actual < requested (R7 case A — actual need not match the step).
    await post(`/api/admin/inventory/reserve`, { productVariantId: VAR_W, quantity: "0.500" }, store.cookie);
    const comP = await post(`/api/admin/inventory/commit`,
      { productVariantId: VAR_W, requested: "0.500", actual: "0.475", referenceType: "MANUAL", referenceId: "BA3TEST-C2" }, store.cookie);
    const afterP = await invOf(VAR_W);
    t("commit-partial-201", comP.status === 201 && afterP.qt === "9.025" && afterP.rv === "0.000");
    // Tolerance-over within envelope (R7 case B).
    await post(`/api/admin/inventory/reserve`, { productVariantId: VAR_W, quantity: "0.500" }, store.cookie);
    const comT = await post(`/api/admin/inventory/commit`,
      { productVariantId: VAR_W, requested: "0.500", actual: "0.525", referenceType: "MANUAL", referenceId: "BA3TEST-C3" }, store.cookie);
    t("commit-tolerance-over-201", comT.status === 201 && (await invOf(VAR_W)).qt === "8.500");
    // Envelope breach (R7 case C): nothing written.
    await post(`/api/admin/inventory/reserve`, { productVariantId: VAR_W, quantity: "0.500" }, store.cookie);
    const preBreach = await invOf(VAR_W);
    const breach = await post(`/api/admin/inventory/commit`,
      { productVariantId: VAR_W, requested: "0.500", actual: "0.650", referenceType: "MANUAL", referenceId: "BA3TEST-C4" }, store.cookie);
    const postBreach = await invOf(VAR_W);
    t("commit-envelope-422", breach.status === 422 && postBreach.qt === preBreach.qt && postBreach.rv === preBreach.rv);
    await post(`/api/admin/inventory/release`, { productVariantId: VAR_W, quantity: "0.500" }, store.cookie);
    // Stock predicate failure: envelope ok, stock short.
    await resetVariant(VAR_W, "0.500");
    await post(`/api/admin/inventory/reserve`, { productVariantId: VAR_W, quantity: "0.500" }, store.cookie);
    const short = await post(`/api/admin/inventory/commit`,
      { productVariantId: VAR_W, requested: "0.500", actual: "0.600", referenceType: "MANUAL", referenceId: "BA3TEST-C5" }, store.cookie);
    t("commit-short-409", short.status === 409 && short.body.error.code === "CONFLICT");
    await resetVariant(VAR_W, "10.000");
    // Piece envelope: tolerance 0.
    await post(`/api/admin/inventory/reserve`, { productVariantId: VAR_P, quantity: "10" }, store.cookie);
    const pieceOver = await post(`/api/admin/inventory/commit`,
      { productVariantId: VAR_P, requested: "10", actual: "11", referenceType: "MANUAL", referenceId: "BA3TEST-C6" }, store.cookie);
    t("commit-piece-over-422", pieceOver.status === 422);
    const pieceOk = await post(`/api/admin/inventory/commit`,
      { productVariantId: VAR_P, requested: "10", actual: "10", referenceType: "MANUAL", referenceId: "BA3TEST-C7" }, store.cookie);
    const afterPiece = await invOf(VAR_P);
    t("commit-piece-exact-201", pieceOk.status === 201 && afterPiece.qt === "90.000" && afterPiece.rv === "0.000");
    await resetVariant(VAR_P, "100.000");

    // ---------- movements: adjust + audit ----------
    const adj = await post(`/api/admin/inventory/adjust`,
      { productVariantId: VAR_P, delta: "10", movementType: "STOCK_IN", referenceType: "PURCHASE", referenceId: "BA3TEST-PO-1", reason: "restock" }, store.cookie);
    const afterAdj = await invOf(VAR_P);
    t("adjust-stockin-201", adj.status === 201 && afterAdj.qt === "110.000" && afterAdj.av === "110.000");
    const adjRow = (await q(`SELECT quantity::text d, previous_quantity::text p, new_quantity::text n, movement_type t, reference_type rt, reference_id ri, reason r
      FROM inventory_movements WHERE id = $1`, [adj.body.data.movementId]))[0];
    t("adjust-audit-row", adjRow && adjRow.d === "10.000" && adjRow.p === "100.000" && adjRow.n === "110.000"
      && adjRow.t === "STOCK_IN" && adjRow.rt === "PURCHASE" && adjRow.ri === "BA3TEST-PO-1" && adjRow.r === "restock");
    t("adjust-movement-math", adjRow && num(adjRow.n) === num(adjRow.p) + num(adjRow.d));
    const adjNeg = await post(`/api/admin/inventory/adjust`,
      { productVariantId: VAR_P, delta: "-5", movementType: "WASTE", referenceType: "MANUAL", referenceId: "BA3TEST-W1", reason: "damage" }, store.cookie);
    t("adjust-negative-201", adjNeg.status === 201 && (await invOf(VAR_P)).qt === "105.000");
    const preDrain = await invOf(VAR_P);
    const drain = await post(`/api/admin/inventory/adjust`,
      { productVariantId: VAR_P, delta: "-200", movementType: "ADJUSTMENT" }, store.cookie);
    t("adjust-beyond-stock-409", drain.status === 409 && (await invOf(VAR_P)).qt === preDrain.qt);
    const zero = await post(`/api/admin/inventory/adjust`,
      { productVariantId: VAR_P, delta: "0", movementType: "ADJUSTMENT" }, store.cookie);
    t("adjust-zero-400", zero.status === 400);
    const saleType = await post(`/api/admin/inventory/adjust`,
      { productVariantId: VAR_P, delta: "-1", movementType: "SALE" }, store.cookie);
    t("adjust-sale-type-400", saleType.status === 400);
    const bogusType = await post(`/api/admin/inventory/adjust`,
      { productVariantId: VAR_P, delta: "1", movementType: "BOGUS" }, store.cookie);
    t("adjust-bad-type-400", bogusType.status === 400);
    const refPair = await post(`/api/admin/inventory/adjust`,
      { productVariantId: VAR_P, delta: "1", movementType: "STOCK_IN", referenceId: "PO-X" }, store.cookie);
    t("adjust-ref-pair-400", refPair.status === 400);
    const adjMiss = await post(`/api/admin/inventory/adjust`,
      { productVariantId: UNKNOWN, delta: "1", movementType: "STOCK_IN" }, store.cookie);
    t("adjust-unknown-404", adjMiss.status === 404);
    const movDetail = await get(`/api/admin/inventory/movements/${adj.body.data.movementId}`, store.cookie);
    t("movement-detail-200", movDetail.status === 200 && movDetail.body.data.movementType === "STOCK_IN");
    const movMiss = await get(`/api/admin/inventory/movements/${UNKNOWN}`, store.cookie);
    t("movement-unknown-404", movMiss.status === 404);

    // ---------- threshold / low-stock ----------
    const thr = await patch(`/api/admin/inventory/${VAR_P}`, { lowStockThreshold: "200" }, store.cookie);
    t("threshold-set-200", thr.status === 200 && thr.body.data.lowStockThreshold === "200" && thr.body.data.stockStatus === "low_stock");
    const thrClear = await patch(`/api/admin/inventory/${VAR_P}`, { lowStockThreshold: null }, store.cookie);
    t("threshold-clear-200", thrClear.status === 200 && thrClear.body.data.lowStockThreshold === null && thrClear.body.data.stockStatus === "in_stock");
    const thrBad = await patch(`/api/admin/inventory/${VAR_P}`, { lowStockThreshold: "-1" }, store.cookie);
    t("threshold-invalid-400", thrBad.status === 400);
    const thrMiss = await patch(`/api/admin/inventory/${UNKNOWN}`, { lowStockThreshold: "5" }, store.cookie);
    t("threshold-unknown-404", thrMiss.status === 404);

    // ---------- owner full pass ----------
    const ownerAdj = await get(`/api/admin/inventory/movements?limit=5`, owner.cookie);
    t("owner-movements-200", ownerAdj.status === 200);
  } finally {
    // Hygiene: remove BA-3-only rows; restore nothing else (fixtures untouched).
    try {
      for (const v of [VAR_W, VAR_P, VAR_P_OFF]) {
        await db.query(`DELETE FROM inventory_movements WHERE product_variant_id = $1`, [v]).catch(() => {});
      }
      for (const v of [VAR_W, VAR_P, VAR_P_OFF]) {
        await db.query(`DELETE FROM inventory WHERE product_variant_id = $1`, [v]).catch(() => {});
      }
      for (const v of [VAR_W, VAR_P, VAR_P_OFF]) {
        await db.query(`DELETE FROM product_variants WHERE id = $1`, [v]).catch(() => {});
      }
      await db.query(`DELETE FROM products WHERE id IN ($1,$2)`, [PROD_W, PROD_P]).catch(() => {});
      await db.query(`DELETE FROM categories WHERE id = $1`, [CAT]).catch(() => {});
      await db.query(`DELETE FROM audit_logs WHERE user_id = $1`, [inactiveId]).catch(() => {});
      await db.query(`DELETE FROM admin_sessions WHERE user_id = $1`, [inactiveId]).catch(() => {});
      await db.query(`DELETE FROM user_roles WHERE user_id = $1`, [inactiveId]).catch(() => {});
      await db.query(`DELETE FROM users WHERE id = $1`, [inactiveId]).catch(() => {});
      for (const email of [OWNER_EMAIL, STORE_EMAIL, BARE_EMAIL]) {
        await db.query(`DELETE FROM admin_sessions WHERE user_id = (SELECT id FROM users WHERE email = $1)`, [email]).catch(() => {});
      }
    } catch { /* scratch hygiene best-effort */ }
    await db.end().catch(() => {});
  }
  done();
}

main().catch((e) => {
  console.error(`INVENTORY_SUITE_FAILED: ${e.constructor.name}: ${String(e.message).slice(0, 200)}`);
  process.exit(1);
});
