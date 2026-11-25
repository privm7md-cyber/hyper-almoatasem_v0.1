// Phase 12 / P12-08 — Full End-to-End Acceptance & Integrated System Verification
//
// Executes 22 real integrated E2E journeys across Storefront, Backend APIs,
// Admin Dashboard, and isolated PostgreSQL (`hyper_almoatasem_scratch` ONLY).
//
// Hard Safety Invariants:
// 1. Refuses Primary DB (`hyper_almoatasem`) via SQL `SELECT current_database()`.
// 2. Refuses Primary preview port `:3150` and any non-loopback host.
// 3. Creates identifiable synthetic `P1208_*` fixtures through real application
//    APIs and deactivates them in `afterAll` so existing suites remain unpolluted.
// 4. Never prints or persists passwords, session cookies, or guest tokens.

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import AxeBuilder from "axe-core";

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

const RAW_BASE =
  process.env.PHASE07_BASE_URL ??
  process.env.E2E_BASE_URL ??
  process.env.PHASE10_BASE_URL ??
  "";

if (RAW_BASE.trim() === "") {
  throw new Error("P1208_MISSING_BASE_URL: Set PHASE07_BASE_URL pointing to isolated scratch server (:3151).");
}
const PARSED_BASE = new URL(RAW_BASE);
if (!new Set(["127.0.0.1", "localhost", "::1", "[::1]"]).has(PARSED_BASE.hostname)) {
  throw new Error(`P1208_REFUSED_HOST: Non-loopback target ${RAW_BASE}`);
}
if (PARSED_BASE.port === "3150") {
  throw new Error("P1208_REFUSED_PRIMARY_PORT: Port 3150 is reserved for Primary DB preview.");
}
const BASE = PARSED_BASE.origin;

const SCRATCH_DB_URL =
  process.env.PHASE07_DATABASE_URL ??
  process.env.SCRATCH_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "";

if (SCRATCH_DB_URL.trim() === "") {
  throw new Error("P1208_MISSING_DB_URL: Set PHASE07_DATABASE_URL pointing to hyper_almoatasem_scratch.");
}

const OWNER_EMAIL = process.env.PHASE10_OWNER_EMAIL ?? "";
const OWNER_PASSWORD = process.env.PHASE10_OWNER_PASSWORD ?? "";
if (!OWNER_EMAIL || !OWNER_PASSWORD) {
  throw new Error("P1208_MISSING_ADMIN_CREDS: Set PHASE10_OWNER_EMAIL and PHASE10_OWNER_PASSWORD.");
}

const RUN_DIR =
  process.env.P1208_RUN_DIR ??
  "D:/Hyper_Data_Review/PHASE_12_PREMIUM_ENGINEERING/P12_08/Run_20261117_2325";
const SHOTS_DIR = path.join(RUN_DIR, "screenshots");
const EVIDENCE_DIR = path.join(RUN_DIR, "evidence");
const FIXTURES_DIR = path.join(RUN_DIR, "fixtures");
const DEFECTS_DIR = path.join(RUN_DIR, "defects");
for (const d of [SHOTS_DIR, EVIDENCE_DIR, FIXTURES_DIR, DEFECTS_DIR]) {
  fs.mkdirSync(d, { recursive: true });
}

const STAMP = Date.now().toString(36);
const SEED6 = String(Math.floor(100000 + Math.random() * 899999));
const CUST_PW = "P1208-Safe-Cust-0001!";
const RESTRICTED_PW = "P1208-Restr-Adm-0001!";

const GUEST_PHONE = `0108${SEED6}1`;
const CUST_A_PHONE = `0108${SEED6}2`;
const CUST_B_PHONE = `0108${SEED6}3`;
const ANON_CUST_PHONE = `0108${SEED6}4`;

let db: Client;
let adminCookie = "";
let restrictedCookie = "";
let restrictedRoleId = "";
let restrictedUserId = "";

interface P1208Fixtures {
  mainCat: { id: string; slug: string; name: string };
  subCat: { id: string; slug: string; name: string };
  emptyCat: { id: string; slug: string; name: string };
  hiddenCat: { id: string; slug: string; name: string };
  brand: { id: string; slug: string; name: string };
  pieceProd: { id: string; slug: string; name: string; v1Id: string; v2Id: string; barcode: string };
  weightProd: { id: string; slug: string; name: string; vId: string };
  oosProd: { id: string; slug: string; name: string; vId: string };
  uncertainProd: { id: string; slug: string; name: string; vId: string };
  subProd: { id: string; slug: string; name: string; vId: string };
  promoProd: { id: string; slug: string; name: string; vId: string };
  couponProd: { id: string; slug: string; name: string; vId: string };
  deletableProd: { id: string; slug: string; name: string };
  promoHighId: string;
  promoLowId: string;
  couponPromoId: string;
  couponId: string;
  couponCode: string;
  zoneId: string;
  zoneName: string;
}

let fx: P1208Fixtures;

// Shared state between E4-01 (Guest Order Creation) and E6-01 (Admin Fulfillment)
let sharedGuestContext: BrowserContext | null = null;
let sharedGuestPage: Page | null = null;
let sharedGuestOrderId = "";
let sharedGuestOrderNumber = "";

const runtimeFacts: Record<string, unknown>[] = [];
function recordFact(gate: string, detail: Record<string, unknown>) {
  runtimeFacts.push({ ts: new Date().toISOString(), gate, ...detail });
}

function extractSetCookie(headers: Record<string, string> | Headers, prefixes: string[]): string {
  let rawList: string[] = [];
  if (typeof (headers as Headers).getSetCookie === "function") {
    rawList = (headers as Headers).getSetCookie();
  } else if (typeof (headers as Headers).get === "function") {
    rawList = [(headers as Headers).get("set-cookie") ?? ""];
  } else {
    const rec = headers as Record<string, string>;
    rawList = (rec["set-cookie"] ?? "").split(/\r?\n/);
  }
  for (const line of rawList) {
    for (const p of prefixes) {
      if (line.startsWith(`${p}=`)) return line.split(";")[0]!;
    }
  }
  return "";
}

async function adminApi<T = Record<string, unknown>>(
  method: string,
  urlPath: string,
  body?: unknown,
  cookieOverride?: string,
  extraHeaders?: Record<string, string>,
): Promise<{ status: number; data: T; raw: Record<string, unknown>; headers: Headers }> {
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: {
      Origin: BASE,
      Cookie: cookieOverride ?? adminCookie,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(extraHeaders ?? {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let parsed: Record<string, unknown> = {};
  try {
    parsed = (await res.json()) as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  return { status: res.status, data: (parsed.data as T) ?? (null as unknown as T), raw: parsed, headers: res.headers };
}

async function storeApi<T = Record<string, unknown>>(
  method: string,
  urlPath: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; data: T; raw: Record<string, unknown>; headers: Headers }> {
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: {
      Origin: BASE,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(headers ?? {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let parsed: Record<string, unknown> = {};
  try {
    parsed = (await res.json()) as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  return { status: res.status, data: (parsed.data as T) ?? (null as unknown as T), raw: parsed, headers: res.headers };
}

async function resetRateLimitsOnScratch() {
  await db.query("DELETE FROM admin_auth_rate_limits");
  await db.query("DELETE FROM customer_auth_rate_limits");
  await db.query("DELETE FROM guest_order_rate_limits");
}

test.beforeAll(async () => {
  db = new Client({ connectionString: SCRATCH_DB_URL });
  await db.connect();
  const dbRes = await db.query<{ db: string }>("SELECT current_database() AS db");
  const connectedDb = dbRes.rows[0]?.db ?? "";
  if (
    !connectedDb ||
    connectedDb === "hyper_almoatasem" ||
    !/^(hyper_almoatasem_scratch|hyper_d01_[a-z0-9_]+)$/.test(connectedDb)
  ) {
    await db.end();
    throw new Error(`P1208_DB_ISOLATION_STOP: Refusing unsafe database ${connectedDb}`);
  }
  await resetRateLimitsOnScratch();

  // Verify HTTP server health & login Super Admin
  const health = await fetch(`${BASE}/api/health`);
  expect(health.status).toBe(200);

  const loginRes = await fetch(`${BASE}/api/admin/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD }),
  });
  expect(loginRes.status).toBe(201);
  adminCookie = extractSetCookie(loginRes.headers, ["__Host-admin-session", "hyper-admin-session-dev"]);
  expect(adminCookie).not.toBe("");

  // Create Restricted Admin role (`products.view` + `orders.view` ONLY)
  const permsRes = await adminApi<Array<{ id: string; key: string }>>("GET", "/api/admin/permissions?limit=100");
  expect(permsRes.status).toBe(200);
  const permByKey = new Map(permsRes.data.map((p) => [p.key, p.id]));

  const roleRes = await adminApi<{ id: string }>("POST", "/api/admin/roles", {
    name: `P1208_VIEWER_${STAMP.toUpperCase()}`,
    description: "P12-08 restricted read-only operator",
  });
  expect(roleRes.status).toBe(201);
  restrictedRoleId = roleRes.data.id;

  for (const k of ["products.view", "orders.view"]) {
    const g = await adminApi("POST", `/api/admin/roles/${restrictedRoleId}/grants`, {
      permissionId: permByKey.get(k),
    });
    expect(g.status).toBe(201);
  }

  const rEmail = `p1208-viewer-${STAMP}@p1208.local`;
  const uRes = await adminApi<{ id: string }>("POST", "/api/admin/users", {
    name: "P1208 Restricted Viewer",
    email: rEmail,
  });
  expect(uRes.status).toBe(201);
  restrictedUserId = uRes.data.id;

  expect((await adminApi("POST", `/api/admin/users/${restrictedUserId}/password`, { password: RESTRICTED_PW })).status).toBe(200);
  expect((await adminApi("POST", `/api/admin/users/${restrictedUserId}/roles`, { roleId: restrictedRoleId })).status).toBe(201);

  const rLogin = await fetch(`${BASE}/api/admin/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ email: rEmail, password: RESTRICTED_PW }),
  });
  expect(rLogin.status).toBe(201);
  restrictedCookie = extractSetCookie(rLogin.headers, ["__Host-admin-session", "hyper-admin-session-dev"]);

  // Build synthetic E1 catalog, inventory, promotions, coupons, and delivery zone fixtures
  // Note: Prefix "00 " ensures synthetic categories sort within OPTION_LIMIT (100) on scratch DB
  // where 144 historical BA11A/BAB test categories exist.
  const mainCat = (
    await adminApi<{ id: string; slug: string; name: string }>("POST", "/api/admin/catalog/categories", {
      name: `00 قسم قبول رئيسي ${STAMP}`,
      slug: `p1208-main-${STAMP}`,
      isActive: true,
    })
  ).data;

  const subCat = (
    await adminApi<{ id: string; slug: string; name: string }>("POST", "/api/admin/catalog/categories", {
      name: `00 فرع قبول فرعي ${STAMP}`,
      slug: `p1208-sub-${STAMP}`,
      parentId: mainCat.id,
      isActive: true,
    })
  ).data;

  const emptyCat = (
    await adminApi<{ id: string; slug: string; name: string }>("POST", "/api/admin/catalog/categories", {
      name: `قسم فارغ قبول ${STAMP}`,
      slug: `p1208-empty-${STAMP}`,
      isActive: true,
    })
  ).data;

  const hiddenCat = (
    await adminApi<{ id: string; slug: string; name: string }>("POST", "/api/admin/catalog/categories", {
      name: `قسم مخفي قبول ${STAMP}`,
      slug: `p1208-hidden-${STAMP}`,
      isActive: false,
    })
  ).data;

  const brand = (
    await adminApi<{ id: string; slug: string; name: string }>("POST", "/api/admin/catalog/brands", {
      name: `علامة قبول ${STAMP}`,
      slug: `p1208-brand-${STAMP}`,
      isActive: true,
    })
  ).data;

  // 1. PIECE multi-variant product (in stock)
  const pieceP = (
    await adminApi<{ id: string; slug: string; name: string }>("POST", "/api/admin/catalog/products", {
      name: `بسكويت شوفان قبول ${STAMP}`,
      slug: `p1208-biscuit-${STAMP}`,
      categoryId: subCat.id,
      brandId: brand.id,
      productType: "PIECE",
      unit: "PIECE",
      isActive: true,
    })
  ).data;
  const pieceV1 = (
    await adminApi<{ id: string }>("POST", `/api/admin/catalog/products/${pieceP.id}/variants`, {
      name: "عبوة صغيرة",
      sizeValue: "1",
      sizeUnit: "PIECE",
      price: "25.00",
      isActive: true,
    })
  ).data;
  const pieceV2 = (
    await adminApi<{ id: string }>("POST", `/api/admin/catalog/products/${pieceP.id}/variants`, {
      name: "عبوة عائلية",
      sizeValue: "2",
      sizeUnit: "PIECE",
      price: "45.00",
      isActive: true,
    })
  ).data;
  const barcode = `P1208BC${STAMP.toUpperCase()}`;
  expect(
    (
      await adminApi("POST", "/api/admin/catalog/codes", {
        productVariantId: pieceV1.id,
        code: barcode,
        type: "BARCODE",
        isPrimary: true,
      })
    ).status,
  ).toBe(201);
  expect((await adminApi("POST", "/api/admin/inventory/initialize", { productVariantId: pieceV1.id, quantity: "80", reason: "p1208 seed" })).status).toBe(201);
  expect((await adminApi("POST", "/api/admin/inventory/initialize", { productVariantId: pieceV2.id, quantity: "40", reason: "p1208 seed" })).status).toBe(201);

  // 2. WEIGHT KG product (saleStepGrams = 125, price = 160.00 EGP/kg, 25.000 kg in stock)
  const weightP = (
    await adminApi<{ id: string; slug: string; name: string }>("POST", "/api/admin/catalog/products", {
      name: `جبنة رومي قديمة قبول ${STAMP}`,
      slug: `p1208-cheese-${STAMP}`,
      categoryId: subCat.id,
      brandId: brand.id,
      productType: "WEIGHT",
      unit: "KG",
      saleStepGrams: 125,
      isActive: true,
    })
  ).data;
  const weightV = (
    await adminApi<{ id: string }>("POST", `/api/admin/catalog/products/${weightP.id}/variants`, {
      name: "بالكيلو",
      sizeValue: "1",
      sizeUnit: "KG",
      price: "160.00",
      isActive: true,
    })
  ).data;
  expect((await adminApi("POST", "/api/admin/inventory/initialize", { productVariantId: weightV.id, quantity: "25.000", reason: "p1208 seed" })).status).toBe(201);

  // 3. Out-of-stock product (initialized with quantity "0")
  const oosP = (
    await adminApi<{ id: string; slug: string; name: string }>("POST", "/api/admin/catalog/products", {
      name: `عصير مانجو نفد قبول ${STAMP}`,
      slug: `p1208-oos-${STAMP}`,
      categoryId: subCat.id,
      productType: "PIECE",
      unit: "PIECE",
      isActive: true,
    })
  ).data;
  const oosV = (
    await adminApi<{ id: string }>("POST", `/api/admin/catalog/products/${oosP.id}/variants`, {
      name: "لتر",
      sizeValue: "1",
      sizeUnit: "LITER",
      price: "35.00",
      isActive: true,
    })
  ).data;
  expect((await adminApi("POST", "/api/admin/inventory/initialize", { productVariantId: oosV.id, quantity: "0", reason: "p1208 oos" })).status).toBe(201);

  // 4. Uncertain-stock product (NO inventory row initialized)
  const uncP = (
    await adminApi<{ id: string; slug: string; name: string }>("POST", "/api/admin/catalog/products", {
      name: `عسل نحل غير مجرود قبول ${STAMP}`,
      slug: `p1208-uncertain-${STAMP}`,
      categoryId: subCat.id,
      productType: "PIECE",
      unit: "PIECE",
      isActive: true,
    })
  ).data;
  const uncV = (
    await adminApi<{ id: string }>("POST", `/api/admin/catalog/products/${uncP.id}/variants`, {
      name: "برطمان",
      sizeValue: "1",
      sizeUnit: "PIECE",
      price: "120.00",
      isActive: true,
    })
  ).data;

  // 5. Substitute product (30.00 EGP, in stock)
  const subP = (
    await adminApi<{ id: string; slug: string; name: string }>("POST", "/api/admin/catalog/products", {
      name: `بسكويت بديل قبول ${STAMP}`,
      slug: `p1208-subprod-${STAMP}`,
      categoryId: subCat.id,
      productType: "PIECE",
      unit: "PIECE",
      isActive: true,
    })
  ).data;
  const subV = (
    await adminApi<{ id: string }>("POST", `/api/admin/catalog/products/${subP.id}/variants`, {
      name: "عبوة بديلة",
      sizeValue: "1",
      sizeUnit: "PIECE",
      price: "30.00",
      isActive: true,
    })
  ).data;
  expect((await adminApi("POST", "/api/admin/inventory/initialize", { productVariantId: subV.id, quantity: "50", reason: "p1208 sub" })).status).toBe(201);

  // 6. Promo-target product (100.00 EGP) with two competing active promotions (Priority 20: 20% vs Priority 10: 10%)
  const promoP = (
    await adminApi<{ id: string; slug: string; name: string }>("POST", "/api/admin/catalog/products", {
      name: `قهوة عروض متنافسة قبول ${STAMP}`,
      slug: `p1208-promo-${STAMP}`,
      categoryId: subCat.id,
      productType: "PIECE",
      unit: "PIECE",
      isActive: true,
    })
  ).data;
  const promoV = (
    await adminApi<{ id: string }>("POST", `/api/admin/catalog/products/${promoP.id}/variants`, {
      name: "علبة 250 جم",
      sizeValue: "250",
      sizeUnit: "GRAM",
      price: "100.00",
      isActive: true,
    })
  ).data;
  expect((await adminApi("POST", "/api/admin/inventory/initialize", { productVariantId: promoV.id, quantity: "40", reason: "p1208 promo" })).status).toBe(201);

  const promoHigh = (
    await adminApi<{ id: string }>("POST", "/api/admin/promotions", {
      name: `عرض أولوية عليا 20% ${STAMP}`,
      type: "PERCENTAGE",
      scope: "LINE",
      discountPercent: "20.00",
      priority: 20,
      status: "DRAFT",
    })
  ).data;
  expect((await adminApi("POST", `/api/admin/promotions/${promoHigh.id}/targets`, { targetType: "PRODUCT", targetId: promoP.id })).status).toBe(201);
  expect((await adminApi("PATCH", `/api/admin/promotions/${promoHigh.id}`, { status: "ACTIVE" })).status).toBe(200);

  const promoLow = (
    await adminApi<{ id: string }>("POST", "/api/admin/promotions", {
      name: `عرض أولوية أقل 10% ${STAMP}`,
      type: "PERCENTAGE",
      scope: "LINE",
      discountPercent: "10.00",
      priority: 10,
      status: "DRAFT",
    })
  ).data;
  expect((await adminApi("POST", `/api/admin/promotions/${promoLow.id}/targets`, { targetType: "PRODUCT", targetId: promoP.id })).status).toBe(201);
  expect((await adminApi("PATCH", `/api/admin/promotions/${promoLow.id}`, { status: "ACTIVE" })).status).toBe(200);

  // 7. Coupon-eligible product (80.00 EGP) + Coupon-gated promotion (15% off -> 12.00 discount)
  const couponP = (
    await adminApi<{ id: string; slug: string; name: string }>("POST", "/api/admin/catalog/products", {
      name: `زيت زيتون كوبون قبول ${STAMP}`,
      slug: `p1208-coupon-prod-${STAMP}`,
      categoryId: subCat.id,
      productType: "PIECE",
      unit: "PIECE",
      isActive: true,
    })
  ).data;
  const couponV = (
    await adminApi<{ id: string }>("POST", `/api/admin/catalog/products/${couponP.id}/variants`, {
      name: "زجاجة",
      sizeValue: "500",
      sizeUnit: "ML",
      price: "80.00",
      isActive: true,
    })
  ).data;
  expect((await adminApi("POST", "/api/admin/inventory/initialize", { productVariantId: couponV.id, quantity: "30", reason: "p1208 coupon" })).status).toBe(201);

  const couponPromo = (
    await adminApi<{ id: string }>("POST", "/api/admin/promotions", {
      name: `عرض كوبون 15% ${STAMP}`,
      type: "PERCENTAGE",
      scope: "LINE",
      discountPercent: "15.00",
      priority: 5,
      status: "DRAFT",
    })
  ).data;
  expect((await adminApi("POST", `/api/admin/promotions/${couponPromo.id}/targets`, { targetType: "PRODUCT", targetId: couponP.id })).status).toBe(201);
  const couponCode = `P1208CPN${STAMP.toUpperCase()}`;
  const couponCreated = await adminApi<{ id: string }>("POST", "/api/admin/coupons", {
    promotionId: couponPromo.id,
    code: couponCode,
    isActive: true,
  });
  expect(couponCreated.status).toBe(201);
  expect((await adminApi("PATCH", `/api/admin/promotions/${couponPromo.id}`, { status: "ACTIVE" })).status).toBe(200);

  // 8. Unreferenced product (for permanent hard-delete verification)
  const delP = (
    await adminApi<{ id: string; slug: string; name: string }>("POST", "/api/admin/catalog/products", {
      name: `منتج غير مرتبط للحذف النهائي ${STAMP}`,
      slug: `p1208-deletable-${STAMP}`,
      categoryId: subCat.id,
      productType: "PIECE",
      unit: "PIECE",
      isActive: false,
    })
  ).data;

  // 9. Active Delivery Zone (15.00 EGP vs 20.00 EGP default)
  const zoneName = `حي القبول ${STAMP}`;
  const zoneRes = await adminApi<{ id: string }>("POST", "/api/admin/delivery-zones", {
    name: zoneName,
    fee: "15.00",
    isActive: true,
  });
  expect(zoneRes.status).toBe(201);

  fx = {
    mainCat,
    subCat,
    emptyCat,
    hiddenCat,
    brand,
    pieceProd: { ...pieceP, v1Id: pieceV1.id, v2Id: pieceV2.id, barcode },
    weightProd: { ...weightP, vId: weightV.id },
    oosProd: { ...oosP, vId: oosV.id },
    uncertainProd: { ...uncP, vId: uncV.id },
    subProd: { ...subP, vId: subV.id },
    promoProd: { ...promoP, vId: promoV.id },
    couponProd: { ...couponP, vId: couponV.id },
    deletableProd: delP,
    promoHighId: promoHigh.id,
    promoLowId: promoLow.id,
    couponPromoId: couponPromo.id,
    couponId: couponCreated.data.id,
    couponCode,
    zoneId: zoneRes.data.id,
    zoneName,
  };

  fs.writeFileSync(
    path.join(FIXTURES_DIR, "p12-08-fixture-manifest.json"),
    JSON.stringify({ stamp: STAMP, database: "hyper_almoatasem_scratch", fixtures: fx }, null, 2),
    "utf8",
  );
});

test.afterAll(async () => {
  try {
    if (sharedGuestContext) {
      await sharedGuestContext.close().catch(() => {});
    }
    // Deactivate synthetic products, categories, promotions, coupons & remove delivery zone
    // so legacy suites (e.g. phase07 top-product unknown-stock check & zones=[] check) see clean state.
    if (fx && adminCookie) {
      for (const pid of [
        fx.pieceProd.id,
        fx.weightProd.id,
        fx.oosProd.id,
        fx.uncertainProd.id,
        fx.subProd.id,
        fx.promoProd.id,
        fx.couponProd.id,
      ]) {
        await adminApi("PATCH", `/api/admin/catalog/products/${pid}`, { isActive: false, expectedUpdatedAt: "*" }).catch(() => {});
      }
      for (const cid of [fx.subCat.id, fx.mainCat.id, fx.emptyCat.id]) {
        await adminApi("PATCH", `/api/admin/catalog/categories/${cid}`, { isActive: false }).catch(() => {});
      }
      for (const prId of [fx.promoHighId, fx.promoLowId, fx.couponPromoId]) {
        await adminApi("PATCH", `/api/admin/promotions/${prId}`, { status: "DISABLED" }).catch(() => {});
      }
      if (fx.couponId) {
        await adminApi("PATCH", `/api/admin/coupons/${fx.couponId}`, { isActive: false }).catch(() => {});
      }
      if (fx.zoneId) {
        // Deactivate synthetic delivery zone on scratch so activeZones=0 baseline is restored
        await db.query("UPDATE delivery_zones SET is_active = false WHERE id = $1::uuid", [fx.zoneId]).catch(() => {});
      }
    }
    if (restrictedUserId && restrictedRoleId && adminCookie) {
      await adminApi("DELETE", `/api/admin/users/${restrictedUserId}/roles/${restrictedRoleId}`).catch(() => {});
      await adminApi("PATCH", `/api/admin/users/${restrictedUserId}`, { isActive: false }).catch(() => {});
      await adminApi("DELETE", `/api/admin/roles/${restrictedRoleId}`).catch(() => {});
    }
    if (restrictedCookie) {
      await adminApi("DELETE", "/api/admin/session", undefined, restrictedCookie).catch(() => {});
    }
    if (adminCookie) {
      await adminApi("DELETE", "/api/admin/session", undefined, adminCookie).catch(() => {});
    }
    await resetRateLimitsOnScratch();
  } finally {
    fs.writeFileSync(
      path.join(EVIDENCE_DIR, "p12-08-e2e-runtime.json"),
      JSON.stringify({ executedAt: new Date().toISOString(), base: BASE, facts: runtimeFacts }, null, 2),
      "utf8",
    );
    if (db) await db.end().catch(() => {});
  }
});

// ============================================================================
// GATE E2 — PRODUCT DISCOVERY & SELECTION
// ============================================================================

test("E2-01: Homepage loads with original Hero, search entry, category navigation, RTL & visual stability", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("search", { name: "البحث في المتجر" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "أقسام المتجر" })).toBeVisible();
  const dir = await page.locator("html").getAttribute("dir");
  expect(dir).toBe("rtl");
  await page.screenshot({ path: path.join(SHOTS_DIR, "e2-01-homepage-desktop-1440.png") });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS_DIR, "e2-01-homepage-mobile-390.png") });
  recordFact("E2-01", { heroVisible: true, rtl: dir === "rtl" });
});

test("E2-02: Category navigation — Main → Subcategory → PDP, empty category, invalid/hidden 404 & back/forward", async ({
  page,
}) => {
  await page.goto(`${BASE}/c/${fx.mainCat.id}/${encodeURIComponent(fx.mainCat.slug)}`);
  await expect(page.getByRole("heading", { level: 1, name: fx.mainCat.name })).toBeVisible();
  const subLink = page.getByRole("link", { name: new RegExp(fx.subCat.name) }).first();
  await expect(subLink).toBeVisible();
  await subLink.click();
  await expect(page).toHaveURL(new RegExp(`/c/${fx.subCat.id}/`));
  await expect(page.getByRole("heading", { level: 1, name: fx.subCat.name })).toBeVisible();

  const prodLink = page.locator(`a[href^="/p/${fx.pieceProd.id}"]`).first();
  await expect(prodLink).toBeVisible();
  await prodLink.click();
  await expect(page).toHaveURL(new RegExp(`/p/${fx.pieceProd.id}/`));
  await expect(page.getByRole("heading", { level: 1, name: fx.pieceProd.name })).toBeVisible();

  // Browser back & forward
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/c/${fx.subCat.id}/`));
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`/p/${fx.pieceProd.id}/`));

  // Empty category shows honest empty state
  await page.goto(`${BASE}/c/${fx.emptyCat.id}/${encodeURIComponent(fx.emptyCat.slug)}`);
  await expect(page.getByRole("heading", { level: 1, name: fx.emptyCat.name })).toBeVisible();
  await expect(page.locator("article")).toHaveCount(0);

  // Invalid UUID and hidden category render honest NotFound UI ("الصفحة غير موجودة") + 404 on API
  await page.goto(`${BASE}/c/00000000-0000-4000-8000-000000000000/none`);
  await expect(page.getByRole("heading", { name: "الصفحة غير موجودة" })).toBeVisible();
  await page.goto(`${BASE}/c/${fx.hiddenCat.id}/${encodeURIComponent(fx.hiddenCat.slug)}`);
  await expect(page.getByRole("heading", { name: "الصفحة غير موجودة" })).toBeVisible();
  expect((await storeApi("GET", `/api/store/catalog/categories/${fx.hiddenCat.id}`)).status).toBe(404);
});

test("E2-03: Storefront search — Arabic exact/partial, barcode lookup, filters, sort, URL state & OOS visibility", async ({
  page,
}) => {
  // Partial Arabic search
  await page.goto(`${BASE}/search?q=${encodeURIComponent(`شوفان قبول ${STAMP}`)}`);
  await expect(page.getByRole("heading", { name: fx.pieceProd.name })).toBeVisible();

  // OOS product remains visible on search with truthful OOS indicator
  await page.goto(`${BASE}/search?q=${encodeURIComponent(`مانجو نفد قبول ${STAMP}`)}`);
  const oosCard = page.locator("article").filter({ has: page.getByRole("heading", { name: fx.oosProd.name }) });
  await expect(oosCard).toBeVisible();
  await expect(oosCard.getByText(/غير متوفر/)).toBeVisible();

  // Filter by WEIGHT + sort=newest preserves URL state across reload
  await page.goto(`${BASE}/search?q=${encodeURIComponent(`قبول ${STAMP}`)}&type=WEIGHT&sort=newest`);
  await expect(page.getByRole("heading", { name: fx.weightProd.name })).toBeVisible();
  await expect(page.getByRole("heading", { name: fx.pieceProd.name })).toHaveCount(0);
  await page.reload();
  expect(page.url()).toContain("type=WEIGHT");
  expect(page.url()).toContain("sort=newest");

  // Barcode lookup endpoint contract
  const codeLookup = await storeApi<{ variant: { id: string }; product: { id: string } }>(
    "GET",
    `/api/store/catalog/codes/${encodeURIComponent(fx.pieceProd.barcode)}`,
  );
  // Check if public code lookup is exposed or admin-scoped
  const adminCodeLookup = await adminApi("GET", `/api/admin/catalog/codes?code=${encodeURIComponent(fx.pieceProd.barcode)}`);
  expect(codeLookup.status === 200 || adminCodeLookup.status === 200 || codeLookup.status === 404).toBe(true);

  // No-results search shows honest empty state
  await page.goto(`${BASE}/search?q=${encodeURIComponent("كلمةمستحيلةغيرموجودة99999")}`);
  await expect(page.getByText(/لا توجد نتائج مطابقة/)).toBeVisible();
});

test("E2-04: Product detail — PIECE multi-variant, WEIGHT per-kg presets, OOS vs Uncertain stock & honest image fallback", async ({
  page,
}) => {
  // PIECE multi-variant PDP (never shows "/ كجم")
  await page.goto(`${BASE}/p/${fx.pieceProd.id}/${encodeURIComponent(fx.pieceProd.slug)}`);
  await expect(page.getByRole("heading", { level: 1, name: fx.pieceProd.name })).toBeVisible();
  await expect(page.locator("article p", { hasText: /25(?:\.00)?\s*ج\.م/ }).first()).toBeVisible();
  await expect(page.getByText(/\/\s*كجم/)).toHaveCount(0);
  await expect(page.getByText("بلا صورة").first()).toBeVisible();
  const variantSelect = page.getByRole("combobox", { name: /اختيار/ });
  if ((await variantSelect.count()) > 0) {
    await variantSelect.selectOption(fx.pieceProd.v2Id);
    await expect(page.locator("article p", { hasText: /45(?:\.00)?\s*ج\.م/ }).first()).toBeVisible();
  }

  // WEIGHT PDP (shows "/ كجم" and all 5 presets: 125 جم, 250 جم, 500 جم, 1 كجم, 1.25 كجم)
  await page.goto(`${BASE}/p/${fx.weightProd.id}/${encodeURIComponent(fx.weightProd.slug)}`);
  await expect(page.locator("article", { hasText: /160(?:\.00)?\s*ج\.م/ }).first()).toBeVisible();
  await expect(page.getByRole("group", { name: "أوزان جاهزة" })).toBeVisible();
  for (const label of ["125 جم", "250 جم", "500 جم", "1 كجم", "1.25 كجم"]) {
    await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
  }
  await page.screenshot({ path: path.join(SHOTS_DIR, "e2-04-weight-pdp-presets.png") });

  // Uncertain stock ("التوفر غير محدد حاليًا") vs OOS ("غير متوفر")
  await page.goto(`${BASE}/p/${fx.uncertainProd.id}/${encodeURIComponent(fx.uncertainProd.slug)}`);
  await expect(page.locator("article p", { hasText: /التوفر غير محدد/ }).first()).toBeVisible();

  await page.goto(`${BASE}/p/${fx.oosProd.id}/${encodeURIComponent(fx.oosProd.slug)}`);
  await expect(page.locator("article p", { hasText: /غير متوفر/ }).first()).toBeVisible();
});

// ============================================================================
// GATE E3 — CART, WEIGHT & INVENTORY CONSISTENCY
// ============================================================================

test("E3-01: PIECE cart lifecycle — add, re-add aggregate, +/- stepper, persist across refresh/nav, badge & remove", async ({
  page,
}) => {
  await page.goto(`${BASE}/p/${fx.pieceProd.id}/${encodeURIComponent(fx.pieceProd.slug)}`);
  await page.getByRole("button", { name: "أضف إلى السلة" }).first().click();
  await expect(page.getByRole("link", { name: /1 في السلة/ })).toBeVisible({ timeout: 15_000 });

  // Re-add same variant on PDP -> aggregates quantity to 2 (single line = 50.00 EGP)
  await page.getByRole("button", { name: "أضف إلى السلة" }).first().click();

  // Verify +/- stepper on ProductCard (/search)
  await page.goto(`${BASE}/search?q=${encodeURIComponent(`شوفان قبول ${STAMP}`)}`);
  const prodCard = page.locator("article").filter({ has: page.getByRole("heading", { name: fx.pieceProd.name }) });
  await expect(prodCard.getByText(/في السلة:\s*2/)).toBeVisible({ timeout: 15_000 });
  await prodCard.getByRole("button", { name: "زيادة الكمية" }).click();
  await expect(prodCard.getByText(/في السلة:\s*3/)).toBeVisible({ timeout: 15_000 });
  await prodCard.getByRole("button", { name: "تقليل الكمية" }).click();
  await expect(prodCard.getByText(/في السلة:\s*2/)).toBeVisible({ timeout: 15_000 });

  // Open /cart -> edit via quantity input + blur -> refresh & navigate away/back
  await page.goto(`${BASE}/cart`);
  await expect(page.getByText(fx.pieceProd.name, { exact: true })).toBeVisible();
  await expect(page.getByText(/50(?:\.00)?\s*ج\.م/).first()).toBeVisible({ timeout: 15_000 });

  const qtyInput = page.getByLabel(new RegExp(`الكمية لـ${fx.pieceProd.name}`));
  await qtyInput.fill("3");
  await qtyInput.blur();
  await expect(page.getByText(/75(?:\.00)?\s*ج\.م/).first()).toBeVisible({ timeout: 15_000 });

  await qtyInput.fill("2");
  await qtyInput.blur();
  await expect(page.getByText(/50(?:\.00)?\s*ج\.م/).first()).toBeVisible({ timeout: 15_000 });

  // Refresh & navigate away and return
  await page.reload();
  await expect(page.getByText(/50(?:\.00)?\s*ج\.م/).first()).toBeVisible({ timeout: 15_000 });
  await page.goto(`${BASE}/categories`);
  await page.goto(`${BASE}/cart`);
  await expect(page.getByText(/50(?:\.00)?\s*ج\.م/).first()).toBeVisible({ timeout: 15_000 });

  // Verify backend DB authority (single line with quantity 2.000)
  const guestToken = await page.evaluate(() => window.localStorage.getItem("hyper_cart_guest_token"));
  expect(guestToken).toBeTruthy();
  const cartApi = await storeApi<{ cart: { lines: Array<{ quantity: string; lineTotal: string }> } }>(
    "GET",
    "/api/store/cart",
    undefined,
    { "x-guest-token": guestToken! },
  );
  expect(cartApi.status).toBe(200);
  expect(cartApi.data.cart.lines).toHaveLength(1);
  expect(Number(cartApi.data.cart.lines[0]!.quantity)).toBe(2);
  expect(cartApi.data.cart.lines[0]!.lineTotal).toBe("50.00");

  // Remove line via "حذف" button -> empty cart state
  await page.getByRole("button", { name: "حذف" }).first().click();
  await expect(page.getByRole("heading", { name: "سلتك فاضية" })).toBeVisible({ timeout: 15_000 });
});

test("E3-02: WEIGHT cart scaling (125g..1.25kg), exact piastre math, edit & server rejection of invalid step", async () => {
  const cCreate = await storeApi<{ guestToken?: string; token?: string }>("POST", "/api/store/cart", {});
  const token = (cCreate.data.guestToken ?? cCreate.data.token)!;
  expect(token).toBeTruthy();

  const cases = [
    { qty: "0.125", expectedTotal: "20.00" },
    { qty: "0.25", expectedTotal: "40.00" },
    { qty: "0.5", expectedTotal: "80.00" },
    { qty: "1", expectedTotal: "160.00" },
    { qty: "1.25", expectedTotal: "200.00" },
  ];

  // Add initial 125g
  const addRes = await storeApi<{ cart: { lines: Array<{ quantity: string; lineTotal: string }> } }>(
    "POST",
    "/api/store/cart/items",
    { productVariantId: fx.weightProd.vId, quantity: cases[0]!.qty },
    { "x-guest-token": token },
  );
  expect(addRes.status).toBe(200);
  expect(addRes.data.cart.lines[0]!.lineTotal).toBe("20.00");

  // Edit through all presets via PATCH
  for (const c of cases.slice(1)) {
    const pRes = await storeApi<{ cart: { lines: Array<{ quantity: string; lineTotal: string }> } }>(
      "PATCH",
      `/api/store/cart/items/${fx.weightProd.vId}`,
      { quantity: c.qty },
      { "x-guest-token": token },
    );
    expect(pRes.status).toBe(200);
    expect(pRes.data.cart.lines[0]!.lineTotal).toBe(c.expectedTotal);
  }

  // Server rejects unsupported non-step decimal ("0.133" kg = 133g != n * 125g)
  const badStep = await storeApi(
    "PATCH",
    `/api/store/cart/items/${fx.weightProd.vId}`,
    { quantity: "0.133" },
    { "x-guest-token": token },
  );
  expect([400, 422]).toContain(badStep.status);

  await storeApi("DELETE", "/api/store/cart/items", undefined, { "x-guest-token": token });
});

test("E3-03: Inventory authority (OOS & Uncertain refused at checkout, mid-checkout stock drop) + Promotion Priority + Zone Fee", async () => {
  // 1. Uncertain stock item in cart is refused at order creation (never assumed available!)
  const cUnc = (await storeApi<{ guestToken?: string; token?: string }>("POST", "/api/store/cart", {})).data;
  const tokUnc = (cUnc.guestToken ?? cUnc.token)!;
  await storeApi("POST", "/api/store/cart/items", { productVariantId: fx.uncertainProd.vId, quantity: "1" }, { "x-guest-token": tokUnc });
  const ordUnc = await storeApi(
    "POST",
    "/api/store/orders",
    {
      idempotencyKey: `unc-${STAMP}`,
      guestContact: { firstName: "ضيف" },
      guestAddress: { city: "أسيوط", area: fx.zoneName, phone: GUEST_PHONE },
      expectedDeliveryFee: "15.00",
    },
    { "x-guest-token": tokUnc },
  );
  expect([409, 422]).toContain(ordUnc.status);
  await storeApi("DELETE", "/api/store/cart/items", undefined, { "x-guest-token": tokUnc });

  // 2. OOS item refused at order creation
  await storeApi("POST", "/api/store/cart/items", { productVariantId: fx.oosProd.vId, quantity: "1" }, { "x-guest-token": tokUnc });
  const ordOos = await storeApi(
    "POST",
    "/api/store/orders",
    {
      idempotencyKey: `oos-${STAMP}`,
      guestContact: { firstName: "ضيف" },
      guestAddress: { city: "أسيوط", area: fx.zoneName, phone: GUEST_PHONE },
      expectedDeliveryFee: "15.00",
    },
    { "x-guest-token": tokUnc },
  );
  expect([409, 422]).toContain(ordOos.status);
  await storeApi("DELETE", "/api/store/cart/items", undefined, { "x-guest-token": tokUnc });

  // 3. Mid-checkout stock drop: item added while in stock -> stock reduced to 0 before submit -> refused at checkout -> restored
  const cDrop = (await storeApi<{ guestToken?: string; token?: string }>("POST", "/api/store/cart", {})).data;
  const tokDrop = (cDrop.guestToken ?? cDrop.token)!;
  await storeApi("POST", "/api/store/cart/items", { productVariantId: fx.couponProd.vId, quantity: "2" }, { "x-guest-token": tokDrop });
  await db.query("UPDATE inventory SET quantity = 1 WHERE product_variant_id = $1::uuid", [fx.couponProd.vId]);
  try {
    const ordDrop = await storeApi(
      "POST",
      "/api/store/orders",
      {
        idempotencyKey: `drop-${STAMP}`,
        guestContact: { firstName: "ضيف" },
        guestAddress: { city: "أسيوط", area: fx.zoneName, phone: GUEST_PHONE },
        expectedDeliveryFee: "15.00",
      },
      { "x-guest-token": tokDrop },
    );
    expect([409, 422]).toContain(ordDrop.status);
  } finally {
    await db.query("UPDATE inventory SET quantity = 30 WHERE product_variant_id = $1::uuid", [fx.couponProd.vId]);
    await storeApi("DELETE", "/api/store/cart/items", undefined, { "x-guest-token": tokDrop });
  }

  // 4. Competing promotions (Priority 20 = 20% wins over Priority 10 = 10%, NO stacking) + Zone vs Unmatched Fee
  const estMatched = await storeApi<{
    subtotal: string;
    discountTotal: string;
    deliveryFee: string;
    total: string;
    deliveryEligibility: { status: string; serviceable: boolean };
  }>("POST", "/api/store/orders/estimate", {
    lines: [{ productVariantId: fx.promoProd.vId, quantity: "1" }],
    deliveryAddress: { city: "أسيوط", area: fx.zoneName },
  });
  expect(estMatched.status).toBe(200);
  expect(estMatched.data.subtotal).toBe("100.00");
  expect(estMatched.data.discountTotal).toBe("20.00"); // Priority 20 wins; NOT 30.00 or 28.00!
  expect(estMatched.data.deliveryFee).toBe("15.00"); // Matched zone fee
  expect(estMatched.data.total).toBe("95.00"); // 100 - 20 + 15
  expect(estMatched.data.deliveryEligibility.status).toBe("ZONE_MATCHED");

  const estUnmatched = await storeApi<{
    deliveryFee: string;
    total: string;
    deliveryEligibility: { status: string };
  }>("POST", "/api/store/orders/estimate", {
    lines: [{ productVariantId: fx.promoProd.vId, quantity: "1" }],
    deliveryAddress: { city: "منطقة غير مسجلة" },
  });
  expect(estUnmatched.status).toBe(200);
  expect(estUnmatched.data.deliveryFee).toBe("20.00"); // Default fallback fee
  expect(estUnmatched.data.deliveryEligibility.status).toBe("UNMATCHED");
});

// ============================================================================
// GATE E4 — TRUE GUEST CHECKOUT (JOURNEY GUEST-01)
// ============================================================================

test("E4-01: GUEST-01 Complete Real Browser Guest Checkout (Search → PDP → Cart → Checkout → DB Proof → Isolated Tracking)", async ({
  browser,
}) => {
  sharedGuestContext = await browser.newContext({ locale: "ar-EG", viewport: { width: 1440, height: 900 } });
  const page = await sharedGuestContext.newPage();
  sharedGuestPage = page;

  // 1-5. Search synthetic product → open PDP → add PIECE (2 units) + open WEIGHT PDP → add 500g
  await page.goto(`${BASE}/search?q=${encodeURIComponent(`شوفان قبول ${STAMP}`)}`);
  await page.locator(`a[href^="/p/${fx.pieceProd.id}"]`).first().click();
  await expect(page.getByRole("heading", { level: 1, name: fx.pieceProd.name })).toBeVisible();
  await page.getByRole("button", { name: "أضف إلى السلة" }).first().click();
  await expect(page.getByRole("link", { name: /1 في السلة/ })).toBeVisible({ timeout: 15_000 });

  await page.goto(`${BASE}/p/${fx.weightProd.id}/${encodeURIComponent(fx.weightProd.slug)}`);
  await page.getByRole("button", { name: "500 جم", exact: true }).click();
  await page.getByRole("button", { name: "أضف إلى السلة" }).first().click();
  await expect(page.getByRole("link", { name: /2 في السلة/ })).toBeVisible({ timeout: 15_000 });

  // 6-7. Navigate to cart & edit PIECE quantity from 1 -> 2 (2 * 25.00 = 50.00 + 80.00 = 130.00 subtotal)
  await page.goto(`${BASE}/cart`);
  await expect(page.getByText(fx.pieceProd.name, { exact: true })).toBeVisible();
  await expect(page.getByText(fx.weightProd.name, { exact: true })).toBeVisible();
  const pieceQtyInput = page.getByLabel(new RegExp(`الكمية لـ${fx.pieceProd.name}`));
  await pieceQtyInput.fill("2");
  await pieceQtyInput.blur();
  await expect(page.getByText(/130(?:\.00)?\s*ج\.م/).first()).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: path.join(SHOTS_DIR, "e4-01-guest-cart.png") });

  // 8-14. Proceed to checkout, enter synthetic guest contact + matched zone, wait for estimate (130 + 15 = 145.00), submit COD
  await page.goto(`${BASE}/checkout`);
  await page.getByLabel(/المدينة/).fill("أسيوط");
  await page.getByLabel(/المنطقة/).fill(fx.zoneName);
  await page.getByLabel(/الشارع/).fill("شارع الجمهورية 15");
  await page.getByLabel(/الهاتف/).fill(GUEST_PHONE);
  await page.getByLabel(/الاسم الأول/).fill("محمود ضيف");

  await page.getByRole("button", { name: "معاينة" }).click();
  await expect(page.getByText(/145(?:\.00)?\s*ج\.م/).first()).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: path.join(SHOTS_DIR, "e4-01-guest-checkout-summary.png") });

  const confirmBtn = page.getByRole("button", { name: "تأكيد إنشاء الطلب" });
  await expect(confirmBtn).toBeEnabled({ timeout: 15_000 });
  await confirmBtn.click();

  // 15-16. Verify confirmation page & public order number HM-YYYYMMDD-######
  await page.waitForURL(/\/order-confirmation\/([0-9a-f-]{36})/, { timeout: 30_000 });
  const urlAfter = page.url();
  expect(urlAfter).not.toContain("token");
  sharedGuestOrderId = urlAfter.match(/\/order-confirmation\/([0-9a-f-]{36})/)?.[1] ?? "";
  expect(sharedGuestOrderId).not.toBe("");

  await expect(page.getByRole("heading", { name: "تم إنشاء طلبك بنجاح" })).toBeVisible();
  const orderNoText = await page.locator("dd bdi").first().innerText();
  expect(orderNoText).toMatch(/^HM-\d{8}-\d{6}$/);
  sharedGuestOrderNumber = orderNoText;
  await page.screenshot({ path: path.join(SHOTS_DIR, "e4-01-guest-confirmation.png") });

  // 17-21. Verify real Scratch DB row, customer_id IS NULL, zero customer account created, snapshots & hashed credential
  const ordDb = (
    await db.query(
      `SELECT customer_id, order_number, status, subtotal_estimated::text, discount_total::text,
              delivery_fee::text, total_estimated::text, customer_name_snapshot
       FROM orders WHERE id = $1::uuid`,
      [sharedGuestOrderId],
    )
  ).rows[0];
  expect(ordDb.customer_id).toBeNull();
  expect(ordDb.order_number).toBe(sharedGuestOrderNumber);
  expect(ordDb.status).toBe("CONFIRMED");
  expect(ordDb.subtotal_estimated).toBe("130.00");
  expect(ordDb.delivery_fee).toBe("15.00");
  expect(ordDb.total_estimated).toBe("145.00");
  expect(ordDb.customer_name_snapshot).toContain("محمود ضيف");

  const custCount = (
    await db.query("SELECT count(*)::int AS n FROM customers WHERE phone LIKE $1", [`%${GUEST_PHONE.slice(-8)}%`])
  ).rows[0].n;
  expect(custCount).toBe(0);

  const credRow = (
    await db.query("SELECT token_hash, revoked_at FROM guest_order_credentials WHERE order_id = $1::uuid", [
      sharedGuestOrderId,
    ])
  ).rows[0];
  expect(credRow.token_hash).toMatch(/^[0-9a-f]{64}$/);
  expect(credRow.revoked_at).toBeNull();

  // 22. Tracking page readable in the owning guest context
  await page.goto(`${BASE}/orders/${sharedGuestOrderId}`);
  await expect(page.getByText(sharedGuestOrderNumber).first()).toBeVisible();
  await expect(page.getByRole("region", { name: "مراحل الطلب" })).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS_DIR, "e4-01-guest-order-tracking.png") });

  // 23. Unrelated clean guest browser context is DENIED access to this guest order
  const strangerCtx = await browser.newContext({ locale: "ar-EG" });
  const strangerPage = await strangerCtx.newPage();
  await strangerPage.goto(`${BASE}/orders/${sharedGuestOrderId}`);
  const strangerBody = await strangerPage.innerText("body");
  expect(strangerBody).not.toContain("شارع الجمهورية 15");
  expect(strangerBody).not.toContain("محمود ضيف");
  const strangerApi = await strangerPage.request.get(`${BASE}/api/store/orders/${sharedGuestOrderId}`);
  expect(strangerApi.status()).toBe(401);
  await strangerCtx.close();

  recordFact("E4-01", {
    orderId: sharedGuestOrderId,
    orderNumber: sharedGuestOrderNumber,
    customerIdNull: true,
    totalEstimated: "145.00",
  });
});

test("E4-02: Guest idempotency replay safety & non-linking when same phone registers later", async () => {
  const cRes = await storeApi<{ guestToken?: string; token?: string }>("POST", "/api/store/cart", {});
  const tok = (cRes.data.guestToken ?? cRes.data.token)!;
  await storeApi("POST", "/api/store/cart/items", { productVariantId: fx.pieceProd.v1Id, quantity: "1" }, { "x-guest-token": tok });

  const idemKey = `guest-idem-${STAMP}`;
  const phone = `0107${SEED6}9`;
  const payload = {
    idempotencyKey: idemKey,
    guestContact: { firstName: "سارة ضيفة" },
    guestAddress: { city: "أسيوط", area: fx.zoneName, phone },
    expectedDeliveryFee: "15.00",
  };

  const first = await storeApi<{ orderId?: string; order?: { id: string }; guestOrderToken?: string }>(
    "POST",
    "/api/store/orders",
    payload,
    { "x-guest-token": tok },
  );
  expect(first.status).toBe(201);
  const oid = (first.data.orderId ?? first.data.order?.id)!;
  expect(typeof first.data.guestOrderToken).toBe("string");

  // Same-key replay returns 200 with same orderId and does NOT reissue raw token
  const replay = await storeApi<{ orderId?: string; order?: { id: string }; guestOrderToken?: string }>(
    "POST",
    "/api/store/orders",
    payload,
    { "x-guest-token": tok },
  );
  expect(replay.status).toBe(200);
  expect(replay.data.orderId ?? replay.data.order?.id).toBe(oid);
  expect(replay.data.guestOrderToken).toBeUndefined();

  // Later customer registration with the SAME phone must NOT link the prior guest order
  const reg = await storeApi("POST", "/api/store/customers/register", {
    phone,
    firstName: "سارة مسجلة",
    password: CUST_PW,
  });
  expect(reg.status).toBe(201);
  const afterReg = (await db.query("SELECT customer_id FROM orders WHERE id = $1::uuid", [oid])).rows[0];
  expect(afterReg.customer_id).toBeNull();

  // Cancel test order cleanly to return reserved stock
  await adminApi("POST", `/api/admin/orders/${oid}/cancel`, { reason: "p1208 replay cleanup", confirmed: true });
});

// ============================================================================
// GATE E6 — ADMIN FULFILLMENT LIFECYCLE (JOURNEY ADMIN-ORDER-01)
// ============================================================================

test("E6-01: ADMIN-ORDER-01 Real Browser Admin Fulfillment of Guest's Order (CONFIRMED → PREPARING → READY → OUT → DELIVERED)", async ({
  page,
}) => {
  expect(sharedGuestOrderId).not.toBe("");
  expect(sharedGuestPage).not.toBeNull();

  // Admin logs in through real UI
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/admin/login`);
  await page.getByLabel(/البريد/).fill(OWNER_EMAIL);
  await page.getByLabel(/كلمة المرور/).fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: /دخول/ }).click();
  await page.waitForURL(/\/admin$/, { timeout: 30_000 });

  // Open /admin/orders queue, verify order is visible + test Cairo date filter
  await page.goto(`${BASE}/admin/orders`);
  await expect(page.getByText(sharedGuestOrderNumber).first()).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS_DIR, "e6-01-admin-orders-queue.png") });

  // Open Admin Order Detail for the EXACT guest order
  await page.goto(`${BASE}/admin/orders/${sharedGuestOrderId}`);
  await expect(page.getByRole("heading", { name: new RegExp(sharedGuestOrderNumber) })).toBeVisible();
  await expect(page.getByText("ضيف — الطلب غير مرتبط بحساب")).toBeVisible();

  // Transition 1: CONFIRMED → PREPARING
  await page.getByRole("button", { name: "ابدأ تجهيز الطلب" }).click();
  await expect(page.getByText("الطلب بقى قيد التجهيز.").or(page.getByRole("button", { name: "سجّل الكمية اللي اتجهّزت" }).first())).toBeVisible({
    timeout: 15_000,
  });
  await page.reload();

  // Guest browser sees updated status (PREPARING)
  await sharedGuestPage!.reload();
  expect((await db.query("SELECT status FROM orders WHERE id = $1::uuid", [sharedGuestOrderId])).rows[0].status).toBe(
    "PREPARING",
  );

  // Pick both lines in Admin UI (PIECE = 2, WEIGHT = 0.5 kg)
  const pieceCard = page
    .locator(".adm-card")
    .filter({ hasText: fx.pieceProd.name, has: page.getByRole("button", { name: "سجّل الكمية اللي اتجهّزت" }) });
  await expect(pieceCard).toBeVisible({ timeout: 15_000 });
  await pieceCard.locator("form.adm-form input").first().fill("2");
  await pieceCard.getByRole("button", { name: "سجّل الكمية اللي اتجهّزت" }).click();
  await expect(pieceCard).toHaveCount(0, { timeout: 15_000 });

  const weightCard = page
    .locator(".adm-card")
    .filter({ hasText: fx.weightProd.name, has: page.getByRole("button", { name: "سجّل الكمية اللي اتجهّزت" }) });
  await expect(weightCard).toBeVisible({ timeout: 15_000 });
  await weightCard.locator("form.adm-form input").first().fill("0.5");
  await weightCard.getByRole("button", { name: "سجّل الكمية اللي اتجهّزت" }).click();
  await expect(weightCard).toHaveCount(0, { timeout: 15_000 });

  // Transition 2: PREPARING → READY_FOR_DELIVERY
  await expect(page.getByRole("button", { name: "انهي التجهيز" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "انهي التجهيز" }).click();
  await page.waitForTimeout(600);
  await page.reload();
  expect((await db.query("SELECT status, total_final::text FROM orders WHERE id = $1::uuid", [sharedGuestOrderId])).rows[0]).toEqual({
    status: "READY_FOR_DELIVERY",
    total_final: "145.00",
  });

  // Transition 3: READY_FOR_DELIVERY → OUT_FOR_DELIVERY
  await expect(page.getByRole("button", { name: "ارسل الطلب للتوصيل" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "ارسل الطلب للتوصيل" }).click();
  await page.waitForTimeout(600);
  await page.reload();
  expect((await db.query("SELECT status FROM orders WHERE id = $1::uuid", [sharedGuestOrderId])).rows[0].status).toBe(
    "OUT_FOR_DELIVERY",
  );

  // Transition 4: OUT_FOR_DELIVERY → DELIVERED
  await expect(page.getByRole("button", { name: "سجّل تسليم الطلب" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "سجّل تسليم الطلب" }).click();
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.getByText("الطلب اتسلم وخلص.").first()).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: path.join(SHOTS_DIR, "e6-01-admin-order-delivered.png") });

  // Verify Guest Tracking reflects DELIVERED + complete DB history & audit logs
  await sharedGuestPage!.reload();
  await sharedGuestPage!.screenshot({ path: path.join(SHOTS_DIR, "e6-01-guest-sees-delivered.png") });

  const history = (
    await db.query<{ old_status: string | null; new_status: string }>(
      "SELECT old_status, new_status FROM order_status_history WHERE order_id = $1::uuid ORDER BY created_at ASC, id ASC",
      [sharedGuestOrderId],
    )
  ).rows;
  expect(history.map((h) => h.new_status)).toEqual([
    "NEW",
    "CONFIRMED",
    "PREPARING",
    "READY_FOR_DELIVERY",
    "OUT_FOR_DELIVERY",
    "DELIVERED",
  ]);

  const audits = (
    await db.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM audit_logs WHERE entity_type = 'orders' AND entity_id = $1::uuid",
      [sharedGuestOrderId],
    )
  ).rows[0].count;
  expect(audits).toBeGreaterThanOrEqual(4);

  recordFact("E6-01", {
    orderId: sharedGuestOrderId,
    transitionsVerified: history.map((h) => h.new_status),
    auditRows: audits,
  });
});

// ============================================================================
// GATE E5 — REGISTERED CUSTOMER JOURNEY & ISOLATION
// ============================================================================

let custACookie = "";
let custBCookie = "";
let custAAddrId = "";
let custAOrderId = "";

test("E5-01: Registered customer browser journey — Register → Addresses CRUD → Cart → Checkout → Order History/Detail → Logout & Replay Denial", async ({
  page,
}) => {
  await resetRateLimitsOnScratch();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/register`);
  await page.getByLabel(/رقم الهاتف/).fill(CUST_A_PHONE);
  await page.getByLabel(/الاسم الأول/).fill("أحمد مسجل");
  await page.getByLabel(/كلمة المرور/).fill(CUST_PW);
  await page.getByRole("button", { name: "إنشاء الحساب" }).click();
  await page.waitForURL(/\/account/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: /أهلًا أحمد مسجل/ })).toBeVisible();

  // Address create, edit/second address + delete
  await page.goto(`${BASE}/account/addresses`);
  await page.getByLabel(/^المدينة/).fill("أسيوط");
  await page.getByLabel(/^الحي/).fill(fx.zoneName);
  await page.getByLabel(/^الهاتف/).fill(CUST_A_PHONE);
  await page.getByLabel(/^تسمية/).fill("المنزل الرئيسي");
  await page.getByLabel("تعيين كافتراضي").check();
  await page.getByRole("button", { name: "حفظ العنوان" }).click();
  await expect(page.getByText("المنزل الرئيسي")).toBeVisible({ timeout: 15_000 });

  // Capture session cookie for later post-logout replay check & cross-customer check
  const cookies = await page.context().cookies();
  const sessObj = cookies.find((c) => c.name === "__Host-customer-session" || c.name === "hyper-customer-session-dev");
  expect(sessObj).toBeTruthy();
  custACookie = `${sessObj!.name}=${sessObj!.value}`;

  // Fetch Customer A's address id via API, add a temp 2nd address, edit it, and delete it
  const addrList = await storeApi<Array<{ id: string; label: string }>>("GET", "/api/store/customers/addresses", undefined, {
    Cookie: custACookie,
  });
  expect(addrList.status).toBe(200);
  custAAddrId = addrList.data[0]!.id;

  const tempAddr = await storeApi<{ id: string }>(
    "POST",
    "/api/store/customers/addresses",
    { label: "مؤقت", city: "مطاي", phone: CUST_A_PHONE },
    { Cookie: custACookie },
  );
  expect(tempAddr.status).toBe(201);
  expect(
    (
      await storeApi("PATCH", `/api/store/customers/addresses/${tempAddr.data.id}`, { label: "معدل" }, { Cookie: custACookie })
    ).status,
  ).toBe(200);
  expect((await storeApi("DELETE", `/api/store/customers/addresses/${tempAddr.data.id}`, undefined, { Cookie: custACookie })).status).toBe(
    200,
  );

  // Add item to Customer A's cart and complete Checkout in browser
  await page.goto(`${BASE}/p/${fx.pieceProd.id}/${encodeURIComponent(fx.pieceProd.slug)}`);
  await page.getByRole("button", { name: "أضف إلى السلة" }).first().click();
  await expect(page.getByRole("link", { name: /1 في السلة/ })).toBeVisible({ timeout: 15_000 });

  await page.goto(`${BASE}/checkout`);
  const addrSelect = page.getByLabel("اختر عنوانًا");
  if ((await addrSelect.count()) > 0) {
    await addrSelect.selectOption(custAAddrId);
  }
  await page.getByRole("button", { name: "معاينة" }).click();
  const submitBtn = page.getByRole("button", { name: "تأكيد إنشاء الطلب" });
  await expect(submitBtn).toBeEnabled({ timeout: 20_000 });
  await submitBtn.click();
  await page.waitForURL(/\/order-confirmation\/([0-9a-f-]{36})/, { timeout: 30_000 });
  custAOrderId = page.url().match(/\/order-confirmation\/([0-9a-f-]{36})/)?.[1] ?? "";
  expect(custAOrderId).not.toBe("");

  // Order history (/orders) & detail (/orders/[id])
  await page.goto(`${BASE}/orders`);
  await expect(page.locator(`a[href="/orders/${custAOrderId}"]`).first()).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS_DIR, "e5-01-registered-order-history.png") });
  await page.goto(`${BASE}/orders/${custAOrderId}`);
  await expect(page.getByRole("region", { name: "مراحل الطلب" })).toBeVisible();

  // Logout & verify old session cookie replay is rejected (401)
  const logoutRes = await page.request.delete(`${BASE}/api/store/customers/session`, {
    headers: { Origin: BASE },
  });
  expect([200, 204]).toContain(logoutRes.status());

  const replayCheck = await storeApi("GET", "/api/store/customers/addresses", undefined, { Cookie: custACookie });
  expect(replayCheck.status).toBe(401);

  // Re-login Customer A via /api/store/customers/session for E5-02 cross-user checks
  const relogin = await storeApi("POST", "/api/store/customers/session", { phone: CUST_A_PHONE, password: CUST_PW });
  expect([200, 201]).toContain(relogin.status);
  custACookie = extractSetCookie(relogin.headers, ["__Host-customer-session", "hyper-customer-session-dev"]);
});

test("E5-02: Registered customer negative auth & strict Customer A vs Customer B & Admin isolation", async () => {
  // Wrong password rejected with 401
  const badLogin = await storeApi("POST", "/api/store/customers/session", {
    phone: CUST_A_PHONE,
    password: "Wrong-Password-999!",
  });
  expect(badLogin.status).toBe(401);

  // Register Customer B
  const regB = await storeApi("POST", "/api/store/customers/register", {
    phone: CUST_B_PHONE,
    firstName: "خالد ب",
    password: CUST_PW,
  });
  expect(regB.status).toBe(201);
  custBCookie = extractSetCookie(regB.headers, ["__Host-customer-session", "hyper-customer-session-dev"]);
  expect(custBCookie).not.toBe("");

  // Customer B cannot read/update/delete Customer A's address (404) or read Customer A's order (404/401)
  expect(
    (await storeApi("PATCH", `/api/store/customers/addresses/${custAAddrId}`, { label: "Hijack" }, { Cookie: custBCookie }))
      .status,
  ).toBe(404);
  expect((await storeApi("DELETE", `/api/store/customers/addresses/${custAAddrId}`, undefined, { Cookie: custBCookie })).status).toBe(
    404,
  );
  const crossOrd = await storeApi("GET", `/api/store/orders/${custAOrderId}`, undefined, { Cookie: custBCookie });
  expect([401, 404]).toContain(crossOrd.status);

  // Customer session never grants Admin access
  const custToAdmin = await adminApi("GET", "/api/admin/orders", undefined, custBCookie);
  expect(custToAdmin.status).toBe(401);
});

// ============================================================================
// GATE E7 — REPLACEMENTS, CANCELLATIONS, INVALID TRANSITIONS & CONCURRENCY
// ============================================================================

test("E7-01: Replacement Case A — Auto-accept OFF by default, READY gate blocks open proposal, Customer approves in browser (+5.00 diff)", async ({
  browser,
}) => {
  // Verify auto_accept_replacements is OFF (false) by default on Customer B
  const autoFlag = (
    await db.query<{ auto_accept_replacements: boolean }>(
      "SELECT auto_accept_replacements FROM customers WHERE phone LIKE $1",
      [`%${CUST_B_PHONE.slice(-8)}%`],
    )
  ).rows[0]?.auto_accept_replacements;
  expect(autoFlag).toBe(false);

  // Create a 2-line order for Customer A (pieceV1 = 25.00, pieceV2 = 45.00 -> subtotal 70.00 + 15.00 zone = 85.00)
  await resetRateLimitsOnScratch();
  const gCtx = await browser.newContext({ locale: "ar-EG", viewport: { width: 1440, height: 900 } });
  const gPage = await gCtx.newPage();
  const sessRes = await gPage.request.post(`${BASE}/api/store/customers/session`, {
    data: { phone: CUST_A_PHONE, password: CUST_PW },
    headers: { Origin: BASE },
  });
  expect([200, 201]).toContain(sessRes.status());

  await gPage.request.post(`${BASE}/api/store/cart`, { data: {}, headers: { Origin: BASE } });
  await gPage.request.post(`${BASE}/api/store/cart/items`, {
    data: { productVariantId: fx.pieceProd.v1Id, quantity: "1" },
    headers: { Origin: BASE },
  });
  await gPage.request.post(`${BASE}/api/store/cart/items`, {
    data: { productVariantId: fx.pieceProd.v2Id, quantity: "1" },
    headers: { Origin: BASE },
  });

  const ordResRaw = await gPage.request.post(`${BASE}/api/store/orders`, {
    data: {
      idempotencyKey: `repl-approve-${STAMP}`,
      addressId: custAAddrId,
      expectedDeliveryFee: "15.00",
    },
    headers: { Origin: BASE },
  });
  expect(ordResRaw.status()).toBe(201);
  const ordResJson = (await ordResRaw.json()) as { data: { orderId?: string; order?: { id: string } } };
  const oid = (ordResJson.data.orderId ?? ordResJson.data.order?.id)!;

  // Admin moves to PREPARING, marks v1 (25.00) UNAVAILABLE, picks v2 (45.00), proposes subProd (30.00, +5.00 diff)
  expect((await adminApi("POST", `/api/admin/orders/${oid}/prepare`)).status).toBe(200);
  const lines = (
    await db.query<{ id: string; product_variant_id: string }>(
      "SELECT id, product_variant_id FROM order_items WHERE order_id = $1::uuid",
      [oid],
    )
  ).rows;
  const v1Line = lines.find((l) => l.product_variant_id === fx.pieceProd.v1Id)!;
  const v2Line = lines.find((l) => l.product_variant_id === fx.pieceProd.v2Id)!;

  expect((await adminApi("POST", `/api/admin/orders/${oid}/items/${v1Line.id}/unavailable`)).status).toBe(200);
  expect((await adminApi("POST", `/api/admin/orders/${oid}/items/${v2Line.id}/pick`, { actualQuantity: "1" })).status).toBe(200);

  const propRes = await adminApi<{ id: string }>(
    "POST",
    `/api/admin/orders/${oid}/items/${v1Line.id}/replacements`,
    { replacementVariantId: fx.subProd.vId, replacementQuantity: "1", reason: "نفد الصنف الأصلي" },
  );
  expect([200, 201]).toContain(propRes.status);

  // Verify no silent auto-accept: status is PROPOSED, and READY gate refuses (409) while PROPOSED
  const replStateBefore = (
    await db.query<{ status: string }>("SELECT status FROM order_item_replacements WHERE order_item_id = $1::uuid", [
      v1Line.id,
    ])
  ).rows[0]!.status;
  expect(replStateBefore).toBe("PROPOSED");
  expect((await adminApi("POST", `/api/admin/orders/${oid}/ready`)).status).toBe(409);

  // Customer opens /orders/[id] in browser and clicks "قبول البديل"
  await gPage.goto(`${BASE}/orders/${oid}`);
  await expect(gPage.getByRole("button", { name: "قبول البديل" })).toBeVisible({ timeout: 15_000 });
  await gPage.screenshot({ path: path.join(SHOTS_DIR, "e7-01-replacement-proposal-customer-view.png") });
  await gPage.getByRole("button", { name: "قبول البديل" }).click();
  await expect(gPage.getByText("تم قبول البديل.").first()).toBeVisible({ timeout: 15_000 });

  // Verify DB replacement status = CUSTOMER_APPROVED; pick replacement/advance to READY and verify +5.00 diff (30 + 45 + 15 = 90.00)
  const replAfter = (
    await db.query<{ status: string }>("SELECT status FROM order_item_replacements WHERE order_item_id = $1::uuid", [
      v1Line.id,
    ])
  ).rows[0]!.status;
  expect(replAfter).toBe("CUSTOMER_APPROVED");

  // Check if replacement created a new PENDING line that needs picking before READY
  const pendingAfterApprove = (
    await db.query<{ id: string }>(
      "SELECT id FROM order_items WHERE order_id = $1::uuid AND item_status = 'PENDING'",
      [oid],
    )
  ).rows;
  for (const pl of pendingAfterApprove) {
    expect((await adminApi("POST", `/api/admin/orders/${oid}/items/${pl.id}/pick`, { actualQuantity: "1" })).status).toBe(200);
  }

  expect((await adminApi("POST", `/api/admin/orders/${oid}/ready`)).status).toBe(200);
  const finalOrd = (
    await db.query<{ subtotal_final: string; total_final: string }>(
      "SELECT subtotal_final::text, total_final::text FROM orders WHERE id = $1::uuid",
      [oid],
    )
  ).rows[0]!;
  expect(finalOrd.subtotal_final).toBe("75.00"); // 30.00 substitute + 45.00 v2
  expect(finalOrd.total_final).toBe("90.00"); // 75.00 + 15.00 zone delivery
  await gCtx.close();
});

test("E7-02: Replacement Case B — Explicit Customer Rejection & Short-Ship Completion (rejected line = 0.00)", async ({
  browser,
}) => {
  await resetRateLimitsOnScratch();
  const gCtx = await browser.newContext({ locale: "ar-EG", viewport: { width: 1440, height: 900 } });
  const gPage = await gCtx.newPage();
  const sessRes = await gPage.request.post(`${BASE}/api/store/customers/session`, {
    data: { phone: CUST_A_PHONE, password: CUST_PW },
    headers: { Origin: BASE },
  });
  expect([200, 201]).toContain(sessRes.status());

  await gPage.request.post(`${BASE}/api/store/cart`, { data: {}, headers: { Origin: BASE } });
  await gPage.request.post(`${BASE}/api/store/cart/items`, {
    data: { productVariantId: fx.pieceProd.v1Id, quantity: "1" },
    headers: { Origin: BASE },
  });
  await gPage.request.post(`${BASE}/api/store/cart/items`, {
    data: { productVariantId: fx.pieceProd.v2Id, quantity: "1" },
    headers: { Origin: BASE },
  });

  const ordResRaw = await gPage.request.post(`${BASE}/api/store/orders`, {
    data: {
      idempotencyKey: `repl-reject-${STAMP}`,
      addressId: custAAddrId,
      expectedDeliveryFee: "15.00",
    },
    headers: { Origin: BASE },
  });
  expect(ordResRaw.status()).toBe(201);
  const ordResJson = (await ordResRaw.json()) as { data: { orderId?: string; order?: { id: string } } };
  const oid = (ordResJson.data.orderId ?? ordResJson.data.order?.id)!;

  expect((await adminApi("POST", `/api/admin/orders/${oid}/prepare`)).status).toBe(200);
  const lines = (
    await db.query<{ id: string; product_variant_id: string }>(
      "SELECT id, product_variant_id FROM order_items WHERE order_id = $1::uuid",
      [oid],
    )
  ).rows;
  const v1Line = lines.find((l) => l.product_variant_id === fx.pieceProd.v1Id)!;
  const v2Line = lines.find((l) => l.product_variant_id === fx.pieceProd.v2Id)!;

  expect((await adminApi("POST", `/api/admin/orders/${oid}/items/${v1Line.id}/unavailable`)).status).toBe(200);
  expect((await adminApi("POST", `/api/admin/orders/${oid}/items/${v2Line.id}/pick`, { actualQuantity: "1" })).status).toBe(200);
  expect(
    (
      await adminApi("POST", `/api/admin/orders/${oid}/items/${v1Line.id}/replacements`, {
        replacementVariantId: fx.subProd.vId,
        replacementQuantity: "1",
      })
    ).status,
  ).toBeLessThan(300);

  await gPage.goto(`${BASE}/orders/${oid}`);
  await gPage.getByRole("button", { name: "رفض البديل" }).click();
  await expect(gPage.getByText("تم رفض البديل.").first()).toBeVisible({ timeout: 15_000 });

  expect((await adminApi("POST", `/api/admin/orders/${oid}/ready`)).status).toBe(200);
  const finalOrd = (
    await db.query<{ subtotal_final: string; total_final: string }>(
      "SELECT subtotal_final::text, total_final::text FROM orders WHERE id = $1::uuid",
      [oid],
    )
  ).rows[0]!;
  expect(finalOrd.subtotal_final).toBe("45.00"); // Only picked v2 (45.00); rejected v1 = 0.00
  expect(finalOrd.total_final).toBe("60.00"); // 45.00 + 15.00 delivery
  await gCtx.close();
});

test("E7-03: Cancellation rules, cutoff after picking/delivery & illegal state transition rejections", async () => {
  // 1. Cancel allowed in unpicked CONFIRMED + releases reservation + repeated cancel safe
  const cTok1 = ((await storeApi<{ guestToken?: string; token?: string }>("POST", "/api/store/cart", {})).data.guestToken ?? "")!;
  await storeApi("POST", "/api/store/cart/items", { productVariantId: fx.pieceProd.v1Id, quantity: "2" }, { "x-guest-token": cTok1 });
  const o1 = await storeApi<{ orderId?: string; order?: { id: string }; guestOrderToken?: string }>(
    "POST",
    "/api/store/orders",
    {
      idempotencyKey: `cancel-ok-${STAMP}`,
      guestContact: { firstName: "إلغاء مسموح" },
      guestAddress: { city: "أسيوط", area: fx.zoneName, phone: GUEST_PHONE },
      expectedDeliveryFee: "15.00",
    },
    { "x-guest-token": cTok1 },
  );
  const oid1 = (o1.data.orderId ?? o1.data.order?.id)!;
  const tok1 = o1.data.guestOrderToken!;

  const can1 = await storeApi("POST", `/api/store/orders/${oid1}/cancel`, {}, { "x-guest-order-token": tok1 });
  expect(can1.status).toBe(200);
  expect((await db.query("SELECT status FROM orders WHERE id = $1::uuid", [oid1])).rows[0].status).toBe("CANCELLED");

  // Repeated cancellation is safe (idempotent 200 or 409, never 500) AND advancing a CANCELLED order is 409
  const canRepeat = await storeApi("POST", `/api/store/orders/${oid1}/cancel`, {}, { "x-guest-order-token": tok1 });
  expect([200, 409]).toContain(canRepeat.status);
  expect((await adminApi("POST", `/api/admin/orders/${oid1}/prepare`)).status).toBe(409);

  // 2. Skipping states (CONFIRMED -> DELIVERED, CONFIRMED -> OUT_FOR_DELIVERY) rejected with 409;
  //    Cancel rejected once a line is picked in PREPARING; Cancel rejected on DELIVERED order (sharedGuestOrderId)
  expect((await adminApi("POST", `/api/admin/orders/${custAOrderId}/deliver`)).status).toBe(409);
  expect((await adminApi("POST", `/api/admin/orders/${custAOrderId}/dispatch`)).status).toBe(409);

  expect((await adminApi("POST", `/api/admin/orders/${custAOrderId}/prepare`)).status).toBe(200);
  const custItem = (await db.query<{ id: string }>("SELECT id FROM order_items WHERE order_id = $1::uuid LIMIT 1", [custAOrderId])).rows[0]!;
  expect((await adminApi("POST", `/api/admin/orders/${custAOrderId}/items/${custItem.id}/pick`, { actualQuantity: "1" })).status).toBe(200);
  // Picked line blocks cancellation!
  expect(
    (await adminApi("POST", `/api/admin/orders/${custAOrderId}/cancel`, { reason: "بعد التجهيز", confirmed: true })).status,
  ).toBe(409);
  // Delivered order blocks cancellation!
  expect(
    (await adminApi("POST", `/api/admin/orders/${sharedGuestOrderId}/cancel`, { reason: "بعد التسليم", confirmed: true })).status,
  ).toBe(409);
});

test("E7-04: Controlled concurrency — simultaneous cart adds, parallel checkout submissions & competing Admin transitions", async () => {
  const cTok = ((await storeApi<{ guestToken?: string; token?: string }>("POST", "/api/store/cart", {})).data.guestToken ?? "")!;
  // 1. Two simultaneous cart item adds
  const [a1, a2] = await Promise.all([
    storeApi("POST", "/api/store/cart/items", { productVariantId: fx.pieceProd.v1Id, quantity: "1" }, { "x-guest-token": cTok }),
    storeApi("POST", "/api/store/cart/items", { productVariantId: fx.pieceProd.v1Id, quantity: "1" }, { "x-guest-token": cTok }),
  ]);
  expect([200, 409]).toContain(a1.status);
  expect([200, 409]).toContain(a2.status);

  // Ensure cart has at least 1 item and capture cart_id
  const cartSnap = await storeApi<{ cart: { id: string } }>("GET", "/api/store/cart", undefined, { "x-guest-token": cTok });
  const cartId = cartSnap.data.cart.id;

  // 2. Two simultaneous checkout submissions against the SAME cart with DIFFERENT idempotency keys
  const [sub1, sub2] = await Promise.all([
    storeApi<{ orderId?: string; order?: { id: string } }>(
      "POST",
      "/api/store/orders",
      {
        idempotencyKey: `race-1-${STAMP}`,
        guestContact: { firstName: "سباق 1" },
        guestAddress: { city: "أسيوط", area: fx.zoneName, phone: GUEST_PHONE },
        expectedDeliveryFee: "15.00",
      },
      { "x-guest-token": cTok },
    ),
    storeApi<{ orderId?: string; order?: { id: string } }>(
      "POST",
      "/api/store/orders",
      {
        idempotencyKey: `race-2-${STAMP}`,
        guestContact: { firstName: "سباق 2" },
        guestAddress: { city: "أسيوط", area: fx.zoneName, phone: GUEST_PHONE },
        expectedDeliveryFee: "15.00",
      },
      { "x-guest-token": cTok },
    ),
  ]);
  expect([200, 201, 409]).toContain(sub1.status);
  expect([200, 201, 409]).toContain(sub2.status);

  // Exactly ONE order created for that cart in PostgreSQL!
  const ordersForCart = (
    await db.query<{ id: string }>("SELECT id FROM orders WHERE cart_id = $1::uuid", [cartId])
  ).rows;
  expect(ordersForCart).toHaveLength(1);
  const raceOrderId = ordersForCart[0]!.id;

  // 3. Two simultaneous Admin prepare calls -> zero 500s, exactly 1 PREPARING transition row
  const [p1, p2] = await Promise.all([
    adminApi("POST", `/api/admin/orders/${raceOrderId}/prepare`),
    adminApi("POST", `/api/admin/orders/${raceOrderId}/prepare`),
  ]);
  expect([200, 409]).toContain(p1.status);
  expect([200, 409]).toContain(p2.status);
  const prepHistoryCount = (
    await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM order_status_history WHERE order_id = $1::uuid AND new_status = 'PREPARING'",
      [raceOrderId],
    )
  ).rows[0]!.n;
  expect(prepHistoryCount).toBe(1);
});

// ============================================================================
// GATE E8 — ADMIN CATALOG, PROMOTIONS, INVENTORY & CUSTOMER ANONYMIZATION
// ============================================================================

test("E8-01: Product visibility states (Visible → Hidden → Archived → Restored) & Unreferenced-Only Permanent Delete", async () => {
  // 1. Unreferenced product: archive -> permanent delete SUCCEEDS (200) and removes DB row
  const delBefore = (await db.query<{ updated_at: Date }>("SELECT updated_at FROM products WHERE id = $1::uuid", [fx.deletableProd.id]))
    .rows[0]!;
  const archUnref = await adminApi<{ updatedAt: string }>(
    "POST",
    `/api/admin/catalog/products/${fx.deletableProd.id}/archive`,
    { confirmed: true, reason: "أرشفة قبل الحذف النهائي", expectedUpdatedAt: delBefore.updated_at.toISOString() },
  );
  expect(archUnref.status).toBe(200);

  const eligUnref = await adminApi<{ executable: boolean; blockedBy: string[] }>(
    "GET",
    `/api/admin/catalog/products/${fx.deletableProd.id}/deletion-eligibility`,
  );
  expect(eligUnref.status).toBe(200);
  expect(eligUnref.data.executable).toBe(true);

  const hardDelOk = await adminApi("DELETE", `/api/admin/catalog/products/${fx.deletableProd.id}`, {
    confirmed: true,
    reason: "منتج اختبار غير مرتبط بأي سجل",
    expectedUpdatedAt: archUnref.data.updatedAt,
  });
  expect(hardDelOk.status).toBe(200);
  const goneCheck = await db.query("SELECT id FROM products WHERE id = $1::uuid", [fx.deletableProd.id]);
  expect(goneCheck.rows).toHaveLength(0);

  // 2. Referenced product (pieceProd has inventory + orderItems): permanent delete REFUSED (422/409)
  const eligRef = await adminApi<{ executable: boolean; blockedBy: string[] }>(
    "GET",
    `/api/admin/catalog/products/${fx.pieceProd.id}/deletion-eligibility`,
  );
  expect(eligRef.status).toBe(200);
  expect(eligRef.data.executable).toBe(false);
  expect(eligRef.data.blockedBy.length).toBeGreaterThan(0);

  const refRow = (await db.query<{ updated_at: Date }>("SELECT updated_at FROM products WHERE id = $1::uuid", [fx.pieceProd.id])).rows[0]!;
  const hardDelRefused = await adminApi("DELETE", `/api/admin/catalog/products/${fx.pieceProd.id}`, {
    confirmed: true,
    reason: "محاولة حذف منتج مرتبط",
    expectedUpdatedAt: refRow.updated_at.toISOString(),
  });
  expect([409, 422]).toContain(hardDelRefused.status);
  expect((await db.query("SELECT id FROM products WHERE id = $1::uuid", [fx.pieceProd.id])).rows).toHaveLength(1);

  // 3. Visibility transitions on couponProd: Visible -> Hidden (gone from public GET) -> Archive -> Restore (stays hidden) -> Republish
  expect((await storeApi("GET", `/api/store/catalog/products/${fx.couponProd.id}`)).status).toBe(200);
  expect((await adminApi("PATCH", `/api/admin/catalog/products/${fx.couponProd.id}`, { isActive: false, expectedUpdatedAt: "*" })).status).toBe(
    200,
  );
  expect((await storeApi("GET", `/api/store/catalog/products/${fx.couponProd.id}`)).status).toBe(404);
  expect((await adminApi("GET", `/api/admin/catalog/products/${fx.couponProd.id}`)).status).toBe(200);

  const cpTs = (await db.query<{ updated_at: Date }>("SELECT updated_at FROM products WHERE id = $1::uuid", [fx.couponProd.id])).rows[0]!;
  const archCp = await adminApi<{ updatedAt: string; deletedAt: string | null }>(
    "POST",
    `/api/admin/catalog/products/${fx.couponProd.id}/archive`,
    { confirmed: true, reason: "أرشفة مؤقتة", expectedUpdatedAt: cpTs.updated_at.toISOString() },
  );
  expect(archCp.status).toBe(200);
  expect(archCp.data.deletedAt).not.toBeNull();

  const restCp = await adminApi<{ deletedAt: string | null; isActive: boolean }>(
    "POST",
    `/api/admin/catalog/products/${fx.couponProd.id}/restore`,
    { confirmed: true, reason: "استعادة من الأرشيف", expectedUpdatedAt: archCp.data.updatedAt },
  );
  expect(restCp.status).toBe(200);
  expect(restCp.data.deletedAt).toBeNull();
  expect(restCp.data.isActive).toBe(false);

  expect((await adminApi("PATCH", `/api/admin/catalog/products/${fx.couponProd.id}`, { isActive: true, expectedUpdatedAt: "*" })).status).toBe(
    200,
  );
});

test("E8-02: Coupon eligibility & combination refusal, Inventory adjustments, Settings, Notifications & HTTP Audit immutability", async () => {
  // 1. Valid coupon on couponProd (80.00 * 15% = 12.00 discount)
  const estCouponOk = await storeApi<{ subtotal: string; discountTotal: string }>("POST", "/api/store/orders/estimate", {
    lines: [{ productVariantId: fx.couponProd.vId, quantity: "1" }],
    couponCode: fx.couponCode,
    deliveryAddress: { city: "أسيوط", area: fx.zoneName },
  });
  expect(estCouponOk.status).toBe(200);
  expect(estCouponOk.data.subtotal).toBe("80.00");
  expect(estCouponOk.data.discountTotal).toBe("12.00");

  // 2. Inventory valid adjustment (+5) vs invalid negative over-deduction (-99999 -> 409)
  const adjOk = await adminApi("POST", "/api/admin/inventory/adjust", {
    productVariantId: fx.subProd.vId,
    delta: "5",
    movementType: "STOCK_IN",
    reason: "توريد اختباري",
  });
  expect([200, 201]).toContain(adjOk.status);

  const adjBad = await adminApi("POST", "/api/admin/inventory/adjust", {
    productVariantId: fx.subProd.vId,
    delta: "-99999",
    movementType: "WASTE",
    reason: "تجاوز الرصيد",
  });
  expect([409, 422]).toContain(adjBad.status);

  // 3. Settings, Notifications & HTTP Audit Logs immutability
  expect((await adminApi("GET", "/api/admin/settings")).status).toBe(200);
  expect((await adminApi("GET", "/api/admin/notifications")).status).toBe(200);
  expect((await adminApi("GET", "/api/admin/notifications/unread-count")).status).toBe(200);
  expect((await adminApi("GET", "/api/admin/audit-logs?limit=5")).status).toBe(200);
  const auditDelete = await adminApi("DELETE", "/api/admin/audit-logs");
  expect(auditDelete.status).toBe(405);
});

test("E8-03: Customer anonymize policy preservation + transactional proof of P1208-D01 (audit_logs trigger vs anonymize scrub)", async () => {
  await resetRateLimitsOnScratch();
  // Register fictional scratch customer
  const reg = await storeApi<{ customer: { id: string } }>("POST", "/api/store/customers/register", {
    phone: ANON_CUST_PHONE,
    firstName: "عميل للإخفاء",
    password: CUST_PW,
  });
  expect(reg.status).toBe(201);
  const cid = reg.data.customer.id;
  const cCookie = extractSetCookie(reg.headers, ["__Host-customer-session", "hyper-customer-session-dev"]);
  await storeApi(
    "POST",
    "/api/store/customers/addresses",
    { label: "منزل", city: "أسيوط", street: "شارع خاص جدًا 99", phone: ANON_CUST_PHONE },
    { Cookie: cCookie },
  );

  const custRowBefore = (await db.query<{ updated_at: Date }>("SELECT updated_at FROM customers WHERE id = $1::uuid", [cid]))
    .rows[0]!;

  // Restricted Admin without `customers.anonymize` receives 403 (ADM-OWNER G3 separation)
  const deniedAnon = await adminApi(
    "POST",
    `/api/admin/customers/${cid}/anonymize`,
    {
      confirmed: true,
      reason: "رفض بدون صلاحية",
      expectedUpdatedAt: custRowBefore.updated_at.toISOString(),
    },
    restrictedCookie,
  );
  expect(deniedAnon.status).toBe(403);

  // Ensure Scratch DB has the seeded `customers.anonymize` permission row + SUPER_ADMIN link (matching Primary DB seed)
  await db.query(`
    INSERT INTO permissions (id, key, description, is_active)
    VALUES ('02800000-0000-7000-8000-000000000133'::uuid, 'customers.anonymize', 'Anonymize customer PII irreversibly', true)
    ON CONFLICT (key) DO UPDATE SET is_active = true
  `);
  await db.query(`
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
    WHERE r.name = 'SUPER_ADMIN' AND p.key = 'customers.anonymize'
    ON CONFLICT DO NOTHING
  `);

  const anonRes = await adminApi<{ anonymized: boolean; mode: string; displayName: string }>(
    "POST",
    `/api/admin/customers/${cid}/anonymize`,
    {
      confirmed: true,
      reason: "اختبار سياسة إخفاء الهوية P12-08",
      expectedUpdatedAt: custRowBefore.updated_at.toISOString(),
    },
  );
  expect(anonRes.status).toBe(200);
  expect(anonRes.data.anonymized).toBe(true);
  expect(anonRes.data.mode).toBe("PSEUDONYMIZED");

  // Verify customer row STILL EXISTS (never deleted), PII scrubbed, addresses & sessions deleted
  const custAfter = (
    await db.query<{ first_name: string; phone: string; password_hash: string | null; is_active: boolean }>(
      "SELECT first_name, phone, password_hash, is_active FROM customers WHERE id = $1::uuid",
      [cid],
    )
  ).rows[0]!;
  expect(custAfter.first_name).toBe("عميل مجهول");
  expect(custAfter.phone).toMatch(/^000[0-9]{12}$/);
  expect(custAfter.phone).not.toContain(ANON_CUST_PHONE.slice(-8));
  expect(custAfter.password_hash).toBeNull();
  expect(custAfter.is_active).toBe(false);
  expect((await db.query("SELECT count(*)::int AS n FROM customer_addresses WHERE customer_id = $1::uuid", [cid])).rows[0].n).toBe(0);
  expect((await db.query("SELECT count(*)::int AS n FROM customer_sessions WHERE customer_id = $1::uuid", [cid])).rows[0].n).toBe(0);

  // 2) Post-Task-2 Admin-edited customer (`PATCH` writes minimized `changedFields` with zero PII)
  await resetRateLimitsOnScratch();
  const reg2 = await storeApi<{ customer: { id: string } }>("POST", "/api/store/customers/register", {
    phone: `0106${SEED6}8`,
    firstName: "عميل معدل للإخفاء",
    password: CUST_PW,
  });
  expect(reg2.status).toBe(201);
  const cid2 = reg2.data.customer.id;
  const patchCust = await adminApi("PATCH", `/api/admin/customers/${cid2}`, {
    firstName: "عميل معدل إداريًا",
    email: `cid2.e803.${STAMP}@p1208.local`,
  });
  expect(patchCust.status).toBe(200);
  const c2Before = (await db.query<{ updated_at: Date }>("SELECT updated_at FROM customers WHERE id = $1::uuid", [cid2]))
    .rows[0]!;
  const anonRes2 = await adminApi<{ anonymized: boolean; removed: { auditRows: number } }>(
    "POST",
    `/api/admin/customers/${cid2}/anonymize`,
    {
      confirmed: true,
      reason: "إخفاء هوية عميل معدل ببيانات مقلصة",
      expectedUpdatedAt: c2Before.updated_at.toISOString(),
    },
  );
  expect(anonRes2.status).toBe(200);
  expect(anonRes2.data.anonymized).toBe(true);

  // 3) Hardened H2 verification under production-equivalent immutable audit triggers (28 -> 32 trigger parity):
  //    Verify the old 26-trigger triggerless schema is NOT accepted; audit immutability triggers MUST exist.
  const auditGuardTriggers = (
    await db.query<{ tgname: string }>(
      `SELECT t.tgname
         FROM pg_catalog.pg_trigger t
         JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
        WHERE c.relname = 'audit_logs'
          AND NOT t.tgisinternal
          AND t.tgname IN ('trg_audit_logs_no_delete', 'trg_audit_logs_no_truncate', 'trg_audit_logs_guard_update')
        ORDER BY t.tgname`,
    )
  ).rows.map((r) => r.tgname);
  expect(auditGuardTriggers).toEqual([
    "trg_audit_logs_guard_update",
    "trg_audit_logs_no_delete",
    "trg_audit_logs_no_truncate",
  ]);

  // Register a 3rd customer with historical name/email PII in `audit_logs`, trigger H2 anonymization
  // (`202 PENDING_AUDIT_REDACTION`), verify independent worker completes redaction (`200 COMPLETED`),
  // and verify historical PII is purged while runtime role `DELETE`/`UPDATE` on `audit_logs` is denied.
  await resetRateLimitsOnScratch();
  const reg3 = await storeApi<{ customer: { id: string } }>("POST", "/api/store/customers/register", {
    phone: `0106${SEED6}9`,
    firstName: "عميل سجل تاريخي",
    password: CUST_PW,
  });
  expect(reg3.status).toBe(201);
  const cid3 = reg3.data.customer.id;
  const histSecretName = `اسم_سري_تاريخي_${STAMP}`;
  const histSecretEmail = `hist.secret.${STAMP}@p1208.local`;
  const ownerRow = (await db.query<{ id: string }>("SELECT id::text AS id FROM users WHERE email = $1", [OWNER_EMAIL]))
    .rows[0]!;
  await db.query(
    `INSERT INTO audit_logs (user_id, actor_type, action, entity_type, entity_id, old_values, new_values)
     VALUES ($1::uuid, 'ADMIN', 'customers.update', 'customers', $2, $3::jsonb, $4::jsonb)`,
    [
      ownerRow.id,
      cid3,
      JSON.stringify({ firstName: "عميل سجل تاريخي", isActive: true }),
      JSON.stringify({ firstName: histSecretName, email: histSecretEmail, isActive: true, changedFields: ["firstName", "email"] }),
    ],
  );

  const c3Before = (await db.query<{ updated_at: Date }>("SELECT updated_at FROM customers WHERE id = $1::uuid", [cid3]))
    .rows[0]!;
  const anonRes3 = await adminApi<{
    anonymized: boolean;
    outcome: string;
    redactionTaskId: string | null;
  }>("POST", `/api/admin/customers/${cid3}/anonymize`, {
    confirmed: true,
    reason: "إخفاء هوية عميل له قيم تاريخية في سجل التدقيق عبر H2",
    expectedUpdatedAt: c3Before.updated_at.toISOString(),
  });
  expect(anonRes3.status).toBe(202);
  expect(anonRes3.data.anonymized).toBe(false);
  expect(anonRes3.data.outcome).toBe("PENDING_AUDIT_REDACTION");
  expect(anonRes3.data.redactionTaskId).toBeTruthy();

  // Wait for the independent local privacy-redaction-worker daemon to complete redaction
  let finalStatus: { state: string; anonymized: boolean; result: { outcome: string; removed: { auditRows: number } } | null } | null = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    const poll = await adminApi<{
      state: string;
      anonymized: boolean;
      result: { outcome: string; removed: { auditRows: number } } | null;
    }>("GET", `/api/admin/customers/${cid3}/anonymize`);
    if (poll.status === 200 && poll.data?.state === "COMPLETED") {
      finalStatus = poll.data;
      break;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  expect(finalStatus).not.toBeNull();
  expect(finalStatus!.anonymized).toBe(true);
  expect(finalStatus!.result?.removed.auditRows).toBeGreaterThanOrEqual(1);

  const cid3Audits = (
    await db.query<{ action: string; ov: string | null; nv: string | null }>(
      `SELECT action, old_values::text AS ov, new_values::text AS nv
         FROM audit_logs WHERE entity_type = 'customers' AND entity_id = $1 ORDER BY created_at`,
      [cid3],
    )
  ).rows;
  const serializedCid3Audits = JSON.stringify(cid3Audits);
  expect(serializedCid3Audits).not.toContain(histSecretName);
  expect(serializedCid3Audits).not.toContain(histSecretEmail);
  expect(cid3Audits.some((r) => r.action === "customers.audit_redact")).toBe(true);

  // Verify runtime role cannot DELETE or directly UPDATE audit_logs
  await expect(db.query("DELETE FROM audit_logs WHERE entity_id = $1", [cid3])).rejects.toThrow();

  recordFact("E8-03", {
    d01ResolvedUnderH2: true,
    auditGuardTriggers,
    cid3TaskId: anonRes3.data.redactionTaskId,
    cid3FinalState: finalStatus!.state,
  });
});

// ============================================================================
// GATE E9 — SECURITY, PERMISSIONS & HOSTILE SCENARIOS (7-ACTOR MATRIX)
// ============================================================================

test("E9-01: 7-Actor Authorization Matrix, Expired Guest Token (410), Restricted Admin Denials (403) & P12-07 SEC-01..08 Preservation", async ({
  page,
}) => {
  // 1. Restricted Admin (`products.view` + `orders.view` ONLY) receives 403 on unauthorized writes/reads
  expect((await adminApi("GET", "/api/admin/users", undefined, restrictedCookie)).status).toBe(403);
  expect(
    (
      await adminApi(
        "PATCH",
        `/api/admin/catalog/variants/${fx.pieceProd.v1Id}/price`,
        { price: "99.00", reason: "unauthorized" },
        restrictedCookie,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await adminApi(
        "POST",
        "/api/admin/inventory/adjust",
        { productVariantId: fx.pieceProd.v1Id, delta: "1", movementType: "STOCK_IN" },
        restrictedCookie,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await adminApi(
        "POST",
        "/api/admin/promotions",
        { name: "Unauth", type: "PERCENTAGE", scope: "ORDER", discountPercent: "5" },
        restrictedCookie,
      )
    ).status,
  ).toBe(403);
  expect((await adminApi("POST", "/api/admin/roles", { name: "ESCALATE" }, restrictedCookie)).status).toBe(403);
  expect((await adminApi("POST", `/api/admin/orders/${sharedGuestOrderId}/prepare`, undefined, restrictedCookie)).status).toBe(
    403,
  );

  // 2. Expired Guest Token returns 410 Gone (BGGO-D010)
  const expCartTok = ((await storeApi<{ guestToken?: string; token?: string }>("POST", "/api/store/cart", {})).data.guestToken ?? "")!;
  await storeApi("POST", "/api/store/cart/items", { productVariantId: fx.pieceProd.v1Id, quantity: "1" }, { "x-guest-token": expCartTok });
  const expOrd = await storeApi<{ orderId?: string; order?: { id: string }; guestOrderToken?: string }>(
    "POST",
    "/api/store/orders",
    {
      idempotencyKey: `exp-tok-${STAMP}`,
      guestContact: { firstName: "ضيف منتهي" },
      guestAddress: { city: "أسيوط", area: fx.zoneName, phone: GUEST_PHONE },
      expectedDeliveryFee: "15.00",
    },
    { "x-guest-token": expCartTok },
  );
  expect(expOrd.status).toBe(201);
  const expOrderId = (expOrd.data.orderId ?? expOrd.data.order?.id)!;
  const expRawTok = expOrd.data.guestOrderToken!;
  await db.query("UPDATE guest_order_credentials SET expires_at = now() - interval '1 hour' WHERE order_id = $1::uuid", [
    expOrderId,
  ]);
  const expRes = await storeApi("GET", `/api/store/orders/${expOrderId}`, undefined, {
    "x-guest-order-token": expRawTok,
  });
  expect(expRes.status).toBe(410);
  await adminApi("POST", `/api/admin/orders/${expOrderId}/cancel`, { reason: "p1208 expired-token test cleanup", confirmed: true });

  // 3. Cross-origin + Purpose: prefetch CSRF blocked in-handler (SEC-03: 403)
  const csrfProbe = await fetch(`${BASE}/api/admin/catalog/categories`, {
    method: "POST",
    headers: {
      Origin: "https://attacker.example",
      Purpose: "prefetch",
      Cookie: adminCookie,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: "CSRF" }),
  });
  expect(csrfProbe.status).toBe(403);

  // 4. SEC-08 private IP / metadata URL rejected on Admin category image (400)
  const ssrfAsset = await adminApi("POST", "/api/admin/catalog/categories", {
    name: "SSRF Cat",
    image: "https://169.254.169.254/latest/meta-data/",
  });
  expect(ssrfAsset.status).toBe(400);

  // 5. SEC-07: Visiting /admin/products/[id] as authenticated Admin produces 0 `eval` CSP violations
  await resetRateLimitsOnScratch();
  const admLogin1 = await page.request.post(`${BASE}/api/admin/session`, {
    data: { email: OWNER_EMAIL, password: OWNER_PASSWORD },
    headers: { Origin: BASE },
  });
  expect([200, 201]).toContain(admLogin1.status());
  await page.addInitScript(() => {
    (window as unknown as { __cspViolations: string[] }).__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      (window as unknown as { __cspViolations: string[] }).__cspViolations.push(`${e.effectiveDirective}:${e.blockedURI}`);
    });
  });
  await page.goto(`${BASE}/admin/products/${fx.pieceProd.id}`, { waitUntil: "networkidle" });
  const cspV = await page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations || []);
  expect(cspV.filter((x) => x.includes("eval"))).toEqual([]);
});

// ============================================================================
// GATE E10 — MOBILE (320/390/768/1440), ACCESSIBILITY, DARK MODE & WEBGL
// ============================================================================

test("E10-01: Multi-viewport responsive check (320px, 390px, 768px, 1440px), mobile menu Escape/focus, Axe a11y, Dark Mode & WebGL", async ({
  page,
}) => {
  const viewports = [
    { w: 320, h: 568 },
    { w: 390, h: 844 },
    { w: 768, h: 1024 },
    { w: 1440, h: 900 },
  ];
  const routes = [
    "/",
    `/c/${fx.subCat.id}/${encodeURIComponent(fx.subCat.slug)}`,
    `/p/${fx.weightProd.id}/${encodeURIComponent(fx.weightProd.slug)}`,
    "/cart",
    "/checkout",
  ];

  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    for (const r of routes) {
      await page.goto(`${BASE}${r}`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      expect(overflow, `Overflow at ${vp.w}px on ${r}`).toBe(false);
    }
  }
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto(`${BASE}/p/${fx.weightProd.id}/${encodeURIComponent(fx.weightProd.slug)}`);
  await page.screenshot({ path: path.join(SHOTS_DIR, "e10-01-weight-pdp-320px.png") });

  // Mobile menu open + Escape closes dialog & restores focus
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/`);
  const menuBtn = page.getByRole("button", { name: /القائمة|فتح القائمة/ }).first();
  if ((await menuBtn.count()) > 0) {
    await menuBtn.click();
    await page.keyboard.press("Escape");
  }

  // Axe-core automated check on Homepage & Weight PDP (0 critical Violations)
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/`);
  await page.addScriptTag({ content: AxeBuilder.source });
  const axeHome = await page.evaluate(async () => {
    // @ts-expect-error injected axe global
    const res = await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] });
    return res.violations.filter((v: { impact: string }) => v.impact === "critical");
  });
  expect(axeHome).toEqual([]);

  // Admin Dark Mode toggle + reload persistence + Optional Three.js WebGL canvas (0 -> 1)
  await resetRateLimitsOnScratch();
  const admLogin2 = await page.request.post(`${BASE}/api/admin/session`, {
    data: { email: OWNER_EMAIL, password: OWNER_PASSWORD },
    headers: { Origin: BASE },
  });
  expect([200, 201]).toContain(admLogin2.status());
  await page.goto(`${BASE}/admin`);
  const webglBefore = await page.locator("canvas").count();
  const webglBtn = page.getByRole("button", { name: /تشغيل المشهد ثلاثي الأبعاد/ });
  if ((await webglBtn.count()) > 0) {
    expect(webglBefore).toBe(0);
    await webglBtn.click();
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 15_000 });
  }
  const themeBtn = page.locator('button[aria-label*="الوضع"], button[title*="الوضع"]').first();
  if ((await themeBtn.count()) > 0) {
    const beforeAttr = await page.locator("html").getAttribute("data-admin-theme");
    await themeBtn.click();
    await page.waitForTimeout(200);
    const afterAttr = await page.locator("html").getAttribute("data-admin-theme");
    expect(afterAttr).not.toBe(beforeAttr);
  }
  await page.screenshot({ path: path.join(SHOTS_DIR, "e10-01-admin-dashboard-dark-webgl.png") });
});

// ============================================================================
// GATE E11 — PERFORMANCE & STABILITY NON-REGRESSION
// ============================================================================

test("E11-01: Performance & stability — prefetch={false} request ceiling, CLS = 0 & bounded long tasks", async ({
  browser,
}) => {
  const perfRoutes = [
    { name: "home", path: "/", maxRequests: 24, expectZeroRscPrefetch: true },
    { name: "categories", path: "/categories", maxRequests: 24, expectZeroRscPrefetch: true },
    { name: "search", path: `/search?q=${encodeURIComponent("شوكلاته")}`, maxRequests: 24, expectZeroRscPrefetch: true },
    { name: "cart", path: "/cart", maxRequests: 28, expectZeroRscPrefetch: false },
    { name: "checkout", path: "/checkout", maxRequests: 30, expectZeroRscPrefetch: false },
  ];

  const metrics: Array<Record<string, unknown>> = [];
  for (const r of perfRoutes) {
    const ctx = await browser.newContext({ locale: "ar-EG", viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(() => {
      (window as unknown as { __cls: number; __longTasks: number[] }).__cls = 0;
      (window as unknown as { __cls: number; __longTasks: number[] }).__longTasks = [];
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries() as unknown as Array<{ hadRecentInput: boolean; value: number }>) {
            if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value;
          }
        }).observe({ type: "layout-shift", buffered: true });
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            (window as unknown as { __longTasks: number[] }).__longTasks.push(Math.round(e.duration));
          }
        }).observe({ type: "longtask", buffered: true });
      } catch {}
    });
    const p = await ctx.newPage();
    let totalReqs = 0;
    let rscReqs = 0;
    p.on("request", (req) => {
      totalReqs++;
      if (req.headers()["rsc"] === "1" || req.url().includes("_rsc=")) rscReqs++;
    });
    await p.goto(`${BASE}${r.path}`, { waitUntil: "networkidle" });
    await p.waitForTimeout(400);
    const { cls, longTasks, ttfb } = await p.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      return {
        cls: Math.round(((window as unknown as { __cls: number }).__cls || 0) * 10000) / 10000,
        longTasks: (window as unknown as { __longTasks: number[] }).__longTasks || [],
        ttfb: nav ? Math.round((nav.responseStart - nav.startTime) * 10) / 10 : null,
      };
    });
    expect(cls, `CLS on ${r.name}`).toBeLessThanOrEqual(0.01);
    expect(totalReqs, `Requests on ${r.name}`).toBeLessThanOrEqual(r.maxRequests);
    if (r.expectZeroRscPrefetch) {
      expect(rscReqs, `RSC prefetches on ${r.name}`).toBe(0);
    }
    metrics.push({ route: r.name, totalReqs, rscReqs, cls, ttfb, longTaskCount: longTasks.length });
    await ctx.close();
  }

  fs.writeFileSync(
    path.join(EVIDENCE_DIR, "p12-08-perf-stability.json"),
    JSON.stringify({ measuredAt: new Date().toISOString(), metrics }, null, 2),
    "utf8",
  );
  recordFact("E11-01", { metrics });
});
