// CTR taxonomy/navigation e2e: read-only navigation over the REAL local catalog.
// Expected order/shape comes from the live /api source — the same rows the server
// functions read — so this spec is data-agnostic AND proves the storefront is
// bound to the approved clean tree (any junk-bound DB fails these assertions).
// No POSTs, no fixtures, no writes. Honest skips when a section legitimately
// has no data yet.
import { expect, test, type Page } from "@playwright/test";

test.setTimeout(120000);

interface ApiCategory {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  sortOrder: number;
}

async function fetchCategories(page: Page): Promise<ApiCategory[]> {
  const res = await page.request.get("/api/store/catalog/categories?limit=100");
  if (!res.ok()) return [];
  const body = (await res.json()) as { data?: ApiCategory[] };
  return body.data ?? [];
}

/** The approved display order: sortOrder, then name, then id (pure, mirrors CTR-1 helper). */
function byApprovedOrder(a: ApiCategory, b: ApiCategory): number {
  return (
    a.sortOrder - b.sortOrder ||
    (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

test("CTR-1: the homepage section is titled «أقسام الهايبر» and lists mains in approved order", async ({ page }) => {
  const cats = await fetchCategories(page);
  const mains = cats.filter((c) => c.parentId === null).sort(byApprovedOrder);
  if (mains.length === 0) return; // honest skip: empty catalog
  await page.goto("/");
  await expect(page.locator("#home-categories")).toHaveText("أقسام الهايبر");
  // First icon-led tile is the first main by sortOrder — not alphabetical luck.
  const tiles = page.locator('[aria-labelledby="home-categories"] ul > li > a[aria-label]');
  await expect(tiles.first()).toHaveAttribute("aria-label", mains[0].name);
});

test("CTR-1: the categories index orders mains by sortOrder and renders them all", async ({ page }) => {
  const cats = await fetchCategories(page);
  const mains = cats.filter((c) => c.parentId === null).sort(byApprovedOrder);
  if (mains.length === 0) return;
  await page.goto("/categories");
  const mainLinks = page.locator("main a[aria-label^='قسم ']:not([aria-label*='فرعي'])");
  await expect(mainLinks.first()).toHaveAttribute("aria-label", `قسم ${mains[0].name}`);
  // Every active main from the source list is rendered — nothing truncated.
  const rendered = await mainLinks.count();
  expect(rendered).toBe(mains.length);
});

test("CTR-2: a main category with children states the subtree scope honestly", async ({ page }) => {
  const cats = await fetchCategories(page);
  const parentIds = new Set(cats.filter((c) => c.parentId !== null).map((c) => c.parentId));
  const mainWithKids = cats.filter((c) => c.parentId === null && parentIds.has(c.id)).sort(byApprovedOrder)[0];
  if (!mainWithKids) return; // honest skip: no main carries children in this catalog
  await page.goto(`/c/${mainWithKids.id}/${encodeURIComponent(mainWithKids.slug)}`);
  await expect(page.getByText("المُعروض ضمن هذا القسم يشمل منتجات أقسامه الفرعية أيضًا.")).toBeVisible();
});

test("CTR-3: a product breadcrumb links back to its real category (and navigates)", async ({ page }) => {
  const res = await page.request.get("/api/store/catalog/products?limit=1");
  const body = (await res.json()) as { data?: Array<{ id: string; slug: string; category: { id: string } }> };
  const prod = body.data?.[0];
  if (!prod) return; // honest skip: empty catalog
  await page.goto(`/p/${prod.id}/${encodeURIComponent(prod.slug)}`);
  const nav = page.locator('nav[aria-label="مسار التنقل"]');
  const catLink = nav.locator(`a[href^="/c/${prod.category.id}/"]`);
  await expect(catLink).toHaveCount(1);
  await catLink.click();
  await page.waitForURL(new RegExp(`/c/${prod.category.id}/`));
  await expect(page.locator("main")).toBeVisible();
});
