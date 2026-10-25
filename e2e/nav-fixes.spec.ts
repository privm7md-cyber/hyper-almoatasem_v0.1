// NAV-02 / NAV-05 / D08 read-only e2e coverage (no backend writes, no secrets).
// NAV-05: after a real SPA navigation focus must sit on the #main landmark.
// NAV-02: the addresses auth gate carries a safe internal return destination.
// D08: the search empty-state copy states two CHARACTERS (not two words).
import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1366, height: 900 } }); // desktop header + menu links visible

test("NAV-05: spa navigation moves focus to #main (header link)", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "الأقسام" }).first().click();
  await expect(page).toHaveURL(/\/categories/);
  await expect(page.locator("#main")).toBeFocused();
});

test("NAV-05: focus moves to #main via the footer sibling navigation too", async ({ page }) => {
  await page.goto("/categories");
  await page.getByRole("link", { name: "العلامات" }).first().click();
  await expect(page).toHaveURL(/\/brands/);
  await expect(page.locator("#main")).toBeFocused();
});

test("NAV-02: the addresses gate redirects with its internal next destination", async ({ page }) => {
  await page.goto("/account/addresses");
  await expect(page).toHaveURL(/\/login\?next=%2Faccount%2Faddresses/);
  await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
  // The safe destination travels across the cross-link too (never dropped).
  await expect(page.getByRole("link", { name: "أنشئ حسابًا" })).toHaveAttribute(
    "href",
    "/register?next=%2Faccount%2Faddresses",
  );
});

test("NAV-02: external next values are not preserved as navigation targets", async ({ page }) => {
  // The gate only ever issues internal next values; the policy library (unit-tested)
  // rejects anything else. Here we pin the login page renders fine with a hostile
  // query and never crashes/leaks it into a rendered link.
  await page.goto("/login?next=https://evil.example");
  await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
  const href = await page.getByRole("link", { name: "أنشئ حسابًا" }).getAttribute("href");
  expect(href).toBe("/register"); // hostile next is dropped, link stays clean
});

test("D08: one-character search uses the corrected copy (two characters)", async ({ page }) => {
  await page.goto("/search?q=%D8%A3");
  await expect(page.getByText("اكتب حرفين على الأقل للبحث")).toBeVisible();
});
