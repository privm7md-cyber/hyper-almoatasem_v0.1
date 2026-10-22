// Phase-10 admin browser tests (real Chromium, real HTTP, real admin session).
//
// These run against an ALREADY RUNNING server that is bound to the isolated
// scratch database (see the Phase-10 evidence report). There is no
// `webServer` in the phase config on purpose: the repository's default
// Playwright config would boot a dev server on the production DATABASE_URL.
//
// Environment:
//   PHASE10_BASE_URL        base URL of the scratch-backed server
//   PHASE10_OWNER_EMAIL     / PHASE10_OWNER_PASSWORD   (super-admin identity)
//   PHASE10_STORE_EMAIL     / PHASE10_TEST_PASSWORD    (business-operator identity)
//   PHASE10_VIEWER_EMAIL    / PHASE10_TEST_PASSWORD    (read-only identity)
//
// Nothing is printed that could identify an account: only roles and status
// codes are asserted.

import { expect, test, type Page } from "@playwright/test";
import {
  BASE,
  OWNER_EMAIL,
  OWNER_PASSWORD,
  PROBE_PASSWORD,
  api,
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
  const owner = await apiLogin(OWNER_EMAIL, OWNER_PASSWORD);
  if (!owner) throw new Error("PHASE10_E2E_SETUP: owner login failed");
  // the seeded business-operator role, assigned as-is
  const roles = await api<Array<{ id: string; name: string }>>(owner, "GET", "/api/admin/roles?limit=100");
  const storeRole = (roles.data ?? []).find((r) => r.name === "STORE_ADMIN");
  if (!storeRole) throw new Error("PHASE10_E2E_SETUP: STORE_ADMIN role not found");
  const storeEmail = `p10e2e-store-${stamp}@example.com`;
  const user = await api<{ id: string; email: string }>(owner, "POST", "/api/admin/users", {
    name: "P10 Store",
    email: storeEmail,
  });
  if (!user.data) throw new Error("PHASE10_E2E_SETUP: store user creation failed");
  await api(owner, "POST", `/api/admin/users/${user.data.id}/password`, { password: PROBE_PASSWORD });
  await api(owner, "POST", `/api/admin/users/${user.data.id}/roles`, { roleId: storeRole.id });
  identities["STORE"] = { email: user.data.email, roleId: storeRole.id, userId: user.data.id };

  identities["VIEWER"] = await createIdentity(
    owner,
    `P10E2E_VIEWER_${stamp}`,
    ["orders.view", "products.view", "inventory.view", "promotions.view", "coupons.view", "customers.view"],
    `p10e2e-viewer-${stamp}@example.com`,
  );
});

test.afterAll(async () => {
  const owner = await apiLogin(OWNER_EMAIL, OWNER_PASSWORD);
  if (!owner) return;
  for (const id of Object.values(identities)) {
    await removeIdentity(owner, id);
  }
});

test.describe("Phase-10 admin panel (browser)", () => {
  test("anonymous access to an admin route is redirected to the login screen", async ({ page }) => {
    await page.goto(`${BASE}/admin/orders`);
    await expect(page).toHaveURL(/\/admin\/login/);
    await expect(page.getByRole("button", { name: /دخول/ })).toBeVisible();
  });

  test("read-only role: read pages work, every write control is hidden", async ({ page }) => {
    await login(page, identities["VIEWER"].email, PROBE_PASSWORD);

    // Sidebar shows only the domains this role may read.
    const nav = page.getByRole("navigation", { name: "أقسام الإدارة" });
    await expect(nav.getByRole("link", { name: "الطلبات" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "المنتجات" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "المخزون" })).toBeVisible();
    // Platform-security sections are hidden (roles.view / settings.view absent).
    await expect(nav.getByRole("link", { name: "المستخدمون" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "الإعدادات" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "سجل التدقيق" })).toHaveCount(0);

    // Inventory: the write forms are gone, and the missing key is named.
    await page.goto(`${BASE}/admin/inventory`);
    await expect(page.getByText("تعديل يدوي (inventory.adjust)")).toBeVisible();
    await expect(page.getByRole("button", { name: "حفظ التعديل" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "حفظ الحد" })).toHaveCount(0);
    await expect(page.getByText("inventory.adjust").first()).toBeVisible();

    // Catalog: no create control.
    await page.goto(`${BASE}/admin/products`);
    await expect(page.getByRole("button", { name: "إنشاء المنتج" })).toHaveCount(0);
    await expect(page.getByText("products.create").first()).toBeVisible();

    // A platform-security page is refused server-side (not merely hidden).
    const res = await page.goto(`${BASE}/admin/settings`);
    expect(res?.status()).toBe(403);
  });

  test("read-only role: a direct API call to a forbidden write is rejected", async ({ page }) => {
    await login(page, identities["VIEWER"].email, PROBE_PASSWORD);
    const result = await page.evaluate(async () => {
      const r = await fetch("/api/admin/catalog/products", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "probe",
          categoryId: "00000000-0000-7000-8000-000000000000",
          productType: "PIECE",
          unit: "PIECE",
        }),
      });
      return { status: r.status, body: await r.text() };
    });
    expect(result.status).toBe(403);
    expect(result.body).toContain("FORBIDDEN");
  });

  test("store admin: business write controls are present and a real create round-trips", async ({ page }) => {
    await login(page, identities["STORE"].email, PROBE_PASSWORD);

    await page.goto(`${BASE}/admin/inventory`);
    await expect(page.getByRole("button", { name: "حفظ التعديل" })).toBeVisible();
    await expect(page.getByRole("button", { name: "حفظ الحد" })).toBeVisible();

    // Platform-security pages stay refused for STORE_ADMIN.
    const settingsRes = await page.goto(`${BASE}/admin/settings`);
    expect(settingsRes?.status()).toBe(403);

    // Real mutation: create a product through the UI and watch the API call.
    await page.goto(`${BASE}/admin/products`);
    await page.getByLabel(/اسم المنتج/).fill(`phase10-ui-${stamp}`);
    await page.getByLabel(/التصنيف/).selectOption({ index: 1 });
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/admin/catalog/products") && r.request().method() === "POST",
      ),
      page.getByRole("button", { name: "إنشاء المنتج" }).click(),
    ]);
    expect(response.status()).toBe(201);

    // The server-rendered list must show the new product AFTER the refresh
    // (this is the operator-visible result of the action).
    await expect(page.getByText(`phase10-ui-${stamp}`).first()).toBeVisible();
  });

  test("store admin: taxonomy page creates a category and refreshes the list", async ({ page }) => {
    await login(page, identities["STORE"].email, PROBE_PASSWORD);
    await page.goto(`${BASE}/admin/taxonomy`);
    await page.getByLabel(/اسم التصنيف/).first().fill(`phase10-ui-cat-${stamp}`);
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/admin/catalog/categories") && r.request().method() === "POST",
      ),
      page.getByRole("button", { name: "إنشاء التصنيف" }).click(),
    ]);
    expect(response.status()).toBe(201);
    await expect(page.getByText(`phase10-ui-cat-${stamp}`).first()).toBeVisible();
  });

  test("owner: settings editor saves and the value survives a reload", async ({ page }) => {
    await login(page, OWNER_EMAIL, OWNER_PASSWORD);
    await page.goto(`${BASE}/admin/settings`);
    const row = page.locator("li", { hasText: "store.name" }).first();
    const input = row.getByRole("textbox").first();
    const original = await input.inputValue();
    const next = `Hyper Al-Moatasem P10 ${stamp}`;
    await input.fill(next);
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/admin/settings/") && r.request().method() === "PATCH",
      ),
      row.getByRole("button", { name: /حفظ/ }).click(),
    ]);
    expect(response.status()).toBe(200);

    await page.reload();
    const after = await page
      .locator("li", { hasText: "store.name" })
      .first()
      .getByRole("textbox")
      .first()
      .inputValue();
    expect(after).toBe(next);

    // Revert to the original value so the shared fixture stays unchanged.
    const reverted = page.locator("li", { hasText: "store.name" }).first();
    await reverted.getByRole("textbox").first().fill(original);
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/admin/settings/") && r.request().method() === "PATCH",
      ),
      reverted.getByRole("button", { name: /حفظ/ }).click(),
    ]);
    await page.reload();
    const restored = await page
      .locator("li", { hasText: "store.name" })
      .first()
      .getByRole("textbox")
      .first()
      .inputValue();
    expect(restored).toBe(original);
  });

  test("owner: audit log is read-only in the UI and offers no mutation control", async ({ page }) => {
    await login(page, OWNER_EMAIL, OWNER_PASSWORD);
    await page.goto(`${BASE}/admin/audit-logs`);
    await expect(page.getByText("سجل التدقيق").first()).toBeVisible();
    // Nothing on the page points at an audit-log mutation endpoint.
    const auditRefs = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a,button,form")).filter((el) =>
        (el.getAttribute("href") ?? el.getAttribute("action") ?? "").includes("/api/admin/audit-logs"),
      ).length,
    );
    expect(auditRefs).toBe(0);
    // No edit/delete affordance on any audit row.
    await expect(page.getByRole("button", { name: /حذف|تعديل/ })).toHaveCount(0);
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

  test("owner: roles page exposes the permission registry and the grants manager", async ({ page }) => {
    await login(page, OWNER_EMAIL, OWNER_PASSWORD);
    await page.goto(`${BASE}/admin/roles`);
    await page.getByRole("link", { name: /P10E2E_VIEWER_/ }).first().click();
    await expect(page.getByText("الصلاحيات (roles.manage)")).toBeVisible();
    await expect(page.getByRole("button", { name: "منح" })).toBeVisible();
  });

  test("owner: the permissions registry page is reachable from the sidebar", async ({ page }) => {
    await login(page, OWNER_EMAIL, OWNER_PASSWORD);
    const nav = page.getByRole("navigation", { name: "أقسام الإدارة" });
    await expect(nav.getByRole("link", { name: "سجل الصلاحيات" })).toBeVisible();
    await nav.getByRole("link", { name: "سجل الصلاحيات" }).click();
    await expect(page).toHaveURL(/\/admin\/permissions/);
    await expect(page.getByText("products.view").first()).toBeVisible();
  });
});
