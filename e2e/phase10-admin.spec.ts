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
  const roles = await api<Array<{ id: string; name: string }>>(owner, "GET", "/api/admin/roles?limit=100&search=STORE_ADMIN");
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

    // Sidebar shows only the domains this role may read under the Phase-11 semantic landmark.
    const nav = page.getByRole("navigation", { name: "التنقل الرئيسي" });
    await expect(nav.getByRole("link", { name: "الطلبات" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "كل المنتجات" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "المخزون" })).toBeVisible();
    // Platform-security sections are hidden (roles.view / settings.view / audit_logs.view absent).
    await expect(nav.getByRole("link", { name: "المستخدمون" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "إعدادات المتجر" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "سجل التغييرات" })).toHaveCount(0);

    // Inventory: the write forms are replaced by Arabic PermissionGate notes (no raw technical key leaked).
    await page.goto(`${BASE}/admin/inventory`);
    await expect(page.getByText(/إضافة كمية للمخزون — غير متاح لحسابك/).first()).toBeVisible();
    await expect(page.getByText(/تعديل كميات المخزون/).first()).toBeVisible();
    await expect(page.getByText("inventory.adjust")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "سجّل الإضافة" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "سجّل التسوية" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "سجّل حد التنبيه" })).toHaveCount(0);

    // Catalog: no create link or form control; human-readable notice is shown instead.
    await page.goto(`${BASE}/admin/products`);
    await expect(page.getByRole("link", { name: "منتج جديد" })).toHaveCount(0);
    await expect(page.getByText(/إضافة منتج جديد محتاج صلاحية إضافية/).first()).toBeVisible();
    await expect(page.getByText("products.create")).toHaveCount(0);

    // A platform-security page is refused server-side (streaming SSR renders the 403 boundary and the API returns 403).
    await page.goto(`${BASE}/admin/settings`);
    await expect(page.getByRole("heading", { name: /403 — غير مصرح/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "إعدادات المتجر" })).toHaveCount(0);
    const settingsApiStatus = await page.evaluate(async () => {
      const r = await fetch("/api/admin/settings");
      return r.status;
    });
    expect(settingsApiStatus).toBe(403);
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
    await expect(page.getByRole("button", { name: "سجّل الإضافة" })).toBeVisible();
    await expect(page.getByRole("button", { name: "سجّل التسوية" })).toBeVisible();
    await expect(page.getByRole("button", { name: "سجّل حد التنبيه" })).toBeVisible();

    // Platform-security pages stay refused for STORE_ADMIN (403 boundary + API 403).
    await page.goto(`${BASE}/admin/settings`);
    await expect(page.getByRole("heading", { name: /403 — غير مصرح/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "إعدادات المتجر" })).toHaveCount(0);
    const storeSettingsApiStatus = await page.evaluate(async () => {
      const r = await fetch("/api/admin/settings");
      return r.status;
    });
    expect(storeSettingsApiStatus).toBe(403);

    // Real mutation: navigate via "منتج جديد" to /admin/products/new and create a product + first shape.
    const productName = `phase10-ui-${stamp}`;
    await page.goto(`${BASE}/admin/products`);
    await page.getByRole("link", { name: "منتج جديد" }).first().click();
    await page.waitForURL(/\/admin\/products\/new/);

    await page.getByLabel(/اسم المنتج/).fill(productName);
    await page.getByLabel(/التصنيف/).selectOption({ index: 1 });
    await page.getByLabel(/اسم الشكل/).fill(`عبوة ${stamp}`);
    await page.getByLabel(/سعر البيع/).fill("29.50");

    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/admin/catalog/products") && r.request().method() === "POST",
      ),
      page.getByRole("button", { name: "احفظ المنتج" }).click(),
    ]);
    expect(response.status()).toBe(201);
    await page.waitForURL(/\/admin\/products\/[0-9a-f-]+/);
    await expect(page.getByRole("heading", { name: productName })).toBeVisible();

    // Verify server-rendered search lists the newly created product cleanly.
    await page.goto(`${BASE}/admin/products?search=${encodeURIComponent(productName)}`);
    await expect(page.getByText(productName).first()).toBeVisible();
  });

  test("store admin: taxonomy page creates a category and refreshes the list", async ({ page }) => {
    await login(page, identities["STORE"].email, PROBE_PASSWORD);
    const catName = `phase10-ui-cat-${stamp}`;
    await page.goto(`${BASE}/admin/taxonomy`);
    await page.getByLabel(/اسم التصنيف/).first().fill(catName);
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/admin/catalog/categories") && r.request().method() === "POST",
      ),
      page.getByRole("button", { name: "أضف التصنيف" }).click(),
    ]);
    expect(response.status()).toBe(201);
    await expect(page.getByText("تم إنشاء التصنيف.")).toBeVisible();

    // Verify persisted category appears in the server-rendered catalogue filter.
    await page.goto(`${BASE}/admin/taxonomy?q=${encodeURIComponent(catName)}`);
    await expect(page.getByText(catName).first()).toBeVisible();
  });

  test("owner: settings editor saves editable delivery fee across reloads and blocks frozen store.name", async ({ page }) => {
    await login(page, OWNER_EMAIL, OWNER_PASSWORD);
    await page.goto(`${BASE}/admin/settings`);

    // Frozen keys (store.name) remain explicitly marked read-only and blocked server-side (403).
    const frozenRow = page.locator("tr", { hasText: "اسم المتجر" }).first();
    await expect(frozenRow).toContainText("لأ — للعرض فقط");
    const frozenPatchStatus = await page.evaluate(async () => {
      const r = await fetch("/api/admin/settings/store.name", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: "Tamper" }),
      });
      return r.status;
    });
    expect(frozenPatchStatus).toBe(403);

    // Editable active key (delivery.default_fee) persists via SettingEditForm and restores cleanly.
    const feeInput = page.locator('input[type="number"]').first();
    const original = await feeInput.inputValue();
    const next = original === "45" ? "50" : "45";
    await feeInput.fill(next);
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/admin/settings/delivery.default_fee") && r.request().method() === "PATCH",
      ),
      page.getByRole("button", { name: "احفظ" }).first().click(),
    ]);
    expect(response.status()).toBe(200);

    await page.reload();
    expect(await page.locator('input[type="number"]').first().inputValue()).toBe(next);

    // Revert to the original value so the shared fixture stays unchanged.
    await page.locator('input[type="number"]').first().fill(original);
    const [revertRes] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/admin/settings/delivery.default_fee") && r.request().method() === "PATCH",
      ),
      page.getByRole("button", { name: "احفظ" }).first().click(),
    ]);
    expect(revertRes.status()).toBe(200);
    await page.reload();
    expect(await page.locator('input[type="number"]').first().inputValue()).toBe(original);
  });

  test("owner: audit log is read-only in the UI and offers no mutation control", async ({ page }) => {
    await login(page, OWNER_EMAIL, OWNER_PASSWORD);
    await page.goto(`${BASE}/admin/audit-logs`);
    await expect(page.getByRole("heading", { name: "سجل التغييرات" })).toBeVisible();
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
    const searchTerm = `P10E2E_VIEWER_${stamp}`;
    await page.getByLabel(/بحث باسم الدور/).fill(searchTerm);
    await Promise.all([
      page.waitForURL((url) => url.pathname === "/admin/roles" && url.searchParams.get("search") === searchTerm),
      page.getByRole("button", { name: "بحث", exact: true }).click(),
    ]);
    // Ascii machine-style role names intentionally display as "دور مخصص" under Phase-11 Arabic terminology.
    await expect(page.getByText("1 دور في الصفحة دي").first()).toBeVisible();
    await page.locator('tbody a[href^="/admin/roles/"]').first().click();
    await expect(page).toHaveURL(/\/admin\/roles\/[^/]+$/);
    await expect(page.getByText("الصلاحيات اللي في الدور").first()).toBeVisible();
    await expect(page.getByText("إضافة وسحب الصلاحيات").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "امنح الصلاحية" })).toBeVisible();
  });

  test("owner: the permissions registry page is reachable from the sidebar", async ({ page }) => {
    await login(page, OWNER_EMAIL, OWNER_PASSWORD);
    const nav = page.getByRole("navigation", { name: "التنقل الرئيسي" });
    await expect(nav.getByRole("link", { name: "صلاحيات المستخدمين" })).toBeVisible();
    await nav.getByRole("link", { name: "صلاحيات المستخدمين" }).click();
    await expect(page).toHaveURL(/\/admin\/permissions/);
    // Permissions registry shows the localized Arabic group/label and its technical key badge.
    await expect(page.getByText("إدارة المنتجات").first()).toBeVisible();
    await expect(page.getByText("عرض المنتجات").first()).toBeVisible();
    await expect(page.getByText("products.view").first()).toBeVisible();
  });
});
