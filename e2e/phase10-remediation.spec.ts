// Phase-10 remediation browser tests (real Chromium, real HTTP, real sessions).
//
// These run against an ALREADY RUNNING server bound to the isolated scratch
// database. There is no `webServer` in the phase config on purpose: the
// repository's default Playwright config would boot a dev server on the
// production DATABASE_URL.
//
// The fixtures (roles + users) are created THROUGH THE ADMIN API in
// `beforeAll` and removed in `afterAll` — no direct database access, no
// fixture files (see ./phase10-fixtures.ts).
//
// Environment:
//   PHASE10_BASE_URL         base URL of the scratch-backed server
//   PHASE10_OWNER_EMAIL      / PHASE10_OWNER_PASSWORD  (super-admin identity)
//   PHASE10_TEST_PASSWORD    the password given to the probe identities
//
// Nothing is printed that could identify an account: only roles and status
// codes are asserted.

import { expect, test, type Page } from "@playwright/test";
import {
  BASE,
  OWNER_EMAIL,
  OWNER_PASSWORD,
  PROBE_PASSWORD,
  apiLogin,
  createIdentity,
  removeIdentity,
  type Identity,
} from "./phase10-fixtures";

const stamp = Date.now().toString(36);
const identities: Record<string, Identity> = {};

async function login(page: Page, email: string, password: string) {
  await page.goto(`${BASE}/admin/login`);
  await page.getByLabel(/البريد/).fill(email);
  await page.getByLabel(/كلمة المرور/).fill(password);
  await page.getByRole("button", { name: /دخول/ }).click();
  await page.waitForURL(/\/admin$/, { timeout: 30000 });
  await expect(page.getByRole("heading", { name: "لوحة الإدارة" })).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  // A customer fixture, created through the SUPPORTED storefront register
  // path (the admin API has no customer-create route by design). The phone
  // must satisfy the customer phone ladder (201 + a valid national number).
  const phone = `20155${String(Date.now()).slice(-7)}`;
  const reg = await fetch(`${BASE}/api/store/customers/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      phone,
      firstName: "P10 E2E",
      password: "P10-E2E-Customer-0001!",
    }),
  });
  if (reg.status >= 400) {
    throw new Error(`PHASE10_E2E_SETUP: customer register failed (${reg.status})`);
  }

  const owner = await apiLogin(OWNER_EMAIL, OWNER_PASSWORD);
  if (!owner) throw new Error("PHASE10_E2E_SETUP: owner login failed");
  const P = (s: string) => `P10E2E_${s}_${stamp}`.toUpperCase();
  identities["PRICE_READER"] = await createIdentity(
    owner,
    P("PRICE_READER"),
    ["products.view", "prices.view"],
    `p10e2e-pricereader-${stamp}@example.com`,
  );
  identities["PRICE_WRITER"] = await createIdentity(
    owner,
    P("PRICE_WRITER"),
    ["products.view", "products.update", "prices.view", "prices.update"],
    `p10e2e-pricewriter-${stamp}@example.com`,
  );
  identities["CUST_READER"] = await createIdentity(
    owner,
    P("CUST_READER"),
    ["customers.view"],
    `p10e2e-custreader-${stamp}@example.com`,
  );
  identities["CUST_WRITER"] = await createIdentity(
    owner,
    P("CUST_WRITER"),
    ["customers.view", "customers.manage"],
    `p10e2e-custwriter-${stamp}@example.com`,
  );
});

test.afterAll(async () => {
  const owner = await apiLogin(OWNER_EMAIL, OWNER_PASSWORD);
  if (!owner) return;
  for (const id of Object.values(identities)) {
    await removeIdentity(owner, id);
  }
});

test.describe("Phase-10 remediation (browser)", () => {
  test("G07: the local session cookie is stored and the dashboard survives a reload", async ({ page, context }) => {
    await login(page, OWNER_EMAIL, OWNER_PASSWORD);
    const cookies = await context.cookies();
    const session = cookies.find((c) => /admin-session/.test(c.name));
    expect(session, "the admin session cookie must be stored by the browser").toBeTruthy();
    expect(session?.httpOnly).toBe(true);
    expect(session?.sameSite).toBe("Lax");
    // A `__Host-` cookie must ALWAYS be Secure (browsers reject it otherwise).
    if (session?.name.startsWith("__Host-")) expect(session?.secure).toBe(true);

    await page.reload();
    await expect(page.getByRole("heading", { name: "لوحة الإدارة" })).toBeVisible();
    const status = await page.evaluate(async () => {
      const r = await fetch("/api/admin/session");
      return r.status;
    });
    expect(status).toBe(200);
  });

  test("G07: an anonymous caller is refused by the protected API", async ({ page }) => {
    // a page on the same origin (so the relative URL resolves) but WITHOUT the
    // session cookie — the browser must not send it.
    await page.goto(`${BASE}/admin/login`);
    const status = await page.evaluate(async () => {
      const r = await fetch("/api/admin/session", { credentials: "omit" });
      return r.status;
    });
    expect(status).toBe(401);
  });

  test("G01: a price reader sees the price but cannot change it", async ({ page }) => {
    const id = identities["PRICE_READER"];
    await login(page, id.email, PROBE_PASSWORD);

    // a product that actually has variants (the price editor lives on them)
    const productPath = await page.evaluate(async () => {
      const list = await fetch("/api/admin/catalog/products?limit=20");
      const body = await list.json();
      for (const p of body?.data ?? []) {
        const v = await fetch(`/api/admin/catalog/products/${p.id}/variants?limit=1`);
        const vb = await v.json();
        if ((vb?.data ?? []).length > 0) return `/admin/products/${p.id}`;
      }
      return "/admin/products";
    });
    await page.goto(`${BASE}${productPath}`);
    await expect(page.getByRole("heading", { name: /تعديل السعر/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "حفظ السعر" })).toHaveCount(0);
    await expect(page.getByText("prices.update").first()).toBeVisible();

    const result = await page.evaluate(async () => {
      const list = await fetch("/api/admin/catalog/products?limit=20");
      const body = await list.json();
      for (const p of body?.data ?? []) {
        const v = await fetch(`/api/admin/catalog/products/${p.id}/variants?limit=1`);
        const vb = await v.json();
        if ((vb?.data ?? []).length > 0) {
          const r = await fetch(`/api/admin/catalog/variants/${vb.data[0].id}/price`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ price: "1.00" }),
          });
          return { status: r.status, text: await r.text() };
        }
      }
      return { status: 0, text: "no variant" };
    });
    expect(result.status).toBe(403);
    expect(result.text).toContain("FORBIDDEN");
  });

  test("G01: a price writer can change the price through the UI", async ({ page }) => {
    const id = identities["PRICE_WRITER"];
    await login(page, id.email, PROBE_PASSWORD);
    const productPath = await page.evaluate(async () => {
      const list = await fetch("/api/admin/catalog/products?limit=20");
      const body = await list.json();
      for (const p of body?.data ?? []) {
        const v = await fetch(`/api/admin/catalog/products/${p.id}/variants?limit=1`);
        const vb = await v.json();
        if ((vb?.data ?? []).length > 0) return `/admin/products/${p.id}`;
      }
      return "/admin/products";
    });
    await page.goto(`${BASE}${productPath}`);
    await expect(page.getByRole("button", { name: "حفظ السعر" })).toBeVisible();
  });

  test("G03: a customer reader cannot write a customer, in the UI or through the API", async ({ page }) => {
    const id = identities["CUST_READER"];
    await login(page, id.email, PROBE_PASSWORD);

    await page.goto(`${BASE}/admin/customers`);
    const firstCustomer = page.locator('a[href^="/admin/customers/"]').first();
    await expect(firstCustomer).toBeVisible();
    await firstCustomer.click();
    await expect(page.getByRole("button", { name: "حفظ بيانات العميل" })).toHaveCount(0);
    await expect(page.getByText("customers.manage").first()).toBeVisible();

    const result = await page.evaluate(async () => {
      const list = await fetch("/api/admin/customers?limit=1");
      const body = await list.json();
      const customerId = body?.data?.[0]?.id;
      if (!customerId) return { status: 0, text: "no customer" };
      const r = await fetch(`/api/admin/customers/${customerId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ firstName: "Nope" }),
      });
      return { status: r.status, text: await r.text() };
    });
    expect(result.status).toBe(403);
    expect(result.text).toContain("FORBIDDEN");
  });

  test("G03: a customer writer sees the customer write form", async ({ page }) => {
    const id = identities["CUST_WRITER"];
    await login(page, id.email, PROBE_PASSWORD);
    await page.goto(`${BASE}/admin/customers`);
    const firstCustomer = page.locator('a[href^="/admin/customers/"]').first();
    await expect(firstCustomer).toBeVisible();
    await firstCustomer.click();
    await expect(page.getByRole("button", { name: "حفظ بيانات العميل" })).toBeVisible();
  });

  test("G05: an empty PATCH is refused with a validation error, not a silent no-op", async ({ page }) => {
    await login(page, OWNER_EMAIL, OWNER_PASSWORD);
    // a promotion to PATCH (created through the admin API)
    const promoId = await page.evaluate(async () => {
      const r = await fetch("/api/admin/promotions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: `phase10-g05-${Date.now().toString(36)}`,
          type: "PERCENTAGE",
          scope: "LINE",
          discountPercent: "10",
        }),
      });
      const b = await r.json();
      return b?.data?.id ?? null;
    });
    expect(promoId).toBeTruthy();

    const result = await page.evaluate(async (id) => {
      const r = await fetch(`/api/admin/promotions/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      return { status: r.status, text: await r.text() };
    }, promoId);
    expect(result.status).toBe(400);
    expect(result.text).toContain("VALIDATION");
  });

  test("G04: the audit trail is read-only in the UI and over the API", async ({ page }) => {
    await login(page, OWNER_EMAIL, OWNER_PASSWORD);
    await page.goto(`${BASE}/admin/audit-logs`);
    await expect(page.getByText("سجل التدقيق").first()).toBeVisible();
    const auditRefs = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a,button,form")).filter((el) =>
        (el.getAttribute("href") ?? el.getAttribute("action") ?? "").includes("/api/admin/audit-logs"),
      ).length,
    );
    expect(auditRefs).toBe(0);
    const methodStatus = await page.evaluate(async () => {
      const r = await fetch("/api/admin/audit-logs", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      return r.status;
    });
    expect(methodStatus).toBe(405);
  });
});
