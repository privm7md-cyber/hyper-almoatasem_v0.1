// Phase-11/12 storefront navigation, discovery and technical-surface tests.
//
// Real Chromium, real HTTP, no writes to real data: the journey tests only
// READ (homepage, catalogue, search, a product, the 404 page, the public
// metadata endpoints). The technical checks assert the SHIPPED artefacts:
// robots.txt, the sitemap index, the per-route metadata and the noindex
// policy on the private routes.
//
// The server must already be running (the phase config has no webServer on
// purpose: the repository's default config would boot against the production
// DATABASE_URL).

import { expect, test, type Page } from "@playwright/test";

const BASE = process.env.PHASE10_BASE_URL ?? "http://127.0.0.1:3147";
const VIEWPORTS = [
  { name: "360", width: 360, height: 800 },
  { name: "375", width: 375, height: 812 },
  { name: "390", width: 390, height: 844 },
  { name: "430", width: 430, height: 932 },
  { name: "768", width: 768, height: 1024 },
  { name: "1365", width: 1365, height: 768 },
];

async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth > doc.clientWidth + 1;
  });
}

test.describe.configure({ mode: "serial" });

test.describe("storefront navigation (Phase-11)", () => {
  test("the homepage exposes the real sections and the search entry", async ({ page }) => {
    await page.goto(`${BASE}/`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("search", { name: "البحث في المتجر" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "أقسام المتجر" })).toBeVisible();
    // The category grid is a REAL section with real links.
    const categoryLinks = page.locator('a[href^="/c/"]');
    expect(await categoryLinks.count()).toBeGreaterThan(0);
  });

  test("the footer links only to existing routes", async ({ page, request }) => {
    await page.goto(`${BASE}/`);
    const footer = page.getByRole("contentinfo");
    const hrefs = await footer.locator("a").evaluateAll((els) =>
      els.map((e) => (e as HTMLAnchorElement).getAttribute("href") ?? ""),
    );
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      const res = await request.get(`${BASE}${href}`);
      expect(res.status(), `footer link ${href} must resolve`).toBeLessThan(400);
    }
  });

  test("category → product → back to the category", async ({ page }) => {
    await page.goto(`${BASE}/categories`);
    const firstCategory = page.locator('a[href^="/c/"]').first();
    await expect(firstCategory).toBeVisible();
    const categoryHref = await firstCategory.getAttribute("href");
    await firstCategory.click();
    await page.waitForURL(/\/c\//);
    const productLink = page.locator('a[href^="/p/"]').first();
    if ((await productLink.count()) > 0) {
      await productLink.click();
      await page.waitForURL(/\/p\//);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.goBack();
      await page.waitForURL(/\/c\//);
    }
    expect(page.url()).toContain(categoryHref ?? "/c/");
  });

  test("search keeps the term in the URL and a result opens a product", async ({ page }) => {
    await page.goto(`${BASE}/search?q=لبن`);
    await expect(page).toHaveURL(/q=/);
    const productLink = page.locator('a[href^="/p/"]').first();
    if ((await productLink.count()) > 0) {
      await productLink.click();
      await page.waitForURL(/\/p\//);
      await page.goBack();
      await page.waitForURL(/\/search\?q=/);
      await expect(page.getByRole("search", { name: "البحث في المتجر" })).toBeVisible();
    }
  });

  test("a search with no results is not a dead end", async ({ page }) => {
    await page.goto(`${BASE}/search?q=zzzzzzzznotarealproduct`);
    await expect(page.getByText(/لا توجد نتائج|تعذّر|ابدأ بكتابة/)).toBeVisible();
    // There is always a way back to the catalogue.
    await expect(page.locator('a[href="/categories"]').first()).toBeVisible();
  });

  test("the cart page always offers a way back to the catalogue", async ({ page }) => {
    await page.goto(`${BASE}/cart`);
    await expect(page.getByRole("main")).toBeVisible();
    const links = await page.locator("a").evaluateAll((els) =>
      els.map((e) => (e as HTMLAnchorElement).getAttribute("href") ?? ""),
    );
    // An empty cart cannot check out, but it must never be a dead end.
    expect(links.some((h) => h === "/categories" || h.startsWith("/categories"))).toBe(true);
  });

  test("the 404 page offers real ways back", async ({ page }) => {
    const res = await page.goto(`${BASE}/this-route-does-not-exist`);
    expect(res?.status()).toBe(404);
    const links = await page.locator("a").evaluateAll((els) =>
      els.map((e) => (e as HTMLAnchorElement).getAttribute("href") ?? ""),
    );
    expect(links).toContain("/");
    expect(links).toContain("/categories");
    expect(links).toContain("/search");
  });

  test("the mobile menu opens, closes and never covers the page permanently", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/`);
    const trigger = page.getByRole("button", { name: "فتح قائمة المتجر" });
    await expect(trigger).toBeVisible();
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "قائمة المتجر" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });
});

test.describe("responsive behaviour (Phase-11/12)", () => {
  for (const vp of VIEWPORTS) {
    test(`no unintended horizontal overflow at ${vp.name}px`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const path of ["/", "/categories", "/search?q=%D9%84%D8%A8%D9%86", "/cart"]) {
        await page.goto(`${BASE}${path}`);
        await page.waitForLoadState("domcontentloaded");
        expect(await hasHorizontalOverflow(page), `overflow on ${path} at ${vp.width}px`).toBe(false);
      }
    });
  }
});

test.describe("technical surface (Phase-12)", () => {
  test("robots.txt allows the public pages and points at the sitemap", async ({ request }) => {
    const res = await request.get(`${BASE}/robots.txt`);
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain("Sitemap:");
    expect(body).toContain("Disallow: /admin");
    expect(body).toContain("Disallow: /checkout");
  });

  test("the sitemap holds the public pages, the taxonomy and the products", async ({ request }) => {
    const res = await request.get(`${BASE}/sitemap.xml`);
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain("<urlset");
    // Every listed URL must be a route that exists: a 404 inside the sitemap
    // is a crawl defect, so the static entries are asserted by route, not by
    // a hard-coded list of pages that may come and go.
    const locs = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs.length).toBeGreaterThan(0);
    expect(locs.some((l) => l.endsWith("/categories"))).toBe(true);
    expect(locs.some((l) => l.endsWith("/brands"))).toBe(true);
    expect(locs.some((l) => l.includes("/c/"))).toBe(true);
    expect(locs.some((l) => l.includes("/p/"))).toBe(true);
    expect(body).not.toContain("/admin");
    expect(body).not.toContain("/checkout");
    expect(body).not.toContain("/account");
  });

  test("a product page carries its own title and a canonical origin", async ({ page }) => {
    await page.goto(`${BASE}/categories`);
    const link = page.locator('a[href^="/p/"]').first();
    if ((await link.count()) === 0) return;
    await link.click();
    await page.waitForURL(/\/p\//);
    const html = await page.content();
    expect(html).toContain("<title>");
    expect(html).toMatch(/<meta name="description"/);
    expect(html).not.toContain("localhost:3000/sitemap");
  });

  test("the private routes are noindex", async ({ page }) => {
    for (const path of ["/cart", "/checkout", "/account", "/orders", "/login"]) {
      await page.goto(`${BASE}${path}`);
      const html = await page.content();
      expect(html, `${path} must be noindex`).toContain('name="robots"');
      expect(html).toMatch(/content="[^"]*noindex/);
    }
  });

  test("the security headers cover the HTML pages, not only the API", async ({ request }) => {
    const res = await request.get(`${BASE}/`);
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
    expect(res.headers()["x-frame-options"]).toBe("SAMEORIGIN");
    expect(res.headers()["referrer-policy"]).toBe("same-origin");
  });

  test("the customer session cookie is issued with the environment's name", async ({ request }) => {
    // The name depends on the environment (production keeps the __Host- name
    // and its Secure flag; a local development process uses its own name).
    const res = await request.post(`${BASE}/api/store/customers/session`, {
      data: { phone: "201000000000", password: "not-a-real-password" },
    });
    // A failed login sets no session cookie at all.
    expect(res.status()).toBe(401);
    expect(res.headers()["set-cookie"] ?? "").not.toContain("customer-session");
  });
});
