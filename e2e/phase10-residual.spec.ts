// Phase-10 RESIDUAL CLOSURE e2e — runs ONLY against the isolated database
// hyper_almoatasem_p10r served by the residual-closure wrapper on :3209.
//
// Scope (the two residual items only):
//   • delivery fee is server-resolved (active zone > default), preview and
//     create agree, and a fee change after preview is a visible 409 — never a
//     silent total change;
//   • a lost 201 is recoverable through the pre-established HttpOnly guest
//     checkout session, without reissuing the per-order credential;
//   • the admin zone page is usable by SUPER_ADMIN and denied to STORE_ADMIN.
//
// Evidence rules:
//   • the DB client refuses to run unless current_database() is the p10r clone;
//   • raw cart/order/checkout/credential tokens are NEVER printed, logged or
//     written to evidence — only cookie NAMES/flags, lengths and order ids;
//   • guest/admin rate-limit buckets are cleared per test (test isolation).
import { test, expect, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";

const EVIDENCE = process.env.P10R_EVIDENCE_DIR ?? "";
const FIXTURES_PATH = process.env.P10R_FIXTURES_PATH ?? "";
const PASSWORD = process.env.P10R_SEED_PASSWORD ?? "";
const DB_URL = process.env.P10R_DB_URL ?? "";
if (EVIDENCE === "" || FIXTURES_PATH === "" || PASSWORD === "" || DB_URL === "") {
  throw new Error(
    "P10R e2e requires P10R_EVIDENCE_DIR, P10R_FIXTURES_PATH, P10R_SEED_PASSWORD and P10R_DB_URL (set by _scratch/p10r-run-all.mjs).",
  );
}

const EXPECTED_DB = "hyper_almoatasem_p10r";
const GUEST_CART_KEY = "hyper_cart_guest_token";
const PENDING_KEY = "hyper_checkout_pending_v1";
const SHOTS = path.join(EVIDENCE, "screenshots");
fs.mkdirSync(SHOTS, { recursive: true });
const RUNTIME_EVIDENCE = path.join(EVIDENCE, "p10r-runtime-evidence.ndjson");
fs.writeFileSync(RUNTIME_EVIDENCE, "");

interface ZoneFixture {
  id: string;
  name: string;
  normalized: string;
  fee: string;
  active: boolean;
}

interface Fixtures {
  db: string;
  variants: { pieceA: string; pieceB: string };
  customerId: string;
  addresses: { home: string; work: string };
  zones: ZoneFixture[];
  ownerEmail: string;
  storeAdminEmail: string;
  ordersAtStart: number;
  deliveryFee: string;
  deliveryEnabled: string;
}

const fx = JSON.parse(fs.readFileSync(FIXTURES_PATH, "utf8")) as Fixtures;
if (fx.db !== EXPECTED_DB) {
  throw new Error(`Fixtures were produced for ${fx.db}; refusing to run against anything but ${EXPECTED_DB}.`);
}

function record(fact: Record<string, unknown>): void {
  fs.appendFileSync(RUNTIME_EVIDENCE, JSON.stringify(fact) + "\n");
}

let db: Client;

test.beforeAll(async () => {
  db = new Client({ connectionString: DB_URL });
  await db.connect();
  const { rows } = await db.query("SELECT current_database() AS db, current_user AS usr");
  if (rows[0].db !== EXPECTED_DB) {
    throw new Error(`ISOLATION VIOLATION: connected database is ${rows[0].db}, expected ${EXPECTED_DB}.`);
  }
  record({ kind: "db_target", database: rows[0].db, user: rows[0].usr, ordersAtStart: fx.ordersAtStart });
});

test.beforeEach(async () => {
  const { rows } = await db.query("SELECT current_database() AS db");
  expect(rows[0].db, "every write must target the isolated database").toBe(EXPECTED_DB);
  // Test isolation only: rate-limit buckets and lockout state are process-wide
  // for localhost, so each scenario starts from a clean bucket.
  await db.query("DELETE FROM guest_order_rate_limits");
  await db.query("DELETE FROM admin_auth_rate_limits");
  await db.query("DELETE FROM customer_auth_rate_limits");
  await db.query(
    "UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE email IN ($1,$2)",
    [fx.ownerEmail, fx.storeAdminEmail],
  );
  // Converge the fixture economics if an earlier interrupted run left a zone
  // or the default fee changed. This is fixture maintenance on the scratch DB,
  // never an application code path.
  await db.query(
    `UPDATE delivery_zones SET fee = 35.00, is_active = true, updated_at = now()
      WHERE normalized_name = 'المعادي' AND (fee <> 35.00 OR is_active = false)`,
  );
  await db.query(
    `UPDATE store_settings SET value_text = '20.00', updated_at = now()
      WHERE key = 'delivery.default_fee' AND value_text <> '20.00'`,
  );
});

test.afterAll(async () => {
  if (!db) return;
  const dup = await db.query(
    "SELECT idempotency_key, count(*)::int AS n FROM orders GROUP BY idempotency_key HAVING count(*) > 1",
  );
  expect(dup.rows, "an idempotency key must never own two orders").toEqual([]);
  const totals = await db.query(
    `SELECT (SELECT count(*)::int FROM orders) AS orders,
            (SELECT count(*)::int FROM order_items) AS items,
            (SELECT count(*)::int FROM guest_order_credentials) AS guest_credentials,
            (SELECT count(*)::int FROM guest_checkout_sessions) AS checkout_sessions`,
  );
  record({ kind: "db_totals", ...totals.rows[0], ordersAtStart: fx.ordersAtStart });
  await db.end();
});

const confirmBtn = (page: Page) => page.getByRole("button", { name: "تأكيد إنشاء الطلب" });
const resolveBtn = (page: Page) => page.getByRole("button", { name: "تحقق من نتيجة الطلب السابق" });
const feeRow = (page: Page) => page.locator("p", { hasText: "التوصيل:" });
const totalRow = (page: Page) =>
  page.locator("p", { hasText: "الإجمالي التقديري (قبل الإنشاء):" });

async function openCheckout(page: Page): Promise<void> {
  await page.goto("/checkout");
  await expect(page.getByRole("heading", { name: "إتمام الطلب" })).toBeVisible();
}

async function waitReviewReady(page: Page): Promise<void> {
  await expect(page.getByText(/عناصر السلة \(/)).toBeVisible({ timeout: 30_000 });
  await expect(confirmBtn(page)).toBeEnabled({ timeout: 30_000 });
}

async function fillGuest(page: Page, city: string, area?: string, village?: string): Promise<void> {
  await page.getByLabel("المدينة *").fill(city);
  await page.getByLabel("الهاتف *").fill("01000000990");
  await page.getByLabel("الاسم الأول *").fill("ضيف إغلاق");
  if (area !== undefined) await page.getByLabel("المنطقة / الحي (اختياري)").fill(area);
  if (village !== undefined) await page.getByLabel("القرية (اختياري)").fill(village);
  await expect(confirmBtn(page)).toBeEnabled({ timeout: 30_000 });
}

async function useGuestCart(context: BrowserContext, token: string): Promise<void> {
  await context.addInitScript(
    ({ key, value }: { key: string; value: string }) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // storage unavailable: the test would fail on the follow-up request
      }
    },
    { key: GUEST_CART_KEY, value: token },
  );
}

async function guestCart(
  req: APIRequestContext,
  variantId: string,
  quantity = "1",
): Promise<{ token: string; cartId: string }> {
  const created = await req.post("/api/store/cart");
  expect(created.status(), "guest cart mint").toBe(201);
  const body = await created.json();
  const token = body.data.guestToken as string;
  const cartId = body.data.cart.id as string;
  expect(token).toMatch(/^[0-9a-f]{64}$/);
  const add = await req.post("/api/store/cart/items", {
    headers: { "x-guest-token": token },
    data: { productVariantId: variantId, quantity },
  });
  expect(add.status(), "guest line add").toBe(200);
  return { token, cartId };
}

async function orderCountByCart(cartId: string): Promise<number> {
  const r = await db.query("SELECT count(*)::int AS n FROM orders WHERE cart_id = $1::uuid", [cartId]);
  return r.rows[0].n as number;
}

async function orderCountByKey(key: string): Promise<number> {
  const r = await db.query("SELECT count(*)::int AS n FROM orders WHERE idempotency_key = $1", [key]);
  return r.rows[0].n as number;
}

async function orderFacts(
  orderId: string,
): Promise<{ fee: string; total: string; status: string; cartId: string }> {
  const r = await db.query(
    `SELECT delivery_fee::text AS fee, total_estimated::text AS total, status, cart_id
       FROM orders WHERE id = $1::uuid`,
    [orderId],
  );
  expect(r.rows.length, "order row exists").toBe(1);
  return {
    fee: r.rows[0].fee,
    total: r.rows[0].total,
    status: r.rows[0].status,
    cartId: r.rows[0].cart_id,
  };
}

async function adminLogin(page: Page, email: string): Promise<void> {
  await page.goto("/admin/login");
  await expect(page.getByRole("heading", { name: /تسجيل دخول الإدارة/ })).toBeVisible();
  await page.getByLabel("البريد الإلكتروني").fill(email);
  await page.getByLabel("كلمة المرور").fill(PASSWORD);
  await page.getByRole("button", { name: /^دخول$/ }).click();
  await page.waitForURL(/\/admin$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "لوحة الإدارة" })).toBeVisible();
}

async function ownerApiLogin(request: APIRequestContext): Promise<void> {
  const res = await request.post("/api/admin/session", {
    data: { email: fx.ownerEmail, password: PASSWORD },
  });
  expect([200, 201], "owner admin login").toContain(res.status());
}

async function zoneByName(request: APIRequestContext, name: string) {
  const res = await request.get("/api/admin/delivery-zones");
  expect(res.status(), "zone list").toBe(200);
  const body = await res.json();
  const zones = body.data as Array<{ id: string; name: string; fee: string; version: number }>;
  const zone = zones.find((z) => z.name === name);
  expect(zone, `zone ${name} exists`).toBeTruthy();
  return zone!;
}

async function setZoneFee(request: APIRequestContext, name: string, fee: string): Promise<void> {
  const zone = await zoneByName(request, name);
  const res = await request.patch(`/api/admin/delivery-zones/${zone.id}`, {
    data: { fee, version: zone.version },
  });
  expect(res.status(), `zone ${name} fee -> ${fee}`).toBe(200);
}

/** Drop exactly the next server-action response AFTER the server executed it. */
async function dropNextServerActionResponse(page: Page): Promise<() => boolean> {
  let dropped = false;
  await page.route("**/checkout", async (route) => {
    const request = route.request();
    const isAction = request.method() === "POST" && Boolean(request.headers()["next-action"]);
    if (!dropped && isAction) {
      dropped = true;
      await route.fetch();
      await route.abort("failed");
      return;
    }
    await route.continue();
  });
  return () => dropped;
}

test.describe.configure({ mode: "serial" });

test("P10R-DF-UI-01 zone-aware delivery fee is previewed and committed at 35.00", async ({
  page,
  context,
  request,
}) => {
  const { token, cartId } = await guestCart(request, fx.variants.pieceA, "1");
  await useGuestCart(context, token);
  await openCheckout(page);
  await waitReviewReady(page);
  await fillGuest(page, "القاهرة", "المعادي");

  await expect(feeRow(page)).toContainText("35.00", { timeout: 30_000 });
  await expect(totalRow(page)).toContainText("60.00");
  await page.screenshot({ path: path.join(SHOTS, "checkout-fee-zone.png"), fullPage: true });

  // Mobile capture of the same state (visual review evidence).
  await page.setViewportSize({ width: 375, height: 900 });
  await totalRow(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, "checkout-fee-zone-375.png"), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });

  await confirmBtn(page).click();
  await expect(page).toHaveURL(/\/order-confirmation\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "تم إنشاء طلبك بنجاح" })).toBeVisible();
  const orderId = page.url().split("/").pop() as string;

  const facts = await orderFacts(orderId);
  expect(facts.fee, "committed delivery fee").toBe("35.00");
  expect(facts.total, "committed total").toBe("60.00");
  expect(facts.cartId).toBe(cartId);
  expect(await orderCountByCart(cartId)).toBe(1);
  record({
    kind: "delivery_fee_ui",
    scenario: "zone-preview-and-create",
    previewFee: "35.00",
    committedFee: facts.fee,
    total: facts.total,
    orderId,
  });
});

test("P10R-DF-UI-02 fee change after preview is a visible 409 and never a silent total", async ({
  page,
  context,
  request,
}) => {
  const { token, cartId } = await guestCart(request, fx.variants.pieceA, "1");
  await useGuestCart(context, token);
  await openCheckout(page);
  await waitReviewReady(page);
  await fillGuest(page, "القاهرة", "المعادي");
  await expect(feeRow(page)).toContainText("35.00", { timeout: 30_000 });

  await ownerApiLogin(request);
  try {
    // The admin raises the zone fee while this checkout tab still reviews 35.00.
    await setZoneFee(request, "المعادي", "40.00");
    await confirmBtn(page).click();

    await expect(page.getByText("تغيّرت رسوم التوصيل بعد المعاينة")).toBeVisible({ timeout: 30_000 });
    await expect(feeRow(page)).toContainText("40.00", { timeout: 30_000 });
    await expect(totalRow(page)).toContainText("65.00");
    expect(await orderCountByCart(cartId), "no order on the fee conflict").toBe(0);
    await page.screenshot({ path: path.join(SHOTS, "checkout-fee-conflict.png"), fullPage: true });

    // The customer explicitly re-confirms the NEW total; only now is an order
    // created, and it carries the server fee (40.00), never the stale 35.00.
    await confirmBtn(page).click();
    await expect(page).toHaveURL(/\/order-confirmation\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    const orderId = page.url().split("/").pop() as string;
    const facts = await orderFacts(orderId);
    expect(facts.fee, "re-confirmed fee").toBe("40.00");
    expect(facts.total, "re-confirmed total").toBe("65.00");
    expect(await orderCountByCart(cartId)).toBe(1);
    record({
      kind: "delivery_fee_conflict_ui",
      scenario: "fee-changed-after-preview",
      conflictVisible: true,
      ordersBeforeReconfirm: 0,
      reconfirmedFee: facts.fee,
      orderId,
    });
  } finally {
    await setZoneFee(request, "المعادي", "35.00");
  }
});

test("P10R-GR-UI-01 lost 201 is recovered through the checkout session, not a reissued credential", async ({
  page,
  context,
  request,
}) => {
  const { token, cartId } = await guestCart(request, fx.variants.pieceA, "1");
  await useGuestCart(context, token);
  await openCheckout(page);
  await waitReviewReady(page);
  await fillGuest(page, "القاهرة", "المعادي");
  await expect(feeRow(page)).toContainText("35.00", { timeout: 30_000 });

  const before = await context.cookies();
  const checkoutCookie = before.find((c) => /^(__Host-)?guest-checkout$/.test(c.name));
  expect(checkoutCookie, "pre-established checkout session must exist before create").toBeTruthy();
  expect(checkoutCookie!.httpOnly).toBe(true);
  expect(checkoutCookie!.sameSite.toLowerCase()).toBe("lax");
  expect(checkoutCookie!.value.length).toBe(64);

  const dropped = await dropNextServerActionResponse(page);
  await confirmBtn(page).click();
  await expect(page.getByText("محاولة طلب غير مؤكدة")).toBeVisible({ timeout: 30_000 });
  expect(dropped(), "the server-action response was actually dropped").toBe(true);

  const raw = await page.evaluate((key) => sessionStorage.getItem(key), PENDING_KEY);
  expect(raw).toBeTruthy();
  const pending = JSON.parse(raw as string) as { key: string; at: number };
  expect(Object.keys(pending).sort()).toEqual(["at", "key"]);
  expect(await orderCountByKey(pending.key), "server committed before response was lost").toBe(1);

  // The 201 (and its one-time credential) never reached this browser; the
  // harness may retain the Set-Cookie from route.fetch(), so remove it.
  await context.clearCookies({ name: /guest-order-/ });
  const afterAbort = await context.cookies();
  expect(afterAbort.some((c) => /^guest-order-/.test(c.name)), "order credential absent").toBe(false);
  expect(
    afterAbort.some((c) => /^(__Host-)?guest-checkout$/.test(c.name)),
    "checkout session survives the lost response",
  ).toBe(true);

  await resolveBtn(page).click();
  await expect(page).toHaveURL(/\/order-confirmation\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "تم إنشاء طلبك بنجاح" })).toBeVisible();
  const orderId = page.url().split("/").pop() as string;

  expect(await orderCountByKey(pending.key), "replay must not create a second order").toBe(1);
  expect(await orderCountByCart(cartId)).toBe(1);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), PENDING_KEY)).toBeNull();

  const binding = await db.query(
    `SELECT order_id, cart_id, revoked_at, expires_at > now() AS live
       FROM guest_checkout_sessions WHERE order_id = $1::uuid`,
    [orderId],
  );
  expect(binding.rows.length, "checkout session bound to the created order").toBe(1);
  expect(binding.rows[0].order_id).toBe(orderId);
  expect(binding.rows[0].cart_id).toBe(cartId);
  expect(binding.rows[0].revoked_at).toBeNull();
  expect(binding.rows[0].live).toBe(true);

  const credentials = await db.query(
    "SELECT count(*)::int AS n FROM guest_order_credentials WHERE order_id = $1::uuid",
    [orderId],
  );
  expect(credentials.rows[0].n, "fresh 201 issued exactly one credential (not reissued)").toBe(1);

  await page.screenshot({
    path: path.join(SHOTS, "confirmation-recovered-via-checkout-session.png"),
    fullPage: true,
  });
  record({
    kind: "guest_recovery_ui",
    scenario: "lost-201",
    checkoutCookieHttpOnly: true,
    credentialCookieAbsent: true,
    orderId,
    orderKeyCount: 1,
    checkoutSessionBound: true,
    credentialRows: credentials.rows[0].n,
  });
});

test("P10R-ADMIN-01 SUPER_ADMIN sees the delivery zones and the default fee", async ({ page }) => {
  await adminLogin(page, fx.ownerEmail);
  await expect(page.getByRole("link", { name: "مناطق التوصيل" })).toBeVisible();
  await page.goto("/admin/delivery-zones");
  await expect(page.getByRole("heading", { name: "مناطق التوصيل" })).toBeVisible();
  await expect(page.getByText(/الرسوم الافتراضية الحالية:/)).toBeVisible();
  await expect(page.getByText("20.00", { exact: true }).first()).toBeVisible();

  const maadi = page.locator("li", { hasText: "المعادي" }).first();
  await expect(maadi).toBeVisible();
  await expect(maadi).toContainText("35");
  await expect(maadi).toContainText("مفعّلة");
  await expect(page.getByRole("heading", { name: "منطقة جديدة (settings.manage)" })).toBeVisible();

  await page.screenshot({ path: path.join(SHOTS, "admin-delivery-zones.png"), fullPage: true });
  record({ kind: "admin_zones_ui", role: "SUPER_ADMIN", visible: true, defaultFee: "20.00", zone: "المعادي", fee: "35.00" });
});

test("P10R-ADMIN-02 STORE_ADMIN is denied the zones page and API", async ({ page }) => {
  await adminLogin(page, fx.storeAdminEmail);
  await expect(page.getByRole("link", { name: "مناطق التوصيل" })).toHaveCount(0);

  const api = await page.request.get("/api/admin/delivery-zones");
  expect(api.status(), "STORE_ADMIN zone API").toBe(403);

  const res = await page.goto("/admin/delivery-zones");
  expect(res?.status(), "STORE_ADMIN zones page status").toBe(403);
  await expect(page.getByRole("heading", { name: "403 — غير مصرح" })).toBeVisible();
  await expect(page.getByText(/ليست لديك صلاحية الوصول إلى هذه الصفحة/)).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, "admin-zones-store-admin-denied.png"), fullPage: true });
  record({ kind: "admin_zones_ui", role: "STORE_ADMIN", pageStatus: 403, apiStatus: 403 });
});
