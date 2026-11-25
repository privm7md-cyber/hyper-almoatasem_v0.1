// P13R account runtime — browser-level verification.
//
// Runs against the PRODUCTION bundle served from the ISOLATED local scratch
// database (never production, never preview). Writes only to the scratch
// database, only with synthetic test identities.
//
// Covers what the DB-backed HTTP suites cannot reach from a browser:
//   - unauthorized access to the account pages (no session, no data leak);
//   - the address lifecycle through the real UI (add → set default → change
//     default → delete);
//   - logout and the gate that follows it;
//   - session EXPIRY: the cookie is still in the browser, the server must
//     refuse it and the account page must fall back to the guest state;
//   - an honest 5xx surface: the write fails, nothing is claimed as saved.
import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import "dotenv/config";

// The scratch database URL is derived from MIGRATION_DATABASE_URL by
// replacing the path with the allowlisted scratch name — the same rewrite
// every repo test script performs, so the production database is never
// reachable from here.
const DB = process.env.P13R_DB ?? "hyper_almoatasem_scratch";
const PW = "P13R-Browser-Pass-0001!";
// The synthetic phone numbers are RUN-SCOPED: the scratch database keeps the
// accounts a previous run created, so a fixed number would answer 409 on the
// second run. The seed makes every run use numbers nothing else has used
// (0109XXXXXXy — 11 digits, in a range no other suite touches).
const RUN_SEED = (process.env.P13R_PHONE_SEED ?? String(Math.floor(Math.random() * 1_000_000)))
  .slice(-6)
  .padStart(6, "0");
const PHONE_A = `0109${RUN_SEED}1`;
const PHONE_B = `0109${RUN_SEED}2`;
const PHONE_C = `0109${RUN_SEED}3`;
const CANON = (p: string) => `2010${p.slice(3)}`;

function scratchUrl(): string {
  const u = new URL(process.env.MIGRATION_DATABASE_URL as string);
  u.pathname = `/${DB}`;
  return u.toString();
}

async function q(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  const c = new Client({ connectionString: scratchUrl(), connectionTimeoutMillis: 8000 });
  await c.connect();
  try {
    return (await c.query(sql, params)).rows;
  } finally {
    await c.end().catch(() => {});
  }
}

async function register(page: Page, phone: string, firstName: string): Promise<void> {
  await page.goto("/register");
  await page.getByLabel(/رقم الهاتف/).fill(phone);
  await page.getByLabel(/الاسم الأول/).fill(firstName);
  await page.getByLabel(/كلمة المرور/).fill(PW);
  await page.getByRole("button", { name: "إنشاء الحساب" }).click();
  // A rejected registration (409 / rate limit) must fail FAST with the server's
  // own message — never wait out the test timeout on a navigation that will
  // not happen.
  const outcome = await Promise.race([
    page
      .waitForURL(/\/account/, { timeout: 20_000 })
      .then(() => "registered")
      .catch(() => "no-navigation"),
    page
      .locator('p[role="alert"]')
      .first()
      .waitFor({ state: "visible", timeout: 20_000 })
      .then(() => "rejected")
      .catch(() => "no-alert"),
  ]);
  if (outcome !== "registered") {
    const alert = await page
      .locator('p[role="alert"]')
      .first()
      .textContent()
      .catch(() => null);
    throw new Error(
      `REGISTRATION_FAILED outcome=${outcome} phone=${phone} message=${alert ?? "(none)"}`,
    );
  }
}

test.setTimeout(120_000);

test("UNAUTH: the account pages expose no account data without a session", async ({ page }) => {
  // The addresses gate redirects to login and carries the internal destination.
  await page.goto("/account/addresses");
  await expect(page).toHaveURL(/\/login\?next=%2Faccount%2Faddresses/);
  await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();

  // The account page falls back to an honest guest state.
  await page.goto("/account");
  await expect(page.getByText(/تتصفح كضيف/)).toBeVisible();

  // The orders list is gated too, and never lists anything.
  await page.goto("/orders");
  await expect(page.getByText(/سجّل الدخول لعرض طلباتك/)).toBeVisible();

  // No account identifier leaks into any of the three guest renders.
  const body = await page.innerText("body");
  expect(body).not.toContain(CANON(PHONE_A));
  expect(body).not.toContain(CANON(PHONE_B));
  expect(body).not.toContain(CANON(PHONE_C));
});

test("UNAUTH: the account pages are excluded from indexing", async ({ page }) => {
  for (const path of ["/account", "/account/addresses", "/orders"]) {
    await page.goto(path);
    const robots = await page.locator('meta[name="robots"]').getAttribute("content");
    expect(robots, path).toContain("noindex");
  }
});

test("LIFECYCLE: register → address → default → change default → delete → logout", async ({ page }) => {
  await register(page, PHONE_A, "P13RA");
  await expect(page.getByRole("heading", { name: /أهلًا P13RA/ })).toBeVisible();

  await page.goto("/account/addresses");
  await expect(page.getByRole("heading", { name: "عناويني" })).toBeVisible();

  // ---- add the first address (not default) ----
  await page.getByLabel(/^المدينة/).fill("مطاي");
  await page.getByLabel(/^الهاتف/).fill("01099230011");
  await page.getByLabel(/^تسمية/).fill("المنزل");
  await page.getByRole("button", { name: "حفظ العنوان" }).click();
  await expect(page.getByText("المنزل")).toBeVisible();
  await expect(page.getByText("(افتراضي)")).toHaveCount(0);

  // ---- add the second address AS default ----
  await page.getByLabel(/^المدينة/).fill("مطاي");
  await page.getByLabel(/^الهاتف/).fill("01099230012");
  await page.getByLabel(/^تسمية/).fill("العمل");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "حفظ العنوان" }).click();
  await expect(page.getByText("العمل")).toBeVisible();

  const home = page.locator("li", { hasText: "المنزل" }).first();
  const work = page.locator("li", { hasText: "العمل" }).first();
  await expect(work.getByText("(افتراضي)")).toBeVisible();
  await expect(home.getByText("(افتراضي)")).toHaveCount(0);

  // ---- change the default to the first address ----
  await home.getByRole("button", { name: "تعيين افتراضي" }).click();
  await expect(home.getByText("(افتراضي)")).toBeVisible();
  await expect(work.getByText("(افتراضي)")).toHaveCount(0);

  // ---- the account page reports the new default ----
  await page.goto("/account");
  await expect(page.getByText(/العنوان الافتراضي: المنزل/)).toBeVisible();

  // ---- delete the second address ----
  await page.goto("/account/addresses");
  const workRow = page.locator("li", { hasText: "العمل" }).first();
  await workRow.getByRole("button", { name: "حذف" }).click();
  await expect(page.getByText("العمل")).toHaveCount(0);
  await expect(page.getByText("المنزل")).toBeVisible();

  // ---- logout ends the session and re-arms the gate ----
  await page.goto("/account");
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await page.waitForURL(/\/$/);
  await page.goto("/account/addresses");
  await expect(page).toHaveURL(/\/login\?next=%2Faccount%2Faddresses/);
});

test("EXPIRY: an expired session is refused by the server and the page falls back to guest", async ({ page }) => {
  await register(page, PHONE_B, "P13RB");
  await expect(page.getByRole("heading", { name: /أهلًا P13RB/ })).toBeVisible();

  // Backdate the live session row the same way the API suite does (both
  // stamps, because the CHECK keeps created_at < expires_at).
  const rows = await q(
    `SELECT s.id::text AS id FROM customer_sessions s
       JOIN customers c ON c.id = s.customer_id
      WHERE c.phone = $1 AND s.revoked_at IS NULL
      ORDER BY s.created_at DESC LIMIT 1`,
    [CANON(PHONE_B)],
  );
  expect(rows.length).toBe(1);
  await q(
    `UPDATE customer_sessions
        SET created_at = now() - interval '31 days', expires_at = now() - interval '1 day'
      WHERE id = $1::uuid`,
    [rows[0].id],
  );

  // The cookie is STILL in the browser — the server must refuse it.
  const cookies = await page.context().cookies();
  expect(cookies.some((c) => c.name === "__Host-customer-session")).toBe(true);

  await page.goto("/account");
  await expect(page.getByText(/تتصفح كضيف/)).toBeVisible();
  const body = await page.innerText("body");
  expect(body).not.toContain(CANON(PHONE_B));

  await page.goto("/account/addresses");
  await expect(page).toHaveURL(/\/login\?next=%2Faccount%2Faddresses/);
});

test("5XX: a failed address write shows an error and never claims success", async ({ page }) => {
  await register(page, PHONE_C, "P13RC");
  await page.goto("/account/addresses");

  await page.route("**/api/store/customers/addresses", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "INTERNAL", message: "حدث خطأ داخلي.", details: null } }),
      });
      return;
    }
    await route.fallback();
  });

  await page.getByLabel(/^المدينة/).fill("مطاي");
  await page.getByLabel(/^الهاتف/).fill("01099230033");
  await page.getByRole("button", { name: "حفظ العنوان" }).click();

  // The failure is reported honestly… (scoped to the form alert: Next's route
  // announcer also carries role="alert" and would break a strict locator)
  await expect(page.locator('p[role="alert"]')).toContainText("حدث خطأ داخلي.");
  // …nothing was saved…
  await expect(page.getByText("لا توجد عناوين محفوظة")).toBeVisible();
  // …and the form was not cleared as if the write had succeeded.
  await expect(page.getByLabel(/^المدينة/)).toHaveValue("مطاي");
});
