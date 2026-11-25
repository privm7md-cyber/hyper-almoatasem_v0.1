// Phase 10 (Checkout & Customer Identity) e2e — runs ONLY against the isolated
// database hyper_almoatasem_p10 served by the wrapper on :3199.
//
// Evidence rules:
//  • every test creates its own cart and asserts order counts for THAT cart;
//  • the DB client refuses to run unless current_database() is the isolated DB;
//  • raw credentials/tokens/session values are NEVER printed, logged or written
//    to evidence — only cookie NAMES/flags, key counts and order ids;
//  • guest rate-limit buckets are cleared per test (test isolation, not a
//    production behavior change).
import { test, expect, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";

const EVIDENCE = process.env.P10_EVIDENCE_DIR ?? "";
const FIXTURES_PATH = process.env.P10_FIXTURES_PATH ?? "";
const PASSWORD = process.env.P10_SEED_PASSWORD ?? "";
if (EVIDENCE === "" || FIXTURES_PATH === "" || PASSWORD === "") {
  throw new Error(
    "P10 e2e requires P10_EVIDENCE_DIR, P10_FIXTURES_PATH and P10_SEED_PASSWORD (set by _scratch/p10-run-e2e.mjs).",
  );
}

const EXPECTED_DB = "hyper_almoatasem_p10";
const GUEST_CART_KEY = "hyper_cart_guest_token";
const PENDING_KEY = "hyper_checkout_pending_v1";
const SHOTS = path.join(EVIDENCE, "screenshots");
fs.mkdirSync(SHOTS, { recursive: true });
const RUNTIME_EVIDENCE = path.join(EVIDENCE, "p10-runtime-evidence.ndjson");
fs.writeFileSync(RUNTIME_EVIDENCE, "");

interface Fixtures {
  db: string;
  variants: { pieceA: string; pieceB: string; lowA: string };
  customerId: string;
  customerPhone: string;
  addresses: { home: string; work: string };
  ordersAtStart: number;
  deliveryFee: string;
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
  const url = process.env.DATABASE_URL ?? "";
  if (url === "") throw new Error("DATABASE_URL missing in the Playwright process.");
  db = new Client({ connectionString: url });
  await db.connect();
  const { rows } = await db.query("SELECT current_database() AS db");
  if (rows[0].db !== EXPECTED_DB) {
    throw new Error(`ISOLATION VIOLATION: connected database is ${rows[0].db}, expected ${EXPECTED_DB}.`);
  }
  record({ kind: "db_target", database: rows[0].db, ordersAtStart: fx.ordersAtStart });
});

test.beforeEach(async () => {
  const { rows } = await db.query("SELECT current_database() AS db");
  expect(rows[0].db, "every write must target the isolated database").toBe(EXPECTED_DB);
  // Test isolation only: anonymous creation/read buckets and login throttles are
  // process-wide for localhost, so each scenario starts from a clean bucket.
  await db.query("DELETE FROM guest_order_rate_limits");
  await db.query("DELETE FROM customer_auth_rate_limits");
  await db.query(
    "UPDATE customers SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1::uuid",
    [fx.customerId],
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
            (SELECT count(*)::int FROM coupon_usages) AS coupon_usages`,
  );
  record({ kind: "db_totals", ...totals.rows[0], ordersAtStart: fx.ordersAtStart });
  await db.end();
});

const confirmBtn = (page: Page) => page.getByRole("button", { name: "تأكيد إنشاء الطلب" });
const resolveBtn = (page: Page) => page.getByRole("button", { name: "تحقق من نتيجة الطلب السابق" });

async function openCheckout(page: Page): Promise<void> {
  await page.goto("/checkout");
  await expect(page.getByRole("heading", { name: "إتمام الطلب" })).toBeVisible();
}

async function waitReviewReady(page: Page): Promise<void> {
  await expect(page.getByText(/عناصر السلة \(/)).toBeVisible({ timeout: 30_000 });
  await expect(confirmBtn(page)).toBeEnabled({ timeout: 30_000 });
}

async function fillGuestFields(page: Page, city = "القاهرة"): Promise<void> {
  await page.getByLabel("المدينة *").fill(city);
  await page.getByLabel("الهاتف *").fill("01000000200");
  await page.getByLabel("الاسم الأول *").fill("ضيف اختبار");
}

async function fillGuest(page: Page, city = "القاهرة"): Promise<void> {
  await fillGuestFields(page, city);
  await expect(confirmBtn(page)).toBeEnabled({ timeout: 30_000 });
}

async function submitAndConfirm(page: Page): Promise<string> {
  await confirmBtn(page).click();
  await expect(page).toHaveURL(/\/order-confirmation\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  // The route announcer repeats the heading text, so scope to the heading.
  await expect(page.getByRole("heading", { name: "تم إنشاء طلبك بنجاح" })).toBeVisible();
  return page.url().split("/").pop() as string;
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

async function loginSession(context: BrowserContext): Promise<void> {
  const res = await context.request.post("/api/store/customers/session", {
    data: { phone: fx.customerPhone, password: PASSWORD },
  });
  expect(res.status(), "fixture customer login").toBe(200);
}

async function loginAndCart(
  context: BrowserContext,
  variantId: string,
  quantity = "1",
): Promise<{ cartId: string }> {
  await loginSession(context);
  const cleared = await context.request.delete("/api/store/cart/items");
  expect([200, 404], "no active cart is also a valid clean slate").toContain(cleared.status());
  const created = await context.request.post("/api/store/cart");
  expect([200, 201], "registered cart resolve/create").toContain(created.status());
  const body = await created.json();
  const cartId = body.data.cart.id as string;
  const add = await context.request.post("/api/store/cart/items", {
    data: { productVariantId: variantId, quantity },
  });
  expect(add.status(), "registered line add").toBe(200);
  return { cartId };
}

async function postGuestOrder(
  req: APIRequestContext,
  token: string,
  key: string,
  overrides: Record<string, unknown> = {},
) {
  return req.post("/api/store/orders", {
    headers: { "x-guest-token": token },
    data: {
      idempotencyKey: key,
      guestAddress: { city: "مطاي", phone: "01000000200" },
      guestContact: { firstName: "ضيف" },
      ...overrides,
    },
  });
}

async function orderCountByCart(cartId: string): Promise<number> {
  const r = await db.query("SELECT count(*)::int AS n FROM orders WHERE cart_id = $1::uuid", [cartId]);
  return r.rows[0].n as number;
}

async function orderCountByKey(key: string): Promise<number> {
  const r = await db.query("SELECT count(*)::int AS n FROM orders WHERE idempotency_key = $1", [key]);
  return r.rows[0].n as number;
}

interface CookieFact {
  name: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: string;
  path: string;
  valueLength: number;
}

async function cookieFacts(context: BrowserContext): Promise<CookieFact[]> {
  const cookies = await context.cookies();
  return cookies.map((c) => ({
    name: c.name,
    httpOnly: c.httpOnly,
    secure: c.secure,
    sameSite: c.sameSite,
    path: c.path,
    valueLength: c.value.length,
  }));
}

/** Drop exactly the next server-action response AFTER the server executed it.
 * This is the honest "timeout/lost response after commit" simulation: the
 * browser sees a transport failure while the order already exists server-side. */
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

test("P10-C01 guest checkout: coupon preview, one order, HttpOnly order credential", async ({
  page,
  context,
  request,
}) => {
  const { token, cartId } = await guestCart(request, fx.variants.pieceA, "1");
  await useGuestCart(context, token);
  await openCheckout(page);
  await waitReviewReady(page);

  await page.getByLabel("كود الكوبون").fill("P10TEN");
  await expect(page.getByText(/42\.50/)).toBeVisible({ timeout: 30_000 });
  await expect(confirmBtn(page)).toBeEnabled({ timeout: 30_000 });
  await fillGuest(page);
  const orderId = await submitAndConfirm(page);
  await expect(page.getByText(/42\.50/)).toBeVisible();

  expect(await orderCountByCart(cartId)).toBe(1);
  const facts = await cookieFacts(context);
  const orderCookie = facts.find((c) => /^(__Host-)?guest-order-/.test(c.name));
  expect(orderCookie, "guest order credential cookie must exist").toBeTruthy();
  // Local dev is plain HTTP: the production `__Host-` name would be dropped by
  // the browser, so the dev-name policy must be in effect.
  expect(orderCookie!.name.startsWith("guest-order-")).toBe(true);
  expect(orderCookie!.httpOnly).toBe(true);
  expect(orderCookie!.secure).toBe(false);
  expect(orderCookie!.sameSite.toLowerCase()).toBe("lax");

  const domCookie = await page.evaluate(() => document.cookie);
  expect(domCookie).not.toContain(token);
  expect(page.url()).not.toContain(token);
  record({ kind: "credential_audit", flow: "guest-success", orderId, cookie: orderCookie });
});

test("P10-C02 registered checkout: session identity, one order, HttpOnly session", async ({
  page,
  context,
}) => {
  const { cartId } = await loginAndCart(context, fx.variants.pieceA, "1");
  await openCheckout(page);
  await waitReviewReady(page);
  await expect(page.getByLabel("اختر عنوانًا")).toHaveValue(fx.addresses.home);
  const orderId = await submitAndConfirm(page);

  expect(await orderCountByCart(cartId)).toBe(1);
  const facts = await cookieFacts(context);
  const session = facts.find((c) => c.name.includes("customer-session"));
  expect(session, "registered session cookie must exist").toBeTruthy();
  expect(session!.httpOnly).toBe(true);
  const domCookie = await page.evaluate(() => document.cookie);
  expect(domCookie).not.toContain("customer-session-dev");
  expect(facts.some((c) => /guest-order-/.test(c.name))).toBe(false);
  record({ kind: "credential_audit", flow: "registered-success", orderId, cookie: session });
});

test("P10-C03 keyboard activation creates exactly one order", async ({ page, context }) => {
  const { cartId } = await loginAndCart(context, fx.variants.pieceB, "1");
  await openCheckout(page);
  await waitReviewReady(page);
  await confirmBtn(page).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/order-confirmation\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  expect(await orderCountByCart(cartId)).toBe(1);
});

test("P10-C04 rapid double click creates exactly one order", async ({ page, context, request }) => {
  const { token, cartId } = await guestCart(request, fx.variants.pieceA, "1");
  await useGuestCart(context, token);
  await openCheckout(page);
  await waitReviewReady(page);
  await fillGuest(page);

  await confirmBtn(page).scrollIntoViewIfNeeded();
  const box = await confirmBtn(page).boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.waitForTimeout(40);
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect(page).toHaveURL(/\/order-confirmation\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "تم إنشاء طلبك بنجاح" })).toBeVisible();
  expect(await orderCountByCart(cartId)).toBe(1);
});

test("P10-C05 another tab changing a line blocks submit (live-cart preflight)", async ({
  page,
  context,
  request,
}) => {
  const { token, cartId } = await guestCart(request, fx.variants.pieceA, "2");
  await useGuestCart(context, token);
  await openCheckout(page);
  await waitReviewReady(page);
  await fillGuest(page);

  const patch = await request.patch(`/api/store/cart/items/${fx.variants.pieceA}`, {
    headers: { "x-guest-token": token },
    data: { quantity: "3" },
  });
  expect(patch.status()).toBe(200);

  await confirmBtn(page).click();
  await expect(page.getByText(/تغيّرت عناصر السلة في نافذة أو جهاز آخر/)).toBeVisible();
  expect(await orderCountByCart(cartId)).toBe(0);
  // The review was refreshed to the live quantity and the CTA is re-gated until
  // a fresh estimate of the NEW terms lands.
  await expect(page.getByText("3", { exact: true })).toBeVisible();
  await expect(confirmBtn(page)).toBeEnabled({ timeout: 30_000 });
});

test("P10-C06 server price change → 409 → explicit reprice → success", async ({
  page,
  context,
  request,
}) => {
  const { token, cartId } = await guestCart(request, fx.variants.pieceA, "1");
  await useGuestCart(context, token);
  await openCheckout(page);
  await waitReviewReady(page);
  await fillGuest(page);

  try {
    await db.query("UPDATE product_variants SET price = 30.00, updated_at = now() WHERE id = $1::uuid", [
      fx.variants.pieceA,
    ]);
    await confirmBtn(page).click();
    await expect(page.getByText(/تغيّرت أسعار أو شروط الطلب/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "تحديث الأسعار" })).toBeVisible();
    expect(await orderCountByCart(cartId)).toBe(0);

    await page.getByRole("button", { name: "تحديث الأسعار" }).click();
    // Reprice is a write + a fresh estimate for the NEW price: wait until the
    // offer disappears (issue cleared) and the estimate reflects 30 + 20 = 50.
    await expect(page.getByRole("button", { name: "تحديث الأسعار" })).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByText(/50\.00/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("الإجمالي التقديري محدث وفق الكوبون والتوصيل — يمكنك التأكيد.")).toBeVisible();
    await expect(confirmBtn(page)).toBeEnabled({ timeout: 30_000 });
    await expect(page.getByText(/50\.00/)).toBeVisible();
    const orderId = await submitAndConfirm(page);
    await expect(page.getByText(/50\.00/)).toBeVisible();
    expect(await orderCountByCart(cartId)).toBe(1);
    record({ kind: "price_conflict_recovery", orderId, cartId });
  } finally {
    await db.query("UPDATE product_variants SET price = 25.00, updated_at = now() WHERE id = $1::uuid", [
      fx.variants.pieceA,
    ]);
  }
});

test("P10-C07 insufficient availability → 409, zero orders, zero reservation", async ({
  page,
  context,
  request,
}) => {
  const { token, cartId } = await guestCart(request, fx.variants.lowA, "4");
  await useGuestCart(context, token);
  await openCheckout(page);
  await waitReviewReady(page);
  await fillGuest(page);

  await confirmBtn(page).click();
  await expect(page.getByText(/الكمية المطلوبة لم تعد متاحة/)).toBeVisible({ timeout: 30_000 });
  expect(await orderCountByCart(cartId)).toBe(0);
  const inv = await db.query(
    "SELECT reserved_quantity::text AS v FROM inventory WHERE product_variant_id = $1::uuid",
    [fx.variants.lowA],
  );
  expect(Number(inv.rows[0].v)).toBe(0);
});

test("P10-C08 unknown coupon → estimate 404 message, confirm stays blocked", async ({
  page,
  context,
  request,
}) => {
  const { token, cartId } = await guestCart(request, fx.variants.pieceA, "1");
  await useGuestCart(context, token);
  await openCheckout(page);
  await waitReviewReady(page);

  await page.getByLabel("كود الكوبون").fill("P10-NOPE");
  await expect(page.getByText("كود الكوبون غير موجود أو لم يعد صالحًا.")).toBeVisible({ timeout: 30_000 });
  await expect(confirmBtn(page)).toBeDisabled();
  expect(await orderCountByCart(cartId)).toBe(0);
});

test("P10-C09 guest-only coupon → create 422 in Arabic, no order", async ({
  page,
  context,
  request,
}) => {
  const { token, cartId } = await guestCart(request, fx.variants.pieceA, "1");
  await useGuestCart(context, token);
  await openCheckout(page);
  await waitReviewReady(page);

  await page.getByLabel("كود الكوبون").fill("P10VIP");
  await expect(page.getByText(/الكوبون غير قابل للتطبيق/)).toBeVisible({ timeout: 30_000 });
  await expect(confirmBtn(page)).toBeEnabled({ timeout: 30_000 });
  await fillGuest(page);

  await confirmBtn(page).click();
  await expect(page.getByText(/تعذّر تطبيق الكوبون/)).toBeVisible({ timeout: 30_000 });
  expect(await orderCountByCart(cartId)).toBe(0);
});

test("P10-C10 expired session blocks the create and offers a login return path", async ({
  page,
  context,
}) => {
  const { cartId } = await loginAndCart(context, fx.variants.pieceA, "1");
  await openCheckout(page);
  await waitReviewReady(page);

  await context.clearCookies();
  await confirmBtn(page).click();
  await expect(page.getByText(/انتهت جلسة تسجيل الدخول قبل إرسال الطلب/)).toBeVisible();
  await expect(page.getByRole("link", { name: "تسجيل الدخول" })).toHaveAttribute(
    "href",
    "/login?next=%2Fcheckout",
  );
  expect(await orderCountByCart(cartId)).toBe(0);
});

test("P10-C11 registered timeout-after-execution: same-key reconcile, exactly one order", async ({
  page,
  context,
}) => {
  const { cartId } = await loginAndCart(context, fx.variants.pieceA, "1");
  await openCheckout(page);
  await waitReviewReady(page);

  const dropped = await dropNextServerActionResponse(page);
  await confirmBtn(page).click();
  await expect(page.getByText("محاولة طلب غير مؤكدة")).toBeVisible({ timeout: 30_000 });
  expect(dropped(), "the server-action response was actually dropped").toBe(true);

  const raw = await page.evaluate((key) => sessionStorage.getItem(key), PENDING_KEY);
  expect(raw).toBeTruthy();
  const pending = JSON.parse(raw as string) as { key: string; at: number };
  expect(Object.keys(pending).sort()).toEqual(["at", "key"]);
  expect(await orderCountByKey(pending.key), "server committed before the response was lost").toBe(1);

  // C11 runs at the default Playwright viewport (1280×720); the file name
  // states the real capture width so the evidence is not mislabelled.
  await page.screenshot({ path: path.join(SHOTS, "state-pending-1280.png"), fullPage: true });
  await resolveBtn(page).click();
  await expect(page).toHaveURL(/\/order-confirmation\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  expect(await orderCountByKey(pending.key), "replay must not create a second order").toBe(1);
  expect(await orderCountByCart(cartId)).toBe(1);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), PENDING_KEY)).toBeNull();
  record({ kind: "timeout_recovery", flow: "registered", orderKeyCount: 1 });
});

test("P10-C12 guest timeout-after-execution: replay 200, one order, credential never reissued", async ({
  page,
  context,
  request,
}) => {
  const { token, cartId } = await guestCart(request, fx.variants.pieceA, "1");
  await useGuestCart(context, token);
  await openCheckout(page);
  await waitReviewReady(page);
  await fillGuest(page);

  const dropped = await dropNextServerActionResponse(page);
  await confirmBtn(page).click();
  await expect(page.getByText("محاولة طلب غير مؤكدة")).toBeVisible({ timeout: 30_000 });
  expect(dropped()).toBe(true);

  const raw = await page.evaluate((key) => sessionStorage.getItem(key), PENDING_KEY);
  const pending = JSON.parse(raw as string) as { key: string; at: number };
  expect(await orderCountByKey(pending.key)).toBe(1);
  const afterAbort = await cookieFacts(context);
  const credentialAfterAbort = afterAbort.some((c) => /guest-order-/.test(c.name));

  // The 201 (and its one-time credential) was never delivered to this browser.
  // If the test harness retained the Set-Cookie from route.fetch(), remove it:
  // the honest scenario is "lost response", not "harness kept the cookie".
  await context.clearCookies({ name: /guest-order-/ });
  await resolveBtn(page).click();
  await expect(page.getByText(/رمز الوصول الأصلي غير متاح/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/لم يُنشأ طلب جديد/)).toBeVisible();
  await expect(page).not.toHaveURL(/order-confirmation/);
  expect(await orderCountByKey(pending.key)).toBe(1);
  expect(await orderCountByCart(cartId)).toBe(1);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), PENDING_KEY)).toBeNull();
  const finalCookies = await cookieFacts(context);
  expect(finalCookies.some((c) => /guest-order-/.test(c.name))).toBe(false);
  record({
    kind: "timeout_recovery",
    flow: "guest",
    orderKeyCount: 1,
    credentialCookieAfterAbort: credentialAfterAbort,
    credentialReissued: false,
  });
});

test("P10-C13 same key + same cart replays the original order even with changed payload", async ({
  request,
}) => {
  const { token, cartId } = await guestCart(request, fx.variants.pieceA, "1");
  const key = randomUUID();
  const first = await postGuestOrder(request, token, key);
  expect(first.status()).toBe(201);
  const firstBody = await first.json();
  const orderId = firstBody.data.order.id as string;
  expect(firstBody.data.guestOrderToken).toMatch(/^[0-9a-f]{64}$/);

  const second = await postGuestOrder(request, token, key, {
    guestAddress: { city: "القاهرة", phone: "01000000200" },
    couponCode: "P10TEN",
  });
  expect(second.status()).toBe(200);
  const secondBody = await second.json();
  expect(secondBody.meta.replay).toBe(true);
  expect(secondBody.data.order.id).toBe(orderId);
  expect(secondBody.data.guestOrderToken).toBeUndefined();
  expect(await orderCountByKey(key)).toBe(1);
  expect(await orderCountByCart(cartId)).toBe(1);
  record({ kind: "replay_terms_policy", sameOrder: true, tokenReissued: false });
});

test("P10-C14 same key with a different cart is a 409 key conflict", async ({ request }) => {
  const a = await guestCart(request, fx.variants.pieceA, "1");
  const b = await guestCart(request, fx.variants.pieceB, "1");
  const key = randomUUID();
  expect((await postGuestOrder(request, a.token, key)).status()).toBe(201);

  const second = await postGuestOrder(request, b.token, key);
  expect(second.status()).toBe(409);
  const body = await second.json();
  expect(body.error.code).toBe("CONFLICT");
  expect(body.error.details.key).toBe(key);
  expect(await orderCountByKey(key)).toBe(1);
  expect(await orderCountByCart(b.cartId)).toBe(0);
  const cartB = await request.get("/api/store/cart", { headers: { "x-guest-token": b.token } });
  expect(cartB.status(), "the second cart stays untouched/ACTIVE").toBe(200);
});

test("P10-C15 UI same-key conflict clears the stale attempt in Arabic", async ({
  page,
  context,
  request,
}) => {
  const a = await guestCart(request, fx.variants.pieceA, "1");
  const b = await guestCart(request, fx.variants.pieceB, "1");
  const key = randomUUID();
  expect((await postGuestOrder(request, a.token, key)).status()).toBe(201);

  await useGuestCart(context, b.token);
  await context.addInitScript(
    ({ storageKey, value }: { storageKey: string; value: string }) => {
      try {
        window.sessionStorage.setItem(storageKey, value);
      } catch {
        // ignore
      }
    },
    { storageKey: PENDING_KEY, value: JSON.stringify({ key, at: Date.now() }) },
  );

  await openCheckout(page);
  await expect(page.getByText("محاولة طلب غير مؤكدة")).toBeVisible();
  await fillGuestFields(page);
  await resolveBtn(page).click();
  await expect(page.getByText(/تعارض في مفتاح المحاولة/)).toBeVisible({ timeout: 30_000 });
  expect(await orderCountByKey(key)).toBe(1);
  expect(await orderCountByCart(b.cartId)).toBe(0);
  expect(await page.evaluate((k) => sessionStorage.getItem(k), PENDING_KEY)).toBeNull();
});

test("P10-C16 guest access: header-only 200, wrong/missing credential 401, cookie confirmation", async ({
  page,
  context,
  request,
  browser,
}) => {
  const { token } = await guestCart(request, fx.variants.pieceA, "1");
  const key = randomUUID();
  const created = await postGuestOrder(request, token, key);
  expect(created.status()).toBe(201);
  const body = await created.json();
  const orderId = body.data.order.id as string;
  const credential = body.data.guestOrderToken as string;
  const orderNumber = body.data.order.orderNumber as string;
  expect(credential).toMatch(/^[0-9a-f]{64}$/);

  const headered = await request.get(`/api/store/orders/${orderId}`, {
    headers: { "x-guest-order-token": credential },
  });
  expect(headered.status(), "header-only transport works without any cookie").toBe(200);
  const wrong = await request.get(`/api/store/orders/${orderId}`, {
    headers: { "x-guest-order-token": "f".repeat(64) },
  });
  expect(wrong.status(), "a foreign credential is denied").toBe(401);
  const missing = await request.get(`/api/store/orders/${orderId}`);
  expect(missing.status(), "order id alone is never an authority").toBe(401);

  const baseURL = test.info().project.use.baseURL as string;
  await context.addCookies([
    {
      name: `guest-order-${orderId}`,
      value: credential,
      url: baseURL,
      httpOnly: true,
      sameSite: "Lax",
      secure: false,
    },
  ]);
  await page.goto(`/order-confirmation/${orderId}`);
  await expect(page.getByRole("heading", { name: "تم إنشاء طلبك بنجاح" })).toBeVisible();
  await expect(page.getByText(orderNumber)).toBeVisible();
  expect(page.url()).not.toContain(credential);
  const domCookie = await page.evaluate(() => document.cookie);
  expect(domCookie).not.toContain(credential);

  const anon = await browser.newContext();
  try {
    const anonPage = await anon.newPage();
    await anonPage.goto(`${baseURL}/order-confirmation/${orderId}`);
    await expect(anonPage.getByText("تعذّر عرض التأكيد")).toBeVisible();
  } finally {
    await anon.close();
  }
  record({ kind: "guest_access", header200: true, foreign401: true, missing401: true, cookiePage: true });
});

test("P10-C17 identity XOR: no identity 401, guest+addressId 400, session+guest payload 400", async ({
  context,
  request,
}) => {
  const noIdentityKey = randomUUID();
  const none = await request.post("/api/store/orders", {
    data: {
      idempotencyKey: noIdentityKey,
      guestAddress: { city: "مطاي", phone: "01000000200" },
      guestContact: { firstName: "ضيف" },
    },
  });
  expect(none.status()).toBe(401);
  expect(await orderCountByKey(noIdentityKey)).toBe(0);

  const { token } = await guestCart(request, fx.variants.pieceA, "1");
  const guestMixedKey = randomUUID();
  const guestMixed = await request.post("/api/store/orders", {
    headers: { "x-guest-token": token },
    data: {
      idempotencyKey: guestMixedKey,
      addressId: fx.addresses.home,
      guestAddress: { city: "مطاي", phone: "01000000200" },
      guestContact: { firstName: "ضيف" },
    },
  });
  expect(guestMixed.status()).toBe(400);
  expect(await orderCountByKey(guestMixedKey)).toBe(0);

  await loginSession(context);
  const sessionMixedKey = randomUUID();
  const sessionMixed = await context.request.post("/api/store/orders", {
    data: {
      idempotencyKey: sessionMixedKey,
      guestAddress: { city: "مطاي", phone: "01000000200" },
      guestContact: { firstName: "ضيف" },
    },
  });
  expect(sessionMixed.status()).toBe(400);
  expect(await orderCountByKey(sessionMixedKey)).toBe(0);
});

test("P10-C18 visual matrix 320/375/768/1024/1440 + stale state + storage audit", async ({
  page,
  context,
  request,
}) => {
  const { token } = await guestCart(request, fx.variants.pieceA, "2");
  await useGuestCart(context, token);
  await openCheckout(page);
  await waitReviewReady(page);
  await fillGuest(page);

  for (const width of [320, 375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(200);
    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    await page.screenshot({ path: path.join(SHOTS, `checkout-${width}.png`), fullPage: true });
    record({ kind: "viewport", width, ...metrics, overflow: metrics.scrollWidth - metrics.clientWidth });
    expect(metrics.scrollWidth, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(
      metrics.clientWidth + 1,
    );
  }

  await page.setViewportSize({ width: 375, height: 900 });
  await page.route("**/api/store/orders/estimate", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await page.getByLabel("كود الكوبون").fill("P10TEN");
  await expect(page.getByText(/تقدير سابق/)).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, "state-stale-375.png"), fullPage: true });
  await page.unroute("**/api/store/orders/estimate");

  const storage = await page.evaluate(() => ({
    localKeys: Object.keys(localStorage),
    sessionKeys: Object.keys(sessionStorage),
    cookie: document.cookie,
    localHasOrderCredential: Object.keys(localStorage).some((k) => k.includes("guest-order")),
  }));
  expect(storage.localKeys).toContain(GUEST_CART_KEY);
  expect(storage.localHasOrderCredential).toBe(false);
  expect(storage.sessionKeys).toEqual([]);
  expect(storage.cookie).toBe("");
  record({ kind: "storage_audit", ...storage, cartTokenLength: token.length });
});
