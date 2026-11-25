import path from "node:path";
import { expect, test } from "@playwright/test";

const ownerEmail = process.env.PHASE_DE_OWNER_EMAIL ?? "";
const ownerPassword = process.env.PHASE_DE_OWNER_PASSWORD ?? "";

test.beforeEach(async ({ page }) => {
  if (!ownerEmail || !ownerPassword) throw new Error("PHASE_DE_OWNER_EMAIL/PASSWORD are required.");
  await page.goto("/admin/login");
  await page.getByLabel(/البريد/).fill(ownerEmail);
  await page.getByLabel(/كلمة المرور/).fill(ownerPassword);
  await page.getByRole("button", { name: /دخول/ }).click();
  await page.waitForURL(/\/admin$/);
});

test("metadata review is Arabic, keyboard-labelled, responsive, and has no serious axe findings", async ({ page }) => {
  await page.goto("/admin/products/bulk");
  await expect(page.getByText("مراجعة بيانات حجم العبوة", { exact: true })).toBeVisible();
  await expect(page.getByLabel("نوع المراجعة")).toBeVisible();
  await expect(page.getByLabel("بحث بالمنتج أو شكل البيع أو الكود")).toBeVisible();
  await expect(page.getByRole("table", { name: "المنتجات وأشكال البيع التي تحتاج مراجعة بيانات العبوة" })).toBeVisible();

  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
  }

  await page.addScriptTag({ path: path.resolve(process.cwd(), "node_modules/axe-core/axe.min.js") });
  const serious = await page.evaluate(async () => {
    const result = await (window as typeof window & { axe: { run(): Promise<{ violations: Array<{ id: string; impact: string | null }> }> } }).axe.run();
    return result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  });
  expect(serious).toEqual([]);
});

test("brand management and the storefront brand directory are labelled, responsive, and have no serious axe findings", async ({ page }) => {
  await page.goto("/admin/taxonomy");
  await expect(page.getByRole("heading", { name: "العلامات التجارية", exact: true })).toBeVisible();
  await expect(page.getByLabel("اسم العلامة التجارية")).toBeVisible();
  await expect(page.getByLabel("العلامة التجارية المراد تعطيلها", { exact: true })).toBeVisible();
  await expect(page.getByRole("table", { name: "العلامات التجارية", exact: true })).toBeVisible();

  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `admin taxonomy horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
  }

  await page.addScriptTag({ path: path.resolve(process.cwd(), "node_modules/axe-core/axe.min.js") });
  const adminSerious = await page.evaluate(async () => {
    const result = await (window as typeof window & { axe: { run(): Promise<{ violations: Array<{ id: string; impact: string | null }> }> } }).axe.run();
    return result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  });
  expect(adminSerious).toEqual([]);

  await page.goto("/brands");
  await expect(page.getByRole("heading", { name: "العلامات التجارية", exact: true })).toBeVisible();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `storefront brands horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
  }
  await page.addScriptTag({ path: path.resolve(process.cwd(), "node_modules/axe-core/axe.min.js") });
  const storeSerious = await page.evaluate(async () => {
    const result = await (window as typeof window & { axe: { run(): Promise<{ violations: Array<{ id: string; impact: string | null }> }> } }).axe.run();
    return result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  });
  expect(storeSerious).toEqual([]);
});
