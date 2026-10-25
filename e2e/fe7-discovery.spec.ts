// Phase 07 — Browse / Search / Product discovery (read-only GETs; no writes).
//
// Data-agnostic by design: every assertion adapts to the catalog that is
// actually loaded (empty DB → honest empty states; populated DB → the real
// structure). The suite pins the Phase 07 contract fixes:
//   - the categories index shows the real main/sub structure
//   - every search sort applies the QUERY (newest must not return non-matching)
//   - a WEIGHT price is a price per kilogram (never per gram)
//   - an unknown availability is reported as unknown (never as out of stock)
//   - the stock filter is not offered while the catalog carries no stock data
//   - product images fall back to the placeholder
//   - no horizontal overflow on the discovery pages
import { expect, test } from "@playwright/test";

test.setTimeout(120000);

const VIEWPORTS = [360, 390, 768, 1024, 1440];

async function productCards(page: import("@playwright/test").Page): Promise<string[]> {
  const labels = await page.locator("article[aria-label]").evaluateAll((nodes) =>
    nodes.map((n) => n.getAttribute("aria-label") ?? ""),
  );
  return labels;
}

/**
 * Opens the first category from the categories index and waits until the
 * listing has actually rendered (cards or the honest empty state) — a
 * client-side navigation can leave the previous DOM in place for a tick.
 */
async function openFirstCategory(page: import("@playwright/test").Page): Promise<boolean> {
  await page.goto("/categories");
  const link = page.locator('main a[href^="/c/"]').first();
  if ((await link.count()) === 0) {
    await expect(page.getByText("لا توجد أقسام حاليًا")).toBeVisible();
    return false;
  }
  await Promise.all([page.waitForURL(/\/c\//), link.click()]);
  await page.waitForFunction(
    () =>
      document.querySelectorAll("article[aria-label]").length > 0 ||
      /لا توجد منتجات|تعذّر تحميل المنتجات/.test(document.body.innerText),
    null,
    { timeout: 20000 },
  );
  return true;
}

test("categories index shows the real structure (mains + their subcategories)", async ({ page }) => {
  await page.goto("/categories");
  const mains = page.locator('main a[href^="/c/"][aria-label^="قسم "]');
  const mainCount = await mains.count();
  if (mainCount === 0) {
    await expect(page.getByText("لا توجد أقسام حاليًا")).toBeVisible();
    return;
  }
  // Every main link points to a real destination, and the index also exposes
  // the subcategories (a flat list would show mains only).
  const subs = page.locator('main a[href^="/c/"][aria-label^="قسم فرعي"]');
  await expect(mains.first()).toBeVisible();
  if ((await subs.count()) > 0) {
    await expect(subs.first()).toBeVisible();
  }
});

test("a category page lists its own products and links to them", async ({ page }) => {
  if (!(await openFirstCategory(page))) return;
  const cards = await productCards(page);
  if (cards.length === 0) {
    await expect(page.getByText(/لا توجد منتجات|تعذّر تحميل المنتجات/)).toBeVisible();
    return;
  }
  const card = page.locator("article[aria-label]").first();
  await expect(card.locator('a[href^="/p/"]')).toHaveAttribute("href", /\/p\/[0-9a-f-]{36}\//);
});

test("every search sort applies the query (newest must not return non-matching rows)", async ({ page }) => {
  await page.goto("/categories");
  const link = page.locator('main a[href^="/c/"]').first();
  if ((await link.count()) === 0) return;
  const q = "لورد";
  await page.goto(`/search?q=${encodeURIComponent(q)}`);
  const relevance = await productCards(page);
  if (relevance.length === 0) return; // no matching data → nothing to pin

  await page.goto(`/search?q=${encodeURIComponent(q)}&sort=newest`);
  const newest = await productCards(page);
  expect(newest.length).toBeGreaterThan(0);
  // The newest sort must stay inside the matching set.
  for (const name of newest) {
    expect(name).toContain(q);
  }
});

test("search keeps the query in the URL and shows a real count of shown products", async ({ page }) => {
  await page.goto(`/search?q=${encodeURIComponent("لورد")}`);
  await expect(page).toHaveURL(/q=/);
  const shown = await page.getByText(/تم عرض \d+ منتج/).count();
  if (shown > 0) {
    const text = await page.getByText(/تم عرض \d+ منتج/).first().innerText();
    const count = Number(text.match(/(\d+)/)?.[1] ?? "0");
    const cards = await productCards(page);
    expect(count).toBe(cards.length);
  }
});

test("an Arabic query without results shows the empty state, not an error", async ({ page }) => {
  await page.goto(`/search?q=${encodeURIComponent("زززززز")}`);
  await expect(page.getByText("لا توجد نتائج مطابقة")).toBeVisible();
  await expect(page.getByText("تعذّر إتمام البحث")).toHaveCount(0);
});

test("a short query stays guided (2..120 chars contract)", async ({ page }) => {
  await page.goto("/search?q=%D8%A7");
  await expect(page.getByText(/اكتب حرفين على الأقل|ابدأ بكتابة كلمة للبحث/)).toBeVisible();
});

test("a WEIGHT product shows a per-kilogram price, never a per-gram price", async ({ page }) => {
  if (!(await openFirstCategory(page))) return;
  const card = page.locator("article[aria-label]").first();
  if ((await card.count()) === 0) return;
  const href = await card.locator('a[href^="/p/"]').getAttribute("href");
  if (!href) return;
  await page.goto(href);
  const body = await page.locator("main").innerText();
  expect(body).not.toMatch(/ج\.م\s*\/\s*GRAM/);
  // Choosing a weight must never multiply a per-kg price by a gram count.
  const weightInput = page.getByLabel("وزن مخصص بالجرام");
  if ((await weightInput.count()) > 0) {
    await weightInput.fill("500");
    const estimate = await page.getByText(/تقدير توضيحي/).innerText();
    const amount = Number(estimate.match(/([\d.]+)\s*ج\.م/)?.[1] ?? "0");
    expect(amount).toBeLessThan(1000);
  }
});

test("availability is reported as unspecified, never as out of stock", async ({ page }) => {
  if (!(await openFirstCategory(page))) return;
  const body = await page.locator("main").innerText();
  if (body.includes("التوفر غير محدد حاليًا")) {
    expect(body).not.toContain("غير متوفر");
  }
});

test("the stock filter is not offered while the catalog carries no stock data", async ({ page }) => {
  if (!(await openFirstCategory(page))) return;
  const body = await page.locator("main").innerText();
  const disabledBox = page.getByRole("checkbox", { name: /متوفر فقط/ });
  if (body.includes("لا تتوفر بيانات مخزون")) {
    await expect(disabledBox).toBeDisabled();
  }
});

test("products without an image fall back to the placeholder", async ({ page }) => {
  if (!(await openFirstCategory(page))) return;
  const card = page.locator("article[aria-label]").first();
  if ((await card.count()) === 0) return;
  const href = await card.locator('a[href^="/p/"]').getAttribute("href");
  if (!href) return;
  await page.goto(href);
  const broken = await page.locator("img").evaluateAll((imgs) =>
    imgs.filter((i) => {
      const img = i as HTMLImageElement;
      return img.complete && img.naturalWidth === 0;
    }).length,
  );
  expect(broken).toBe(0);
});

test("brands page shows a real state (data or honest empty), never fake entries", async ({ page }) => {
  await page.goto("/brands");
  const links = page.locator('main a[href^="/brand/"]');
  const count = await links.count();
  if (count === 0) {
    await expect(page.getByText(/لا توجد علامات|تعذّر تحميل العلامات/)).toBeVisible();
    return;
  }
  await expect(links.first()).toHaveAttribute("href", /\/brand\/[0-9a-f-]{36}\//);
});

test("an unknown category or product stays a 404", async ({ page }) => {
  const res = await page.goto("/c/00000000-0000-4000-8000-000000000000/x");
  expect(res?.status()).toBe(404);
  const res2 = await page.goto("/p/00000000-0000-4000-8000-000000000000/x");
  expect(res2?.status()).toBe(404);
});

test("prototype routes stay unavailable", async ({ page }) => {
  const res = await page.goto("/prototype");
  expect(res?.status()).toBe(404);
});

test("discovery pages hold every required viewport without overflow", async ({ page }) => {
  for (const width of VIEWPORTS) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/categories", "/search?q=%D9%84%D9%88%D8%B1%D8%AF", "/brands"]) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `overflow at ${width}px on ${path}`).toBe(0);
    }
  }
});
