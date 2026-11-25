// Phase 08 — search/filter/sort contract journey on the live local dev surfaces.
// ZERO business writes: search is a pure read (no carts → no cleanup needed).
// Honest-skip pattern like the other suites: when the dataset cannot provide a
// fitting search match, the affected journey skips WITH A REASON instead of
// failing; boundary/guided states are data-independent and always run.
// Every expected string here is verified verbatim against the rendered sources
// (src/app/search/page.tsx, src/components/store/filter-panel.tsx).
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

test.setTimeout(120000);

interface ProbeProduct {
  id: string;
  name: string;
  productType: "PIECE" | "WEIGHT";
  category: { id: string; slug: string };
}

interface CategoryRow {
  id: string;
  slug: string;
}

const probe: { product: ProbeProduct | null; category: CategoryRow | null } = {
  product: null,
  category: null,
};

test.beforeAll(async ({ playwright }) => {
  const ctx: APIRequestContext = await playwright.request.newContext({
    baseURL: "http://localhost:3141",
  });
  const products = await ctx
    .get("/api/store/catalog/products?type=PIECE&limit=5")
    .then((r) => (r.ok() ? (r.json() as unknown as { data: ProbeProduct[] }) : { data: [] }))
    .then((body) => body.data ?? [])
    .catch(() => [] as ProbeProduct[]);
  const first = products[0];
  if (first && typeof first.name === "string" && first.name.trim().length >= 2) {
    probe.product = first;
  }
  const cats = await ctx
    .get("/api/store/catalog/categories")
    .then((r) => (r.ok() ? r.json() : null))
    .catch(() => null);
  const rows = (cats as { data?: unknown } | null)?.data;
  if (Array.isArray(rows)) {
    const fit = rows.find(
      (c): c is CategoryRow =>
        typeof (c as CategoryRow).id === "string" && typeof (c as CategoryRow).slug === "string",
    );
    if (fit) probe.category = fit;
  }
  await ctx.dispose();
});

/** Product ids currently on screen (article cards carry /p/{id}/{slug} links). */
function cardIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('a[href^="/p/"]')).map((a) =>
      (a.getAttribute("href") ?? "").split("/")[2],
    ),
  );
}

const MIN_HINT = "البحث يعمل من حرفين حتى 120 حرفًا.";
const EMPTY_TITLE = "ابدأ بكتابة كلمة للبحث";
const MIN_TITLE = "اكتب حرفين على الأقل للبحث";
const MAX_TITLE = "الاستعلام أطول من 120 حرفًا — اكتب استعلامًا أقصر";

// === T1: guided boundary states on the results page (0 / 1 / spaces / 121) ===
test("guided boundary states: empty guidance, 1-char min message, spaces-only, 121-char max message", async ({
  page,
}) => {
  // 0: approved empty-query guidance (never a request — nothing was asked).
  await page.goto("/search");
  await expect(page.getByText(EMPTY_TITLE)).toBeVisible({ timeout: 60000 });
  await expect(page.getByText(MIN_HINT)).toBeVisible();
  await expect(page.getByText("نطاق السعر غير صالح")).toHaveCount(0);

  // 1: below the contract minimum → the EXACT mandated message + boundary hint.
  await page.goto(`/search?q=${encodeURIComponent("ا")}`);
  await expect(page.getByText(MIN_TITLE)).toBeVisible({ timeout: 60000 });
  await expect(page.getByText(MIN_HINT)).toBeVisible();
  await expect(page.getByText(MAX_TITLE)).toHaveCount(0); // min issue ≠ max issue

  // spaces-only: trimmed to nothing → same as empty (no send).
  await page.goto(`/search?q=${encodeURIComponent("   ")}`);
  await expect(page.getByText(EMPTY_TITLE)).toBeVisible({ timeout: 60000 });
  await expect(page.getByText(MIN_TITLE)).toHaveCount(0);

  // 121: above the contract maximum → the HONEST max message, not the min one.
  await page.goto(`/search?q=${encodeURIComponent("ل".repeat(121))}`);
  await expect(page.getByText(MAX_TITLE)).toBeVisible({ timeout: 60000 });
  await expect(page.getByText(MIN_TITLE)).toHaveCount(0);
});

// === T2: URL-loaded reversed price window → never sent, honest state (D25 parity) ===
test("reversed price window (hand-written URL): contract-invalid input is NOT sent, honest page state on /search and /c", async ({
  page,
}) => {
  const sp = new URLSearchParams({ q: "عسل", minPrice: "99", maxPrice: "5" });
  await page.goto(`/search?${sp}`);
  await expect(page.getByText("نطاق السعر غير صالح")).toBeVisible({ timeout: 60000 });
  await expect(
    page.getByText("الحد الأول أكبر من الثاني — عدّل النطاق ثم أعد المحاولة."),
  ).toBeVisible();
  // A zero-match answer would HIDE the reason — it must not appear here.
  await expect(page.getByText("لا توجد نتائج مطابقة")).toHaveCount(0);

  test.skip(
    probe.category === null,
    "No active category row available for the /c parity check (honest skip).",
  );
  const cat = probe.category!;
  await page.goto(
    `/c/${cat.id}/${encodeURIComponent(cat.slug)}?${new URLSearchParams({
      minPrice: "99",
      maxPrice: "5",
    })}`,
  );
  await expect(page.getByText("نطاق السعر غير صالح")).toBeVisible({ timeout: 60000 });
  await expect(page.getByText("لا توجد منتجات مطابقة")).toHaveCount(0);
});

// === T3: the full journey on real data — URL↔UI parity, load-more, context resets, back/forward ===
test("search journey: URL state survives reload; filter/sort change resets results to page 1; back/forward restore states", async ({
  page,
}) => {
  test.skip(probe.product === null, "No active PIECE product in the dev catalog (honest skip).");
  const term = probe.product!.name.trim().slice(0, 6);
  const q = encodeURIComponent(term);
  await page.goto(`/search?q=${q}`);
  await expect(page.getByRole("heading", { name: "البحث في المنتجات" })).toBeVisible({
    timeout: 60000,
  });

  const noMatch = await page.getByText("لا توجد نتائج مطابقة").count();
  if (noMatch > 0) {
    test.skip(true, `The dev catalog returns no matches for «${term}» (honest skip).`);
  }
  await expect(page.getByText(/تم عرض \d+ منتج/)).toBeVisible({ timeout: 60000 });

  // A hand-written dir=asc is not part of the search contract — it is inert:
  // the page renders normally and never 400s (zod strips unknown keys).
  await page.goto(`/search?q=${q}&dir=asc`);
  await expect(page.getByText(/تم عرض \d+ منتج/)).toBeVisible({ timeout: 60000 });

  // Load-more (when a next cursor exists): appends WITHOUT duplicates.
  const more = page.getByRole("button", { name: /تحميل المزيد/ });
  if ((await more.count()) > 0) {
    const before = await cardIds(page);
    await more.click();
    await expect
      .poll(async () => (await cardIds(page)).length, { timeout: 60000 })
      .toBeGreaterThan(before.length);
    const appended = await cardIds(page);
    expect(new Set(appended).size).toBe(appended.length); // duplicate-free append
  }

  // Filter change = context change → URL gains type; appended pages cannot leak
  // (cursor lives outside URLs → the server re-render starts at page 1).
  await page.getByLabel("نوع المنتج").selectOption(probe.product!.productType);
  await expect(page).toHaveURL(/type=(PIECE|WEIGHT)/, { timeout: 60000 });
  await expect(page.getByText(/تم عرض \d+ منتج/)).toBeVisible({ timeout: 60000 });
  const afterFilter = await cardIds(page);
  expect(afterFilter.length).toBeLessThanOrEqual(12); // server page 1 (limit 12)

  // Sort change = context change → the URL gains sort=newest (search: bare value, no dir).
  await page.getByLabel("ترتيب النتائج").selectOption("newest");
  await expect(page).toHaveURL(/sort=newest/, { timeout: 60000 });
  // URL already changed (assertion above resolved) — a direct negative check is race-free:
  expect(page.url()).not.toContain("dir=");

  // Back → the intermediate URL (type set, no sort=newest); Forward → back to it.
  // App Router moves are SAME-DOCUMENT (popstate): goBack() resolves before the
  // URL settles and waitForURL can miss history-only URL changes — so poll the
  // actual URL (the honest user-visible back move, not a synthetic wait).
  await page.goBack();
  await expect
    .poll(() => page.url(), { timeout: 30000 })
    .not.toContain("sort=newest");
  await expect(page).toHaveURL(/type=/, { timeout: 60000 });
  await page.goForward();
  await expect(page).toHaveURL(/sort=newest/, { timeout: 60000 });

  // Refresh keeps the FULL result-defining state (q never lost).
  await page.reload();
  await expect(page).toHaveURL(/q=/, { timeout: 60000 });
  await expect(page).toHaveURL(/sort=newest/, { timeout: 60000 });
  await expect(page.getByText(/تم عرض \d+ منتج/)).toBeVisible({ timeout: 60000 });

  // Clearing the type filter ("الكل") drops the param and returns to page 1.
  await page.getByLabel("نوع المنتج").selectOption("");
  await expect
    .poll(() => page.url(), { timeout: 30000 })
    .not.toContain("type=");
  await expect(page).toHaveURL(/q=/, { timeout: 60000 });
  expect((await cardIds(page)).length).toBeLessThanOrEqual(12);
});

// === T4: unknown availability ≠ no results (inStock is NOT applied without stock data) ===
test("availability filter honours DATA reality: unknown stock keeps results identical and explains itself; known stock filters for real", async ({
  page,
}) => {
  test.skip(probe.product === null, "No active PIECE product in the dev catalog (honest skip).");
  const term = probe.product!.name.trim().slice(0, 6);
  const plainUrl = `/search?${new URLSearchParams({ q: term })}`;
  await page.goto(plainUrl);
  const noMatch = await page.getByText("لا توجد نتائج مطابقة").count();
  if (noMatch > 0) {
    test.skip(true, `The dev catalog returns no matches for «${term}» (honest skip).`);
  }
  const plainIds = await cardIds(page);
  expect(plainIds.length).toBeGreaterThan(0);

  await page.goto(`/search?${new URLSearchParams({ q: term, inStock: "true" })}`);
  const availabilityNote = page.getByText(/التوفر غير محدد حاليًا/);
  if ((await availabilityNote.count()) > 0) {
    // DATA-CAPABILITY (D02, Phase 05/07): zero inventory rows → the filter
    // cannot be honoured, so it must NOT be applied. The URL may carry the
    // user's intent, but the results stay identical (never silently emptied).
    await expect(availabilityNote.first()).toBeVisible({ timeout: 60000 });
    await expect(page.getByText("متوفر فقط (غير متاح حاليًا)")).toBeVisible();
    expect(await cardIds(page)).toEqual(plainIds);
    // UNKNOWN availability is never re-branded as empty:
    await expect(page.getByText("لا توجد نتائج مطابقة")).toHaveCount(0);
  } else {
    // If the catalog DOES carry stock rows, the filter is real: it applies for
    // honest filtering (subset — never wider than the unfiltered context).
    await expect(page.getByText(/تم عرض \d+ منتج/)).toBeVisible({ timeout: 60000 });
    const filteredIds = await cardIds(page);
    expect(new Set(filteredIds).size).toBe(filteredIds.length);
    for (const id of filteredIds) {
      expect(plainIds).toContain(id);
    }
  }
});

// === T5: zero-match stays distinct from an error; panel controls labeled + keyboard-focusable ===
test("zero-match wording (dataset-dependent) never shows the failure message; panel controls are labeled and focusable", async ({
  page,
}) => {
  const gibberish = "زصسصغقفغق";
  await page.goto(`/search?q=${encodeURIComponent(gibberish)}`);
  await expect(page.getByRole("heading", { name: "البحث في المنتجات" })).toBeVisible({
    timeout: 60000,
  });
  const shown = await page.getByText(/تم عرض \d+ منتج/).count();
  if (shown === 0) {
    // Zero-match (SUCCESS_EMPTY): honest empty wording — never the failure one.
    await expect(page.getByText("لا توجد نتائج مطابقة")).toBeVisible({ timeout: 60000 });
    await expect(page.getByText("تعذّر إتمام البحث")).toHaveCount(0);
    await expect(page.getByText(MIN_TITLE)).toHaveCount(0);
  }

  // The panel controls remain labeled and keyboard-addressable.
  const sort = page.getByLabel("ترتيب النتائج");
  await expect(sort).toBeVisible();
  await expect(page.getByLabel("من سعر")).toBeVisible();
  await expect(page.getByLabel("إلى سعر")).toBeVisible();
  await sort.focus();
  await expect(sort).toBeFocused();
});

// === T6: RTL layout holds across 320/390/768/1440 (no horizontal overflow) ===
test("search page holds RTL layout without horizontal overflow at 320/390/768/1440", async ({
  page,
}) => {
  const term = probe.product ? probe.product.name.trim().slice(0, 6) : "عسل";
  const url = `/search?${new URLSearchParams({ q: term, type: "PIECE", sort: "newest" })}`;
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(url);
    await expect(page.getByRole("heading", { name: "البحث في المنتجات" })).toBeVisible({
      timeout: 60000,
    });
    const overflow = await page.evaluate(() => {
      const el = document.documentElement;
      return Math.max(0, el.scrollWidth - el.clientWidth);
    });
    expect(overflow, `viewport ${width}px`).toBe(0);
  }
});
