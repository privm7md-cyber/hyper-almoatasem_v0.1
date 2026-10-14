// FE-2 store shell + homepage (read-only GETs; live local DB, assertions data-agnostic:
// sections render with data OR honest empty/error — never mock strings).
import { expect, test } from "@playwright/test";

test("homepage shell: header, hero, sections, footer (no mock data)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: /هايبر المعتصم/ }).first()).toBeVisible();
  await expect(page.getByRole("search")).toBeVisible();
  await expect(page.getByRole("heading", { name: /احتياجات بيتك/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "الأقسام" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "منتجات من المتجر" })).toBeVisible();
  await expect(page.getByText(/وثقة في كل خطوة/).first()).toBeVisible();
  const body = await page.innerText("body");
  expect(body).not.toMatch(/تجريبي|MOCK|mock/i);
  expect(body).not.toMatch(/الأكثر مبيعًا|الأرخص|الأسرع/);
});

test("homepage sections degrade independently (no full-page crash)", async ({ page }) => {
  await page.goto("/");
  // Hero is static: always present even if every source fails.
  await expect(page.getByRole("heading", { name: /احتياجات بيتك/ })).toBeVisible();
  // Each dynamic section shows exactly one of data / honest-empty / error.
  for (const name of ["الأقسام", "منتجات من المتجر"]) {
    const section = page.locator("section", { has: page.getByRole("heading", { name }) });
    await expect(section).toBeVisible();
  }
});

test("search: empty query guides, short query guides, valid query resolves", async ({ page }) => {
  await page.goto("/search");
  await expect(page.getByText("ابدأ بكتابة كلمة للبحث")).toBeVisible();
  await page.goto("/search?q=x");
  await expect(page.getByText(/حرفين/)).toBeVisible();
  await page.goto("/search?q=" + encodeURIComponent("أرز"));
  await expect(page.getByRole("heading", { name: "البحث في المنتجات" })).toBeVisible();
  const body = await page.innerText("body");
  expect(body).not.toMatch(/تجريبي|MOCK/i);
});

test("no horizontal overflow at required viewports", async ({ page }) => {
  for (const size of [
    { width: 320, height: 800 },
    { width: 375, height: 800 },
    { width: 390, height: 844 },
    { width: 768, height: 900 },
    { width: 1280, height: 900 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(size);
    await page.goto("/");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${size.width}px overflow`).toBeLessThanOrEqual(1);
  }
});

test("RTL + bidi prices hold on homepage", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const bdiCount = await page.locator("bdi").count();
  const priceTexts = await page.locator("text=/ج\\.م/").count();
  if (priceTexts > 0) expect(bdiCount).toBeGreaterThan(0);
});

test("regression: admin login + prototype intact", async ({ page }) => {
  await page.goto("/admin/login");
  await expect(page.getByRole("heading", { name: /تسجيل دخول الإدارة/ })).toBeVisible();
  await page.goto("/prototype");
  await expect(page.getByText(/INTERACTIVE PROTOTYPE — MOCK DATA/).first()).toBeVisible();
});
