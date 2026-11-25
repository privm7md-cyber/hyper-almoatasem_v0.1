// Order-journey page coverage (5.7): /orders, /orders/[id], /order-confirmation/[id].
//
// This is NOT a navigation test: every scenario drives a REAL order cycle
// (cart -> estimate -> create -> read -> mutate) through the real routes
// against the REAL isolated database, and asserts the SERVER state
// afterwards. A page that renders the right words while the server holds a
// different state is a failure here, not a pass.
//
// Safety:
//   * the spec refuses to run unless `current_database()` is the allowlisted
//     closure database (never Production, never Preview, never a prior-phase
//     evidence database);
//   * the base URL must be a loopback address, so a deployed environment can
//     never be reached by mistake;
//   * raw credentials/tokens are NEVER written to the evidence — only cookie
//     names/flags, order ids, order numbers and counters;
//   * the rate-limit tables are cleared per test (test isolation, not a
//     production behaviour change).
import { test, expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";

const EVIDENCE = process.env.CLOSURE_EVIDENCE_DIR ?? "";
if (EVIDENCE === "") {
  throw new Error(
    "CLOSURE_EVIDENCE_DIR is required (set by _scratch/run-e2e-closure.mjs).",
  );
}
const EXPECTED_DB = "hyper_almoatasem_closure_20261030";
const BASE = process.env.CLOSURE_BASE_URL ?? "http://127.0.0.1:3131";
const GUEST_CART_KEY = "hyper_cart_guest_token";
const PASSWORD = "Closure-E2E-Pass-0001!";
const SHOTS = path.join(EVIDENCE, "screenshots");
fs.mkdirSync(SHOTS, { recursive: true });
const RUNTIME = path.join(EVIDENCE, "e2e-runtime-evidence.ndjson");
fs.writeFileSync(RUNTIME, "");

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
if (!LOOPBACK.has(new URL(BASE).hostname)) {
  throw new Error(`REFUSED_BASE_URL: the closure e2e may only run against loopback, got ${BASE}`);
}

interface CookieFact {
  name: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: string;
  path: string;
  valueLength: number;
}

interface OrderRef {
  id: string;
  number: string;
}

function record(fact: Record<string, unknown>): void {
  fs.appendFileSync(RUNTIME, JSON.stringify(fact) + "\n");
}

/**
 * The application's OWN error announcements.
 *
 * Next.js renders a route announcer (`#__next-route-announcer__`) carrying
 * role="alert" on every page — it is the framework live region that announces
 * route changes to a screen reader, not an application error. Counting it
 * would make every page look like it announced a failure, so it is excluded
 * by id and only the application's error surfaces are inspected.
 */
function appAlerts(page: Page): Locator {
  return page.locator('[role="alert"]:not(#__next-route-announcer__)');
}

let db: Client;
let variants: string[] = [];
let fee = "";

test.beforeAll(async () => {
  const url = process.env.DATABASE_URL ?? "";
  if (url === "") throw new Error("DATABASE_URL missing in the Playwright process.");
  db = new Client({ connectionString: url });
  await db.connect();
  const { rows } = await db.query("SELECT current_database() AS db");
  if (rows[0].db !== EXPECTED_DB) {
    throw new Error(`ISOLATION VIOLATION: connected database is ${rows[0].db}, expected ${EXPECTED_DB}.`);
  }
  // Two sellable variants: the E2E must run against real stock, not a
  // hard-coded fixture that a seed change would silently invalidate.
  const v = await db.query(
    `SELECT pv.id::text AS id
       FROM product_variants pv
       JOIN inventory i ON i.product_variant_id = pv.id
      WHERE pv.is_active AND pv.deleted_at IS NULL
        AND i.available_quantity - i.reserved_quantity >= 2
      ORDER BY pv.created_at
      LIMIT 2`,
  );
  variants = v.rows.map((r) => r.id as string);
  if (variants.length < 2) throw new Error("SETUP: the closure database has fewer than two sellable variants.");
  // The base fee is the resolved fee only while no delivery zone is active.
  const f = await db.query("SELECT value_text AS v FROM store_settings WHERE key = 'delivery.default_fee'");
  const zones = await db.query("SELECT count(*)::int AS n FROM delivery_zones WHERE is_active");
  if (f.rows[0]?.v == null || zones.rows[0].n !== 0) {
    throw new Error(`SETUP: delivery fee is not resolvable (fee=${f.rows[0]?.v} zones=${zones.rows[0].n}).`);
  }
  fee = f.rows[0].v as string;
  record({ kind: "db_target", database: rows[0].db, variants: variants.length, fee });
});

test.beforeEach(async () => {
  const { rows } = await db.query("SELECT current_database() AS db");
  expect(rows[0].db, "every write must target the isolated database").toBe(EXPECTED_DB);
  // Test isolation only: the anonymous creation/read buckets and the login
  // throttles are process-wide for localhost, so each scenario starts clean.
  await db.query("DELETE FROM guest_order_rate_limits");
  await db.query("DELETE FROM customer_auth_rate_limits");
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
            (SELECT count(*)::int FROM guest_order_credentials) AS credentials,
            (SELECT count(*)::int FROM customers) AS customers,
            (SELECT count(*)::int FROM order_status_history) AS history_rows`,
  );
  record({ kind: "db_totals_final", ...totals.rows[0] });
  await db.end();
});

// ---------------------------------------------------------------- helpers --

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

async function orderRow(orderId: string): Promise<{ status: string; customer_id: string | null }> {
  const { rows } = await db.query(
    "SELECT status, customer_id::text AS customer_id FROM orders WHERE id = $1::uuid",
    [orderId],
  );
  if (rows.length === 0) throw new Error(`ORDER_NOT_FOUND: ${orderId}`);
  return rows[0] as { status: string; customer_id: string | null };
}

let phoneSeq = 0;

async function registerCustomer(
  context: BrowserContext,
): Promise<{ id: string; phone: string }> {
  // An 11-digit Egyptian mobile (the identity ladder rejects anything else).
  const phone = `010${String(phoneSeq++ % 10000).padStart(4, "0")}${String(Date.now() % 10000).padStart(4, "0")}`;
  const res = await context.request.post("/api/store/customers/register", {
    data: { phone, firstName: "عميل الاختبار", password: PASSWORD },
  });
  expect(res.status(), "customer registration").toBe(201);
  const body = await res.json();
  return { id: body.data.customer.id as string, phone };
}

/** A registered customer's ACTIVE cart with one line in it. */
async function fillRegisteredCart(context: BrowserContext, variantId: string): Promise<string> {
  const cart = await context.request.post("/api/store/cart");
  expect([200, 201], "registered cart resolve/create").toContain(cart.status());
  const cartId = (await cart.json()).data.cart.id as string;
  const add = await context.request.post("/api/store/cart/items", {
    data: { productVariantId: variantId, quantity: "1" },
  });
  expect(add.status(), "registered line add").toBe(200);
  return cartId;
}

async function createAddress(context: BrowserContext, phone: string): Promise<string> {
  const res = await context.request.post("/api/store/customers/addresses", {
    data: { city: "القاهرة", area: "مدينة نصر", street: "شارع 1", phone },
  });
  expect(res.status(), "customer address").toBe(201);
  return (await res.json()).data.id as string;
}

/** Create a registered order through the real route (session + owned address). */
async function createRegisteredOrder(context: BrowserContext, variantId: string): Promise<OrderRef> {
  const { phone } = await registerCustomer(context);
  const addressId = await createAddress(context, phone);
  const cartId = await fillRegisteredCart(context, variantId);
  const res = await context.request.post("/api/store/orders", {
    data: { addressId, idempotencyKey: `closure-${randomUUID()}`, expectedDeliveryFee: fee },
  });
  expect(res.status(), "registered order creation").toBe(201);
  const body = await res.json();
  const order = body.data.order as { id: string; orderNumber: string };
  record({ kind: "order_created", flow: "registered", cartId, orderId: order.id, number: order.orderNumber });
  return { id: order.id, number: order.orderNumber };
}

/**
 * The guest order is created through the REAL checkout UI: the server action
 * mints the order AND stores the per-order credential cookie, so the browser
 * holds exactly the cookie a real customer would hold.
 */
async function checkoutAsGuest(
  context: BrowserContext,
  page: Page,
  variantId: string,
): Promise<OrderRef> {
  const created = await context.request.post("/api/store/cart");
  expect(created.status(), "guest cart mint").toBe(201);
  const body = await created.json();
  const token = body.data.guestToken as string;
  const cartId = body.data.cart.id as string;
  expect(token).toMatch(/^[0-9a-f]{64}$/);
  const add = await context.request.post("/api/store/cart/items", {
    headers: { "x-guest-token": token },
    data: { productVariantId: variantId, quantity: "1" },
  });
  expect(add.status(), "guest line add").toBe(200);
  await context.addInitScript(
    ({ key, value }: { key: string; value: string }) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        /* storage unavailable: the test would fail on the follow-up request */
      }
    },
    { key: GUEST_CART_KEY, value: token },
  );

  await page.goto("/checkout");
  await expect(page.getByRole("heading", { name: "إتمام الطلب" })).toBeVisible();
  await expect(page.getByText(/عناصر السلة \(/)).toBeVisible({ timeout: 30_000 });
  const confirm = page.getByRole("button", { name: "تأكيد إنشاء الطلب" });
  await expect(confirm).toBeEnabled({ timeout: 30_000 });
  await page.getByLabel("المدينة *").fill("القاهرة");
  await page.getByLabel("الهاتف *").fill("01000000200");
  await page.getByLabel("الاسم الأول *").fill("ضيف الاختبار");
  await confirm.click();
  await expect(page).toHaveURL(/\/order-confirmation\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "تم إنشاء طلبك بنجاح" })).toBeVisible();
  const id = page.url().split("/").pop() as string;
  const { rows } = await db.query(
    "SELECT order_number FROM orders WHERE id = $1::uuid",
    [id],
  );
  if (rows.length === 0) throw new Error(`ORDER_NOT_FOUND after checkout: ${id}`);
  record({ kind: "order_created", flow: "guest", cartId, orderId: id, number: rows[0].order_number });
  return { id, number: rows[0].order_number as string };
}

// ------------------------------------------------------------------ tests --

test("OJ-A registered customer: the order is listed, opened and confirmed", async ({ page, context }) => {
  const order = await createRegisteredOrder(context, variants[0]);

  // 1. the list page shows the order (and NOT the empty state).
  await page.goto("/orders");
  await expect(page.getByRole("heading", { name: "طلباتي" })).toBeVisible();
  await expect(page.getByText("لا توجد طلبات بعد")).toHaveCount(0);
  await expect(page.getByText(order.number)).toBeVisible();

  // 2. the detail page opens from the list and shows the server state.
  await page.getByRole("link", { name: "التفاصيل" }).first().click();
  await expect(page).toHaveURL(new RegExp(`/orders/${order.id}$`));
  await expect(page.locator("h1")).toContainText(order.number);
  await expect(page.getByText("تم تأكيد الطلب").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /سجل الحالة/ })).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, "oj-a-registered-detail.png"), fullPage: true });

  // 3. the confirmation page shows the same order.
  await page.goto(`/order-confirmation/${order.id}`);
  await expect(page.getByRole("heading", { name: "تم إنشاء طلبك بنجاح" })).toBeVisible();
  await expect(page.getByText(order.number)).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, "oj-a-registered-confirmation.png"), fullPage: true });

  // 4. the server agrees with the page.
  const row = await orderRow(order.id);
  expect(row.status).toBe("CONFIRMED");
  expect(row.customer_id).not.toBeNull();
  record({ kind: "journey", flow: "registered", pages: ["orders", "orders/[id]", "order-confirmation/[id]"], status: row.status });
});

test("OJ-B guest: the order credential opens the pages, a foreign one does not", async ({ browser }) => {
  const own = await browser.newContext({ baseURL: BASE });
  const ownPage = await own.newPage();
  const order = await checkoutAsGuest(own, ownPage, variants[0]);

  // The server issued the per-order credential cookie (production policy).
  const facts = await cookieFacts(own);
  const credential = facts.find((c) => /^(?:__Host-)?guest-order-/.test(c.name));
  expect(credential, "the checkout must store the per-order credential cookie").toBeTruthy();
  expect(credential!.name).toBe(`__Host-guest-order-${order.id}`);
  expect(credential!.httpOnly).toBe(true);
  expect(credential!.secure).toBe(true);
  expect(credential!.sameSite.toLowerCase()).toBe("lax");
  expect(credential!.path).toBe("/");
  // The raw credential never reaches client JS.
  const domCookie = await ownPage.evaluate(() => document.cookie);
  expect(domCookie).not.toContain("guest-order-");
  record({ kind: "credential_cookie", cookie: credential });

  // 1. the credential opens the detail page.
  await ownPage.goto(`/orders/${order.id}`);
  await expect(ownPage.locator("h1")).toContainText(order.number);
  await expect(ownPage.getByText("تم تأكيد الطلب").first()).toBeVisible();
  await ownPage.screenshot({ path: path.join(SHOTS, "oj-b-guest-detail.png"), fullPage: true });

  // 2. the credential opens the confirmation page.
  await ownPage.goto(`/order-confirmation/${order.id}`);
  await expect(ownPage.getByRole("heading", { name: "تم إنشاء طلبك بنجاح" })).toBeVisible();
  await expect(ownPage.getByText(order.number)).toBeVisible();

  // 3. a guest has no order LIST (contract): the list page asks for a login.
  await ownPage.goto("/orders");
  await expect(ownPage.getByText("سجّل الدخول لعرض طلباتك")).toBeVisible();

  // 4. a FOREIGN credential does not open the order.
  const foreign = await browser.newContext({ baseURL: BASE });
  const foreignPage = await foreign.newPage();
  await checkoutAsGuest(foreign, foreignPage, variants[1]);
  await foreignPage.goto(`/orders/${order.id}`);
  await expect(foreignPage.getByText("الوصول إلى الطلب يتطلب إثبات ملكية")).toBeVisible();
  await expect(foreignPage.getByText(order.number)).toHaveCount(0);
  await foreignPage.screenshot({ path: path.join(SHOTS, "oj-b-foreign-credential.png"), fullPage: true });

  // 5. an anonymous visitor does not open it either.
  const anon = await browser.newContext({ baseURL: BASE });
  const anonPage = await anon.newPage();
  await anonPage.goto(`/orders/${order.id}`);
  await expect(anonPage.getByText("الوصول إلى الطلب يتطلب إثبات ملكية")).toBeVisible();
  await expect(anonPage.getByText(order.number)).toHaveCount(0);

  await own.close();
  await foreign.close();
  await anon.close();
  record({ kind: "journey", flow: "guest", foreignCredentialDenied: true, anonymousDenied: true });
});

test("OJ-C registered customer: cancelling from the order page changes the server state", async ({
  page,
  context,
}) => {
  const order = await createRegisteredOrder(context, variants[0]);
  await page.goto(`/orders/${order.id}`);
  const cancel = page.getByRole("button", { name: "إلغاء الطلب" });
  await expect(cancel).toBeVisible();

  await cancel.focus();
  await cancel.click();

  // The result is announced in a permanent live region...
  const result = page.locator('p[role="status"]');
  await expect(result).toHaveText(/تم إلغاء الطلب\./);
  // ...the button removed itself, so the focus must NOT fall back to <body>...
  await expect(page.getByRole("button", { name: "إلغاء الطلب" })).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute("role") ?? "none"))
    .toBe("status");
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.tagName ?? "NONE"))
    .not.toBe("BODY");
  await page.screenshot({ path: path.join(SHOTS, "oj-c-cancelled.png"), fullPage: true });

  // ...and the server really cancelled the order (exactly one history row).
  const row = await orderRow(order.id);
  expect(row.status).toBe("CANCELLED");
  const history = await db.query(
    "SELECT count(*)::int AS n FROM order_status_history WHERE order_id = $1::uuid AND new_status = 'CANCELLED'",
    [order.id],
  );
  expect(history.rows[0].n).toBe(1);
  record({ kind: "journey", flow: "cancel", status: row.status, historyRows: history.rows[0].n });
});

test("OJ-D a rate-limited read renders the Arabic notice, not a missing order", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: BASE });
  const page = await context.newPage();
  const order = await checkoutAsGuest(context, page, variants[0]);

  // The first read creates the bucket row for the identity this browser uses.
  await page.goto(`/orders/${order.id}`);
  await expect(page.locator("h1")).toContainText(order.number);

  // Exhaust the guest read bucket (limit 60 / 15 min).
  await db.query(
    "UPDATE guest_order_rate_limits SET attempts = 61 WHERE bucket_key LIKE 'guest-order:read-ip:%'",
  );

  await page.goto(`/orders/${order.id}`);
  await expect(page.getByText("عدد الطلبات كبير في الوقت الحالي")).toBeVisible();
  // A throttled read is NOT a missing order: the number must not be shown and
  // the page must not claim the order does not exist.
  await expect(page.getByText(order.number)).toHaveCount(0);
  await expect(page.getByText("تعذّر عرض التأكيد")).toHaveCount(0);
  await page.screenshot({ path: path.join(SHOTS, "oj-d-rate-limited.png"), fullPage: true });

  await page.goto(`/order-confirmation/${order.id}`);
  await expect(page.getByText("عدد الطلبات كبير في الوقت الحالي")).toBeVisible();
  await expect(page.getByText(order.number)).toHaveCount(0);

  // The limiter internals never leak into the page.
  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(/bucket|window|attempts|limit/i);
  await context.close();
  record({ kind: "journey", flow: "rate-limited", notice: "ar", no404: true });
});

test("OJ-E a customer without orders sees a real heading, not an error", async ({ page, context }) => {
  await registerCustomer(context);
  await page.goto("/orders");
  const heading = page.getByRole("heading", { name: "لا توجد طلبات بعد" });
  await expect(heading).toBeVisible();
  expect(await heading.evaluate((el) => el.tagName)).toBe("H2");
  await expect(appAlerts(page)).toHaveCount(0);
  await page.screenshot({ path: path.join(SHOTS, "oj-e-empty-orders.png"), fullPage: true });
  record({ kind: "journey", flow: "empty-list", headingTag: "H2" });
});
