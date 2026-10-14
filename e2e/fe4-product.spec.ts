// FE-4 PDP + purchase e2e. Live PDP data is unavailable here (local DB empty, verified;
// writes forbidden), so data-paths are covered by unit/contract tests and this spec pins:
// unknown-id 404 honesty, no broken card links, shell/regression intact.
import { expect, test } from "@playwright/test";

test.setTimeout(90000);

test("unknown product id gives honest Arabic not-found (no substitute)", async ({ page }) => {
  await page.goto("/p/00000000-0000-0000-0000-000000000000/x");
  await expect(page.getByRole("heading", { name: /غير موجودة|غير موجود/ })).toBeVisible();
  const body = await page.innerText("body");
  expect(body).not.toMatch(/تجريبي|MOCK/i);
});

test("product cards link to the approved PDP route shape (no dead links)", async ({ page }) => {
  await page.goto("/");
  const links = page.locator('main a[href^="/p/"]');
  const n = await links.count();
  for (let i = 0; i < n; i += 1) {
    const href = await links.nth(i).getAttribute("href");
    expect(href).toMatch(/^\/p\/[0-9a-f-]{36}\/.+/);
  }
  // Empty DB ⇒ zero cards is the honest state (asserted, not skipped silently).
  if (n === 0) {
    await expect(page.getByText("لا توجد منتجات حاليًا")).toBeVisible();
  }
});

test("PDP route honors slug canonicalization contract (unknown stays 404)", async ({ page }) => {
  const res = await page.goto("/p/not-a-uuid/anything");
  expect(res?.status()).toBe(404);
});

test("regression: home, search, categories, admin login, prototype intact", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /احتياجات بيتك/ })).toBeVisible();
  await page.goto("/search");
  await expect(page.getByRole("heading", { name: "البحث في المنتجات" })).toBeVisible();
  await page.goto("/categories");
  await expect(page.getByRole("heading", { name: "الأقسام" })).toBeVisible();
  await page.goto("/admin/login");
  await expect(page.getByRole("heading", { name: /تسجيل دخول الإدارة/ })).toBeVisible();
  await page.goto("/prototype");
  await expect(page.getByText(/INTERACTIVE PROTOTYPE — MOCK DATA/).first()).toBeVisible();
});
