// Phase 06 P06-T02: category page context e2e (parent breadcrumb chain, subcategory
// chips, honest not-found). Read-only navigation against the real local catalog;
// every assertion is data-agnostic (typed data OR the honest skip/empty path).
import { expect, test } from "@playwright/test";

test.setTimeout(120000);

test("P06: a subcategory page renders its parent in the breadcrumb chain", async ({ page }) => {
  await page.goto("/categories");
  const subLink = page.locator('main a[aria-label^="قسم فرعي "]');
  const n = await subLink.count();
  if (n === 0) return; // honest skip on an empty categories index (no subs to trace)
  await subLink.first().click();
  await page.waitForURL(/\/c\//);
  const nav = page.locator('nav[aria-label="مسار التنقل"]');
  await expect(nav).toBeVisible();
  // The chain must contain THREE real links: home AND the index AND the parent
  // of the current row (CTR-2/CTR-3 breadcrumb breadth).
  const links = nav.locator("a[href^='/']");
  await expect(links).toHaveCount(3);
  await expect(links.nth(0)).toHaveAttribute("href", "/");
  await expect(links.nth(1)).toHaveAttribute("href", "/categories");
  // The parent link must point at a /c/ route different from the current page.
  const parentHref = await links.nth(2).getAttribute("href");
  const current = new URL(page.url()).pathname;
  expect(parentHref).toMatch(/^\/c\/[0-9a-f-]{36}\//);
  expect(parentHref).not.toBe(current);
  await page.goto(parentHref!);
  await expect(page.locator("main")).toBeVisible();
});

test("P06: a main category page exposes its real subcategories as chips", async ({ page }) => {
  await page.goto("/categories");
  const mains = page.locator("main a[aria-label^='قسم ']:not([aria-label*='فرعي'])");
  const m = await mains.count();
  if (m === 0) return; // honest skip: no main categories rendered at all
  // Open mains until one that legitimately carries children is found (data-agnostic).
  for (let i = 0; i < m; i++) {
    await page.goto("/categories");
    await mains.nth(i).click();
    await page.waitForURL(/\/c\//);
    const chips = page.locator('main a[aria-label^="قسم فرعي "]');
    const chipsCount = await chips.count();
    if (chipsCount === 0) continue; // category legitimately has no children
    // Each chip must be a real /c/ route distinct from the current page itself.
    const hrefs = new Set<string>();
    for (let k = 0; k < chipsCount; k++) {
      const href = await chips.nth(k).getAttribute("href");
      if (href) hrefs.add(href);
    }
    expect(hrefs.size).toBe(chipsCount);
    const current = new URL(page.url()).pathname;
    for (const href of hrefs) {
      expect(href).toMatch(/^\/c\/[0-9a-f-]{36}\/.+/);
      expect(href).not.toBe(current);
    }
    // Chip navigation lands on a rendered page whose breadcrumb keeps the parent link.
    await chips.first().click();
    await page.waitForURL(/^https?:\/\/[^/]+\/c\//);
    const nav = page.locator('nav[aria-label="مسار التنقل"]');
    await expect(nav.locator("a[href^='/c/']").last()).toBeVisible();
    return;
  }
});

test("P06: an unknown category id gives the honest not-found page (never a product)", async ({ page }) => {
  const res = await page.goto("/c/00000000-0000-0000-0000-000000000000/nope");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: /غير موجودة|غير موجود/ })).toBeVisible();
  await expect(page.locator('main article, main a[href^="/p/"]')).toHaveCount(0);
});
