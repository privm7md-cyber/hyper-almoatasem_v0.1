// FE-1 foundation smoke (read-only GETs; no backend writes, no secrets).
// Uses the repo's installed Chrome; asserts served foundation facts:
// Arabic RTL shell, Cairo font wiring, prototype isolation (route 404), admin login render.
import { expect, test } from "@playwright/test";

test("root shell is Arabic RTL with Cairo wired", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(font).toMatch(/cairo/i);
});

test("admin login renders Arabic form", async ({ page }) => {
  await page.goto("/admin/login");
  await expect(page.getByRole("heading", { name: /تسجيل دخول الإدارة/ })).toBeVisible();
  await expect(page.getByLabel(/البريد الإلكتروني/)).toBeVisible();
});

test("prototype route is no longer public (404)", async ({ page }) => {
  const res = await page.goto("/prototype");
  expect(res?.status()).toBe(404);
});

test("unknown route shows Arabic not-found (no internals)", async ({ page }) => {
  const res = await page.goto("/no-such-route-xyz");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: /غير موجودة/ })).toBeVisible();
});
