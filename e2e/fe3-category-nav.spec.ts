// Phase 06 regression: real catalog navigation end-to-end (homepage → category → PDP).
// Read-only with the live local DB. Data-agnostic: on an empty catalog it passes by
// asserting the honest empty states, and with data it pins the 308-loop fix
// (slug canonicalization) through real browser navigation.
import { expect, test } from "@playwright/test";

test.setTimeout(120000);

async function categoryTileCount(page: import("@playwright/test").Page): Promise<number> {
  return page.locator('main a[href^="/c/"][aria-label]').count();
}

test("flow: homepage category tiles resolve their listing (no redirect loop)", async ({ page }) => {
  await page.goto("/");
  const n = await categoryTileCount(page);
  if (n === 0) {
    await expect(page.getByText("لا توجد أقسام حاليًا")).toBeVisible();
    return;
  }
  const first = page.locator('main a[href^="/c/"][aria-label]').first();
  const label = (await first.innerText()).trim();
  await first.click();
  // Landing on a rendered document proves the request survived: a 308-loop would end
  // in ERR_TOO_MANY_REDIRECTS and never produce a real page.
  await expect(page.locator("main")).toBeVisible();
  if (label) await expect(page.getByRole("heading", { name: label })).toBeVisible();
});

test("flow: category listing cards navigate to a rendered PDP", async ({ page }) => {
  await page.goto("/");
  const n = await categoryTileCount(page);
  if (n === 0) {
    await expect(page.getByText("لا توجد أقسام حاليًا")).toBeVisible();
    return;
  }
  await page.locator('main a[href^="/c/"][aria-label]').first().click();
  const cardLinks = page.locator('main a[href^="/p/"]');
  const m = await cardLinks.count();
  if (m === 0) {
    await expect(
      page.getByText(/لا توجد منتجات|تعذّر تحميل الأقسام|لا توجد أقسام حاليًا/)
    ).toBeVisible();
    return;
  }
  const href = await cardLinks.first().getAttribute("href");
  expect(href).toMatch(/^\/p\/[0-9a-f-]{36}\/.+/);
  await cardLinks.first().click();
  await expect(page.locator("main h1")).toBeVisible();
});

test("flow: homepage exposes the real category tree (mains + subs)", async ({ page }) => {
  await page.goto("/");
  const mains = await categoryTileCount(page);
  if (mains === 0) {
    await expect(page.getByText("لا توجد أقسام حاليًا")).toBeVisible();
    return;
  }
  expect(mains).toBeGreaterThan(0);
  // The imported catalog has 34 active categories (14 parent + 20 child); the homepage
  // must surface the real tree, never a hardcoded subset.
  expect(mains).toBeGreaterThanOrEqual(30);
  await page.goto("/categories");
  await expect(page.getByRole("heading", { name: "الأقسام" })).toBeVisible();
});

test("flow: stale slug survives the canonical redirect (308 followed to rendered page)", async ({ page }) => {
  await page.goto("/");
  const n = await categoryTileCount(page);
  if (n === 0) {
    await expect(page.getByText("لا توجد أقسام حاليًا")).toBeVisible();
    return;
  }
  const href = await page.locator('main a[href^="/c/"][aria-label]').first().getAttribute("href");
  expect(href).toMatch(/^\/c\/[0-9a-f-]{36}\/.+/);
  const staleHref = href!.replace(/\/[^/]+$/, "/stale-slug");
  await page.goto(staleHref);
  await expect(page.locator("main")).toBeVisible();
  await page.goto(href!);
  await expect(page.locator("main")).toBeVisible();
});
