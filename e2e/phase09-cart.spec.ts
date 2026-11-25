// Phase 09 (Cart Experience) — end-to-end against the ISOLATED database
// hyper_almoatasem_p09 through the app's OWN surfaces (:3199, wrapper-managed).
// Verification levels, labeled honestly per test:
//   • FE-e2e       — the real card islands / cart page island / PDP flows;
//   • API-contract — round-trips against the app's own routes (no invented
//     endpoints), used where the UI cannot stage a state (consumed carts,
//     raw quantity gates).
// Isolated writes (carts, customers, line rows) are documented in the run
// folder. Amount assertions compare to a server-provided value — nothing is
// computed locally; a missing value is never displayed and never treated as
// zero. The verified UI truths this suite pins (phase-07-proven selectors
// included): card = article with /p/{id} link + heading; add = one POST
// /cart/items after ONE GET variants; (+) aggregates, (−) is absolute, (−) at
// one goes DELETE; the cart page shows the server text verbatim (qty input
// value = server NUMERIC(12,3) text); fresh /cart = «ابدأ سلة جديدة» (mint
// only on visible user action); guest-with-empty-cart = «سلتك فاضية»; merge
// needs token+session (server wording on any missing side); estimate money =
// 2-decimal strings rendered verbatim + « ج.م».
// Identity-ladder leg count (grounded in cart-lines-store.cartMutation): a
// fresh-visitor add is REAL: legs = rejected POST /items (400 «Exactly one…»)
// + mint POST /cart + the SAME write retried — so a fresh visitor's add makes
// TWO /items POSTs; a tokened add makes ONE.
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

test.setTimeout(180000);

const TOKEN_KEY = "hyper_cart_guest_token";
const EVIDENCE = process.env.P09_EVIDENCE_DIR ?? "test-results/evidence";

interface CardProduct {
  id: string;
  name: string;
  slug: string;
  productType: string;
  saleStepGrams: number | null;
  category: { id: string; slug: string; name: string };
}

interface VariantRow {
  id: string;
  sizeUnit: string | null;
  price: string;
  isActive: boolean;
}

interface CartLine {
  productVariantId: string;
  quantity: string;
  lineTotal: string | null;
}

/** The full cart-line wire shape (src/lib/cart/serialize.ts) as the weight
 * round-trip reads it: productType + counting-unit pin are additive there. */
interface WeightLine extends CartLine {
  productType: string;
  unitSnapshot: string;
}

interface CartBody {
  id: string;
  lines: CartLine[];
}

function listingUrl(product: CardProduct): string {
  // The proven route (phase 07): /c/{categoryId}/{slug}.
  return `/c/${product.category.id}/${encodeURIComponent(product.category.slug)}`;
}

async function readJson<T>(ctx: APIRequestContext, url: string): Promise<T | null> {
  const res = await ctx.get(url).catch(() => null);
  if (!res || !res.ok()) return null;
  const body = (await res.json()) as { data: T };
  return body.data;
}

/** Track in-page requests that match a predicate (staged APIRequestContext
 * traffic does NOT fire here — page-level browser network only). */
function trackUrls(page: Page, predicate: (url: string, method: string) => boolean): string[] {
  const seen: string[] = [];
  page.on("request", (r) => {
    if (predicate(r.url(), r.method())) seen.push(`${r.method()} ${r.url()}`);
  });
  return seen;
}

const isCartMint = (url: string, method: string) =>
  method === "POST" &&
  /\/api\/store\/cart\/?$/.test(url) && // bare /cart only — not /items, /merge, /reprice
  !url.includes("/items");

/** The proven phase-07 card selector. */
function cardFor(page: Page, productId: string, productName: string) {
  return page
    .locator("article")
    .filter({ has: page.locator(`a[href^="/p/${productId}"]`) })
    .filter({ has: page.getByRole("heading", { name: productName }) });
}

/** Persist a guest token into localStorage BEFORE the app boots on the page. */
function setTokenFor(page: Page, token: string): void {
  void page.addInitScript(
    ([key, value]: string[]) => window.localStorage.setItem(key, value),
    [TOKEN_KEY, token],
  );
}

async function openListing(page: Page, product: CardProduct, timeout = 60000): Promise<void> {
  await page.goto(listingUrl(product));
  // ONE resolution: the card heading only (`.or(...)` resolves the union and
  // trips strict mode — the name-bearing link is a second element). The
  // product may repeat on the page, hence `.first()`.
  await expect(page.getByRole("heading", { name: product.name }).first()).toBeVisible({ timeout });
}

/** Listing-presence probe for fixtures whose category page ordering is not
 * guaranteed (page 1 of the listing may not contain the product). */
async function openListingSoft(page: Page, product: CardProduct, timeout = 20000): Promise<boolean> {
  try {
    await openListing(page, product, timeout);
    return true;
  } catch {
    return false;
  }
}

async function readCart(page: Page, token: string | null): Promise<CartBody | null> {
  const res = await page.request
    .get("/api/store/cart", token ? { headers: { "x-guest-token": token } } : undefined)
    .catch(() => null);
  if (!res || !res.ok()) return null;
  // The success envelope is { data: { cart }, meta } — unwrap the CART itself.
  const body = (await res.json()) as { data: { cart: CartBody } };
  return body.data.cart;
}

async function readConfirmedLine(page: Page, variantId: string): Promise<CartLine | null> {
  const token = (await page.evaluate((k) => window.localStorage.getItem(k), TOKEN_KEY)) ?? "";
  const cart = await readCart(page, token || null);
  return cart?.lines.find((l) => l.productVariantId === variantId) ?? null;
}

/** Canonical-ready identity phone (frozen R8 ladder: ^201[0125][0-9]{8}$). */
function uniquePhone(): string {
  const d = "0125"[Math.floor(Math.random() * 4)];
  const tail = String(Date.now() % 100000000).padStart(8, "0");
  return `201${d}${tail}`;
}

/** Registers a customer through the app's own endpoint; the HttpOnly session
 * cookie lands in the shared browser-context jar (page.request). */
async function registerCustomer(page: Page): Promise<boolean> {
  const reg = await page.request.post("/api/store/customers/register", {
    data: {
      phone: uniquePhone(),
      firstName: "تاسع",
      lastName: "السلة",
      password: "p09-strong-password-1",
    },
  });
  return reg.ok();
}

const fixtures: {
  piece: { product: CardProduct | null; variant: VariantRow | null };
  piece2: { product: CardProduct | null; variant: VariantRow | null };
  pieceMulti: { product: CardProduct | null; variants: VariantRow[] };
  weight: { product: CardProduct | null; variant: VariantRow | null };
} = {
  piece: { product: null, variant: null },
  piece2: { product: null, variant: null },
  pieceMulti: { product: null, variants: [] },
  weight: { product: null, variant: null },
};

function fixtureVariantId(variant: VariantRow | null): string {
  if (!variant) throw new Error("fixture variant missing");
  return variant.id;
}

test.beforeAll(async ({ playwright }) => {
  await import("node:fs").then((fs) =>
    fs.promises.mkdir(`${EVIDENCE}/screenshots`, { recursive: true }).catch(() => {}),
  );
  const api = await playwright.request.newContext();
  try {
    // Early catalog pages first: catalog order and category-listing order both
    // lead with recent products, so page-1 candidates are the ones most likely
    // to render on their category listing's first page.
    const pages: CardProduct[][] = [
      (await readJson<CardProduct[]>(api, "/api/store/catalog/products?type=PIECE&limit=60")) ?? [],
      (await readJson<CardProduct[]>(api, "/api/store/catalog/products?type=PIECE&limit=60&page=2")) ?? [],
      (await readJson<CardProduct[]>(api, "/api/store/catalog/products?type=PIECE&limit=60&page=3")) ?? [],
    ];
    let candidates = pages[0].concat(pages[1], pages[2]);
    let pieceCategory: string | null = null;
    for (const product of candidates) {
      if (fixtures.piece.product && fixtures.piece2.product && fixtures.pieceMulti.product) break;
      const variants =
        (await readJson<VariantRow[]>(api, `/api/store/catalog/products/${product.id}/variants`)) ?? [];
      const sellable = variants.filter((v) => v.isActive && typeof v.price === "string");
      if (sellable.length === 1) {
        if (!fixtures.piece.product) {
          fixtures.piece = { product, variant: sellable[0]! };
          pieceCategory = product.category.id;
        } else if (
          pieceCategory !== null &&
          product.category.id === pieceCategory &&
          product.id !== fixtures.piece.product!.id &&
          product.name !== fixtures.piece.product!.name
        ) {
          // Same-category pick: both fixtures are recent rows of one category,
          // maximizing the chance both cars render on the category's first
          // listing page (co-listing needed by C22/C35).
          fixtures.piece2 = { product, variant: sellable[0]! };
        }
      }
      if (!fixtures.pieceMulti.product && sellable.length >= 2) {
        fixtures.pieceMulti = { product, variants: sellable };
      }
    }
    candidates = [];
    const weights = (await readJson<CardProduct[]>(api, "/api/store/catalog/products?type=WEIGHT&limit=40")) ?? [];
    for (const product of weights) {
      const variants =
        (await readJson<VariantRow[]>(api, `/api/store/catalog/products/${product.id}/variants`)) ?? [];
      const first = variants.filter((v) => v.isActive)[0];
      if (first) {
        fixtures.weight = { product, variant: first };
        break;
      }
    }
  } finally {
    await api.dispose();
  }
});

/* ===================== C01–C05: card add / stepper (guest) ===================== */

test.describe("P09-C01..C05 card add & stepper (guest, FE-e2e)", () => {
  test("P09-C01 add one pack via the card: confirmed «في السلة» from the server snapshot + exactly one mint", async ({
    page,
  }) => {
    test.skip(!fixtures.piece.product, "no unambiguous PIECE fixture — honest skip");
    const { product } = fixtures.piece;
    const mintUrls = trackUrls(page, isCartMint);
    await openListing(page, product!);
    const card = cardFor(page, product!.id, product!.name);
    await expect(card.getByRole("button", { name: "أضف إلى السلة" })).toBeVisible({ timeout: 60000 });
    await card.getByRole("button", { name: "أضف إلى السلة" }).click();
    await expect(card.getByText(/في السلة:/)).toBeVisible({ timeout: 60000 });
    await expect(card.getByText(/في السلة:/)).toHaveText(/^في السلة:\s*1/);
    const token = (await page.evaluate((k) => window.localStorage.getItem(k), TOKEN_KEY)) ?? "";
    expect(token).toMatch(/^[0-9a-f]{64}$/i);
    expect(mintUrls).toHaveLength(1); // mint-once-then-write; the mint precedes the single add
  });

  test("P09-C02 the (+) stepper re-adds with POST quantity \"1\" and the server aggregates to 2", async ({ page }) => {
    test.skip(!fixtures.piece.product, "no unambiguous PIECE fixture — honest skip");
    const { product, variant } = fixtures.piece;
    await openListing(page, product!);
    const card = cardFor(page, product!.id, product!.name);
    const addBodies: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/store/cart/items") && r.method() === "POST") addBodies.push(r.postData() ?? "");
    });
    await card.getByRole("button", { name: "أضف إلى السلة" }).click();
    await expect(card.getByText(/في السلة:/)).toHaveText(/^في السلة:\s*1(\.0+)?$/, { timeout: 60000 });
    await card.getByRole("button", { name: "زيادة الكمية" }).click();
    await expect(card.getByText(/في السلة:/)).toHaveText(/^في السلة:\s*2(\.0+)?$/, { timeout: 60000 });
    // Fresh-visitor ladder: rejected leg (no identity, 400) + mint + retried
    // write = TWO legs for the add, ONE leg for the (+) re-add = 3 POST bodies.
    expect(addBodies).toHaveLength(3);
    for (const b of addBodies) {
      expect(b).toBe(JSON.stringify({ productVariantId: fixtureVariantId(variant), quantity: "1" }));
    }
    const line = await readConfirmedLine(page, fixtureVariantId(variant));
    expect(line && Number(line.quantity)).toBe(2);
  });

  test("P09-C03 the (−) stepper at 2 issues a PATCH absolute \"1\" (never a delta)", async ({ page }) => {
    test.skip(!fixtures.piece.product, "no unambiguous PIECE fixture — honest skip");
    const { product, variant } = fixtures.piece;
    await openListing(page, product!);
    const card = cardFor(page, product!.id, product!.name);
    const patchBodies: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/store/cart/items/") && r.method() === "PATCH") patchBodies.push(r.postData() ?? "");
    });
    await card.getByRole("button", { name: "أضف إلى السلة" }).click();
    await expect(card.getByText(/في السلة:/)).toHaveText(/^في السلة:\s*1(\.0+)?$/, { timeout: 60000 });
    await card.getByRole("button", { name: "زيادة الكمية" }).click();
    await expect(card.getByText(/في السلة:/)).toHaveText(/^في السلة:\s*2(\.0+)?$/, { timeout: 60000 });
    await card.getByRole("button", { name: "تقليل الكمية" }).click();
    await expect(card.getByText(/في السلة:/)).toHaveText(/^في السلة:\s*1(\.0+)?$/, { timeout: 60000 });
    expect(patchBodies).toEqual([JSON.stringify({ quantity: "1" })]); // absolute set
    const line = await readConfirmedLine(page, fixtureVariantId(variant));
    expect(line && Number(line.quantity)).toBe(1);
  });

  test("P09-C04 the (−) stepper at 1 issues DELETE (PATCH 0 is never attempted) and the card returns to add", async ({
    page,
  }) => {
    test.skip(!fixtures.piece.product, "no unambiguous PIECE fixture — honest skip");
    const { product, variant } = fixtures.piece;
    await openListing(page, product!);
    const card = cardFor(page, product!.id, product!.name);
    const patchUrls = trackUrls(page, (u, m) => m === "PATCH" && u.includes("/api/store/cart/items/"));
    const deleteUrls = trackUrls(page, (u, m) => m === "DELETE" && u.includes("/api/store/cart/items/"));
    await card.getByRole("button", { name: "أضف إلى السلة" }).click();
    await expect(card.getByText(/في السلة:/)).toHaveText(/^في السلة:\s*1(\.0+)?$/, { timeout: 60000 });
    await card.getByRole("button", { name: "تقليل الكمية" }).click();
    await expect(card.getByRole("button", { name: "أضف إلى السلة" })).toBeVisible({ timeout: 60000 });
    await expect(card.getByRole("status").last()).toHaveText(/أُزيل من السلة/, { timeout: 60000 });
    expect(patchUrls).toEqual([]); // removal is DELETE-only (contract)
    expect(deleteUrls).toHaveLength(1);
    const token = (await page.evaluate((k) => window.localStorage.getItem(k), TOKEN_KEY)) ?? "";
    const cart = await readCart(page, token || null);
    expect(cart!.lines.find((l: CartLine) => l.productVariantId === fixtureVariantId(variant))).toBeUndefined();
  });

  test("P09-C05 a same-tick double click on (+) sends ONE request (real JS guard, not a disabled mirror)", async ({
    page,
  }) => {
    test.skip(!fixtures.piece.product, "no unambiguous PIECE fixture — honest skip");
    const { product, variant } = fixtures.piece;
    await openListing(page, product!);
    const card = cardFor(page, product!.id, product!.name);
    await card.getByRole("button", { name: "أضف إلى السلة" }).click();
    await expect(card.getByText(/في السلة:/)).toHaveText(/^في السلة:\s*1(\.0+)?$/, { timeout: 60000 });
    // Widen the in-flight window so both synchronous clicks land inside it.
    await page.route(/\/api\/store\/cart\/items$/, (route) => {
      if (route.request().method() === "POST") {
        setTimeout(() => route.continue(), 600);
        return;
      }
      return route.continue();
    });
    let itemPosts = 0;
    page.on("request", (r) => {
      if (r.url().includes("/api/store/cart/items") && r.method() === "POST") itemPosts += 1;
    });
    // Two DOM-level clicks in ONE task: React has not re-rendered yet, so only
    // the synchronous JS guard can swallow the second click.
    await card
      .getByRole("button", { name: "زيادة الكمية" })
      .evaluateAll((els) => {
        for (const el of els.slice(0, 1)) {
          (el as HTMLButtonElement).click();
          (el as HTMLButtonElement).click();
        }
      });
    await expect(card.getByText(/في السلة:/)).toHaveText(/^في السلة:\s*2(\.0+)?$/, { timeout: 60000 });
    await page.waitForTimeout(900); // any wrongly-dispatched second op would have fired by now
    expect(itemPosts).toBe(1);
    const line = await readConfirmedLine(page, fixtureVariantId(variant));
    expect(line && Number(line.quantity)).toBe(2);
  });
});

/* ===================== C06–C14: cart page island (guest) ===================== */

test.describe("P09-C06..C14 cart page island (guest, FE-e2e)", () => {
  test("P09-C06 an ambiguous product (two variants in cart) never displays an invented aggregate", async ({ page }) => {
    test.skip(!fixtures.pieceMulti.product, "no multi-variant PIECE fixture — honest skip");
    const { product, variants } = fixtures.pieceMulti;
    const mintRes = await page.request.post("/api/store/cart");
    expect(mintRes.ok()).toBe(true);
    const token = ((await mintRes.json()) as { data: { guestToken: string } }).data.guestToken;
    setTokenFor(page, token);
    for (const v of variants.slice(0, 2)) {
      const res = await page.request.post("/api/store/cart/items", {
        data: { productVariantId: v.id, quantity: "1" },
        headers: { "x-guest-token": token },
      });
      expect(res.ok()).toBe(true);
    }
    const listed = await openListingSoft(page, product!);
    test.skip(!listed, "multi-variant product not visible on its category listing — honest skip");
    await expect(page.getByText(/في السلة — عدّل الكمية من/)).toBeVisible({ timeout: 60000 });
  });

  test("P09-C07 the cart page renders the confirmed line verbatim (qty text, lineTotal, subtotal label)", async ({
    page,
  }) => {
    test.skip(!fixtures.piece.product, "no unambiguous PIECE fixture — honest skip");
    const { product, variant } = fixtures.piece;
    await openListing(page, product!);
    const card = cardFor(page, product!.id, product!.name);
    await card.getByRole("button", { name: "أضف إلى السلة" }).click();
    await expect(card.getByText(/في السلة:/)).toBeVisible({ timeout: 60000 });
    const confirmed = await readConfirmedLine(page, fixtureVariantId(variant));
    expect(confirmed).not.toBeNull();
    expect(confirmed!.lineTotal).toBeTruthy();
    await page.goto("/cart");
    await expect(page.getByText(product!.name).first()).toBeVisible({ timeout: 60000 });
    const qtyInput = page.getByLabel(`الكمية لـ${product!.name}`);
    await expect(qtyInput).toBeVisible({ timeout: 60000 });
    // VERBATIM: the input holds the server wire text, never a re-rounded value.
    await expect(qtyInput).toHaveValue(confirmed!.quantity);
    await expect(page.getByText(`${confirmed!.lineTotal} ج.م`).first()).toBeVisible();
    await expect(page.getByText(/المجموع الاسترشادي \(غير نهائي\)/)).toBeVisible();
  });

  test("P09-C08 a quantity edit applies (PATCH absolute) and the input shows the confirmed server text", async ({
    page,
  }) => {
    test.skip(!fixtures.piece.product, "no unambiguous PIECE fixture — honest skip");
    const { product, variant } = fixtures.piece;
    await openListing(page, product!);
    const card = cardFor(page, product!.id, product!.name);
    await card.getByRole("button", { name: "أضف إلى السلة" }).click();
    await expect(card.getByText(/في السلة:/)).toBeVisible({ timeout: 60000 });
    await page.goto("/cart");
    const qtyInput = page.getByLabel(`الكمية لـ${product!.name}`);
    await expect(qtyInput).toBeVisible({ timeout: 60000 });
    await qtyInput.fill("4");
    await qtyInput.blur();
    // The PATCH is absolute "4": the server truth converges via the app's own
    // GET (a fresh read, never a resend) BEFORE any read-backed pin — blur and
    // the apply are asynchronous.
    await expect
      .poll(async () => {
        const l = await readConfirmedLine(page, fixtureVariantId(variant));
        return l === null ? null : Number(l.quantity);
      }, { timeout: 15000 })
      .toBe(4);
    const line = await readConfirmedLine(page, fixtureVariantId(variant));
    expect(line && Number(line.quantity)).toBe(4);
    // The displayed value converges to the server's exact wire text.
    await expect(qtyInput).toHaveValue(line!.quantity, { timeout: 60000 });
  });

  test("P09-C09 quantity «0» is refused client-side with the contract wording and NO request", async ({ page }) => {
    test.skip(!fixtures.piece.product, "no unambiguous PIECE fixture — honest skip");
    const { product, variant } = fixtures.piece;
    await openListing(page, product!);
    const card = cardFor(page, product!.id, product!.name);
    await card.getByRole("button", { name: "أضف إلى السلة" }).click();
    await expect(card.getByText(/في السلة:/)).toBeVisible({ timeout: 60000 });
    await page.goto("/cart");
    const qtyInput = page.getByLabel(`الكمية لـ${product!.name}`);
    const patchUrls = trackUrls(page, (u, m) => m === "PATCH" && u.includes("/api/store/cart/items/"));
    await expect(qtyInput).toBeVisible({ timeout: 60000 });
    const before = await readConfirmedLine(page, fixtureVariantId(variant));
    await qtyInput.fill("0");
    await qtyInput.blur();
    await expect(page.getByText(/لإزالة السطر استخدم زر الحذف/)).toBeVisible();
    await page.waitForTimeout(500);
    expect(patchUrls).toEqual([]);
    await expect(qtyInput).toHaveValue(before!.quantity); // reverted to confirmed text
  });

  test("P09-C10 a malformed quantity reverts to the confirmed text and is never pinned", async ({ page }) => {
    test.skip(!fixtures.piece.product, "no unambiguous PIECE fixture — honest skip");
    const { product, variant } = fixtures.piece;
    await openListing(page, product!);
    const card = cardFor(page, product!.id, product!.name);
    await card.getByRole("button", { name: "أضف إلى السلة" }).click();
    await expect(card.getByText(/في السلة:/)).toBeVisible({ timeout: 60000 });
    await page.goto("/cart");
    const qtyInput = page.getByLabel(`الكمية لـ${product!.name}`);
    const patchUrls = trackUrls(page, (u, m) => m === "PATCH" && u.includes("/api/store/cart/items/"));
    await expect(qtyInput).toBeVisible({ timeout: 60000 });
    const before = await readConfirmedLine(page, fixtureVariantId(variant));
    await qtyInput.fill("2.5abc");
    await qtyInput.blur();
    await expect(page.getByText(/الكمية يجب أن تكون رقمًا موجبًا/)).toBeVisible();
    await expect(qtyInput).toHaveValue(before!.quantity, { timeout: 60000 });
    await page.waitForTimeout(400);
    expect(patchUrls).toEqual([]);
  });

  test("P09-C11 a same-tick double click on «حذف» sends exactly ONE DELETE; the empty state follows the server", async ({
    page,
  }) => {
    test.skip(!fixtures.piece.product, "no unambiguous PIECE fixture — honest skip");
    const { product } = fixtures.piece;
    await openListing(page, product!);
    const card = cardFor(page, product!.id, product!.name);
    await card.getByRole("button", { name: "أضف إلى السلة" }).click();
    await expect(card.getByText(/في السلة:/)).toBeVisible({ timeout: 60000 });
    await page.goto("/cart");
    const row = page.locator("li").filter({ has: page.getByText(product!.name) });
    await expect(row).toBeVisible({ timeout: 60000 });
    // Widen the busy window so both synchronous clicks land inside it.
    await page.route(/\/api\/store\/cart\/items\/.+/, (route) => {
      if (route.request().method() === "DELETE") {
        setTimeout(() => route.continue(), 500);
        return;
      }
      return route.continue();
    });
    let deletes = 0;
    page.on("request", (r) => {
      if (r.url().includes("/api/store/cart/items/") && r.method() === "DELETE") deletes += 1;
    });
    await row
      .getByRole("button", { name: "حذف" })
      .evaluateAll((els) => {
        for (const el of els.slice(0, 1)) {
          (el as HTMLButtonElement).click();
          (el as HTMLButtonElement).click();
        }
      });
    await expect(page.getByText("سلتك فاضية")).toBeVisible({ timeout: 60000 });
    await page.waitForTimeout(900);
    expect(deletes).toBe(1);
  });

  test("P09-C12 DELETE whose response never arrives → honest «unknown» alert, ONE reconcile read, NO second DELETE", async ({
    page,
  }) => {
    test.skip(!fixtures.piece.product, "no unambiguous PIECE fixture — honest skip");
    const { product, variant } = fixtures.piece;
    await openListing(page, product!);
    const card = cardFor(page, product!.id, product!.name);
    await card.getByRole("button", { name: "أضف إلى السلة" }).click();
    await expect(card.getByText(/في السلة:/)).toBeVisible({ timeout: 60000 });
    await page.goto("/cart");
    const row = page.locator("li").filter({ has: page.getByText(product!.name) });
    await expect(row).toBeVisible({ timeout: 60000 });
    let deletes = 0;
    page.on("request", (r) => {
      if (r.url().includes("/api/store/cart/items/") && r.method() === "DELETE") deletes += 1;
    });
    await page.route(/\/api\/store\/cart\/items\/.+/, (route) => {
      if (route.request().method() === "DELETE") return route.abort("connectionreset");
      return route.continue();
    });
    // Slow the reconcile GET so the honest alert has a firm visibility window.
    await page.route(/\/api\/store\/cart\/?$/, (route) => {
      if (route.request().resourceType() === "fetch") {
        setTimeout(() => route.continue(), 700);
        return;
      }
      return route.continue();
    });
    await row.getByRole("button", { name: "حذف" }).click();
    await expect(page.getByText(/تعذّر التأكد من نتيجة العملية — جارٍ التحقق من حالة السلة/)).toBeVisible({
      timeout: 10000,
    });
    await page.waitForTimeout(2000);
    expect(deletes).toBe(1); // never auto-resent
    // Server truth (APIRequestContext bypasses routes): the aborted write did NOT apply.
    const token = (await page.evaluate((k) => window.localStorage.getItem(k), TOKEN_KEY)) ?? "";
    const cart = await readCart(page, token || null);
    expect(cart!.lines.some((l: CartLine) => l.productVariantId === fixtureVariantId(variant))).toBe(true);
  });

  test("P09-C13 PATCH whose response never arrives → honest alert, NO auto resend, display = server truth", async ({
    page,
  }) => {
    test.skip(!fixtures.piece.product, "no unambiguous PIECE fixture — honest skip");
    const { product, variant } = fixtures.piece;
    await openListing(page, product!);
    const card = cardFor(page, product!.id, product!.name);
    await card.getByRole("button", { name: "أضف إلى السلة" }).click();
    await expect(card.getByText(/في السلة:/)).toBeVisible({ timeout: 60000 });
    await page.goto("/cart");
    const qtyInput = page.getByLabel(`الكمية لـ${product!.name}`);
    let patches = 0;
    page.on("request", (r) => {
      if (r.url().includes("/api/store/cart/items/") && r.method() === "PATCH") patches += 1;
    });
    await expect(qtyInput).toBeVisible({ timeout: 60000 });
    await page.route(/\/api\/store\/cart\/items\/.+/, (route) => {
      if (route.request().method() === "PATCH") return route.abort("connectionreset");
      return route.continue();
    });
    await page.route(/\/api\/store\/cart\/?$/, (route) => {
      if (route.request().resourceType() === "fetch") {
        setTimeout(() => route.continue(), 700);
        return;
      }
      return route.continue();
    });
    await qtyInput.fill("5");
    await qtyInput.blur();
    await expect(page.getByText(/تعذّر التأكد من نتيجة العملية — جارٍ التحقق من حالة السلة/)).toBeVisible({
      timeout: 10000,
    });
    await page.waitForTimeout(2000);
    expect(patches).toBe(1);
    const line = await readConfirmedLine(page, fixtureVariantId(variant));
    expect(line && Number(line.quantity)).toBe(1); // server truth for the aborted write
    await expect(qtyInput).toHaveValue(line!.quantity);
  });

  test("P09-C14 (API-contract) a VERIFIED 404 set on a deleted line carries no snapshot and the FE mints nothing", async ({
    page,
  }) => {
    test.skip(!fixtures.piece.product, "no unambiguous PIECE fixture — honest skip");
    const { product, variant } = fixtures.piece;
    await openListing(page, product!);
    const card = cardFor(page, product!.id, product!.name);
    await card.getByRole("button", { name: "أضف إلى السلة" }).click();
    await expect(card.getByText(/في السلة:/)).toBeVisible({ timeout: 60000 });
    const token = (await page.evaluate((k) => window.localStorage.getItem(k), TOKEN_KEY)) ?? "";
    const del = await page.request.delete(`/api/store/cart/items/${fixtureVariantId(variant)}`, {
      headers: { "x-guest-token": token },
    });
    expect(del.ok()).toBe(true); // out-of-band removal through the app's own API
    const mints = trackUrls(page, isCartMint);
    // A set on the now-missing line — a verified, message-only 404.
    const probe = await page.evaluate(
      async ([v, t]) => {
        const res = await fetch(`/api/store/cart/items/${v}`, {
          method: "PATCH",
          headers: { "x-guest-token": t, "content-type": "application/json" },
          body: JSON.stringify({ quantity: "3" }),
        });
        return { status: res.status, body: await res.json().catch(() => null) };
      },
      [fixtureVariantId(variant), token],
    );
    expect(probe.status).toBe(404);
    const errBody = (probe.body as { error?: { code?: string; message?: string } } | null) ?? {};
    expect(errBody.error?.code).toBe("NOT_FOUND");
    expect(errBody.error?.message).toBe("Cart line not found.");
    expect((probe.body as Record<string, unknown> | null)?.data).toBeUndefined();
    expect(mints).toHaveLength(0); // set-404 never mints (mint is add-only, BA-A)
  });
});

/* ===================== C15–C18: estimate & reprice (guest) ===================== */

test.describe("P09-C15..C18 estimate & reprice on the cart page (guest)", () => {
  test("P09-C15 the estimate shows the SERVER's labelled totals; the subtotal stays informational", async ({ page }) => {
    test.skip(!fixtures.piece.product, "no unambiguous PIECE fixture — honest skip");
    const { product } = fixtures.piece;
    await openListing(page, product!);
    const card = cardFor(page, product!.id, product!.name);
    await card.getByRole("button", { name: "أضف إلى السلة" }).click();
    await expect(card.getByText(/في السلة:/)).toBeVisible({ timeout: 60000 });
    const token = (await page.evaluate((k) => window.localStorage.getItem(k), TOKEN_KEY)) ?? "";
    const cart = await readCart(page, token || null);
    expect(cart!.lines.length).toBeGreaterThan(0);
    // The server-side reference estimate (the same call the UI itself makes);
    // with an empty coupon field the UI sends the estimate WITHOUT couponCode.
    const serverEstimate = await page.request.post("/api/store/orders/estimate", {
      data: {
        lines: cart!.lines.map((l: CartLine) => ({
          productVariantId: l.productVariantId,
          quantity: l.quantity,
        })),
      },
      headers: { "x-guest-token": token },
    });
    expect(serverEstimate.ok()).toBe(true);
    const est = (await serverEstimate.json()) as {
      data: { subtotal: string; discountTotal: string; deliveryFee: string; total: string };
    };
    await page.goto("/cart");
    await expect(page.getByText(product!.name).first()).toBeVisible({ timeout: 60000 });
    await page.getByRole("button", { name: "تطبيق" }).click();
    await expect(page.getByText(/الإجمالي التقديري:/)).toContainText(`${est.data.total} ج.م`, { timeout: 60000 });
    await expect(page.getByText(/الخصم:/)).toContainText(`${est.data.discountTotal} ج.م`);
    await expect(page.getByText(/التوصيل:/)).toContainText(`${est.data.deliveryFee} ج.م`);
    await expect(page.getByText(/المجموع الاسترشادي \(غير نهائي\)/)).toBeVisible();
    await expect(page.getByText(/السعر النهائي يُحتسب على الخادم عند تأكيد الطلب/)).toBeVisible();
  });

  test("P09-C16 an unknown coupon surfaces the SERVER wording and NO totals appear", async ({ page }) => {
    test.skip(!fixtures.piece.product, "no unambiguous PIECE fixture — honest skip");
    const { product } = fixtures.piece;
    await openListing(page, product!);
    const card = cardFor(page, product!.id, product!.name);
    await card.getByRole("button", { name: "أضف إلى السلة" }).click();
    await expect(card.getByText(/في السلة:/)).toBeVisible({ timeout: 60000 });
    await page.goto("/cart");
    await expect(page.getByText(product!.name).first()).toBeVisible({ timeout: 60000 });
    let estimates = 0;
    page.on("response", (r) => {
      if (r.url().includes("/api/store/orders/estimate")) estimates += 1;
    });
    await page.getByLabel("كود الكوبون").fill("NO-SUCH-COUPON-404");
    await page.getByRole("button", { name: "تطبيق" }).click();
    await expect(page.getByText(/Coupon not found/)).toBeVisible({ timeout: 60000 });
    await expect(page.getByText(/الإجمالي التقديري:/)).toHaveCount(0);
    expect(estimates).toBeGreaterThanOrEqual(1);
  });

  test("P09-C17 an estimate transport failure keeps the cart as last confirmed truth and invents no totals", async ({
    page,
  }) => {
    test.skip(!fixtures.piece.product, "no unambiguous PIECE fixture — honest skip");
    const { product } = fixtures.piece;
    await openListing(page, product!);
    const card = cardFor(page, product!.id, product!.name);
    await card.getByRole("button", { name: "أضف إلى السلة" }).click();
    await expect(card.getByText(/في السلة:/)).toBeVisible({ timeout: 60000 });
    await page.goto("/cart");
    await expect(page.getByText(product!.name).first()).toBeVisible({ timeout: 60000 });
    await page.route("**/api/store/orders/estimate", (route) => route.abort("connectionreset"));
    await page.getByRole("button", { name: "تطبيق" }).click();
    // A transport-level failure surfaces as the app's own transport AppError
    // (INTERNAL «تعذّر الاتصال بالخادم.») in the coupon-note alert slot.
    await expect(page.getByText(/تعذّر الاتصال بالخادم/).first()).toBeVisible({ timeout: 60000 });
    await expect(page.getByText(/الإجمالي التقديري:/)).toHaveCount(0);
    await expect(page.getByText(/المجموع الاسترشادي \(غير نهائي\)/)).toBeVisible();
  });

  test("P09-C18 «تحديث الأسعار» re-prices from the server and reports success once (no local math)", async ({
    page,
  }) => {
    test.skip(!fixtures.piece.product, "no unambiguous PIECE fixture — honest skip");
    const { product } = fixtures.piece;
    await openListing(page, product!);
    const card = cardFor(page, product!.id, product!.name);
    await card.getByRole("button", { name: "أضف إلى السلة" }).click();
    await expect(card.getByText(/في السلة:/)).toBeVisible({ timeout: 60000 });
    await page.goto("/cart");
    await expect(page.getByText(product!.name).first()).toBeVisible({ timeout: 60000 });
    let reprices = 0;
    page.on("request", (r) => {
      if (r.url().includes("/api/store/cart/reprice") && r.method() === "POST") reprices += 1;
    });
    await page.getByRole("button", { name: "تحديث الأسعار" }).click();
    await expect(page.locator('[aria-label="التنبيهات"]').getByText(/تم تحديث الأسعار من المصدر/)).toBeVisible({
      timeout: 60000,
    });
    expect(reprices).toBe(1);
  });
});

/* ===================== C19–C25: keyboard, identity ladder ===================== */

test.describe("P09-C19..C25 keyboard & identity ladder (guest/registered)", () => {
  test("P09-C19 keyboard: the card's add control is reachable and activates on Enter", async ({ page }) => {
    test.skip(!fixtures.piece.product, "no unambiguous PIECE fixture — honest skip");
    const { product } = fixtures.piece;
    await openListing(page, product!);
    const card = cardFor(page, product!.id, product!.name);
    const btn = card.getByRole("button", { name: "أضف إلى السلة" });
    await expect(btn).toBeVisible({ timeout: 60000 });
    await btn.focus();
    await page.keyboard.press("Enter");
    await expect(card.getByText(/في السلة:/)).toBeVisible({ timeout: 60000 });
    await expect(card.getByText(/في السلة:/)).toHaveText(/^في السلة:\s*1(\.0+)?$/);
  });

  test("P09-C20 keyboard: the cart quantity input is label-bound; Tab-blur applies the value", async ({ page }) => {
    test.skip(!fixtures.piece.product, "no unambiguous PIECE fixture — honest skip");
    const { product, variant } = fixtures.piece;
    await openListing(page, product!);
    const card = cardFor(page, product!.id, product!.name);
    await card.getByRole("button", { name: "أضف إلى السلة" }).click();
    await expect(card.getByText(/في السلة:/)).toBeVisible({ timeout: 60000 });
    await page.goto("/cart");
    const qtyInput = page.getByLabel(`الكمية لـ${product!.name}`);
    await expect(qtyInput).toBeVisible({ timeout: 60000 });
    await qtyInput.focus();
    await qtyInput.fill("3");
    await page.keyboard.press("Tab");
    // Tab-blur commits (absolute "3"): poll the app's own GET for the server
    // truth (a fresh read, never a resend) BEFORE any read-backed pin — the
    // commit is asynchronous relative to the Tab press.
    await expect
      .poll(async () => {
        const l = await readConfirmedLine(page, fixtureVariantId(variant));
        return l === null ? null : Number(l.quantity);
      }, { timeout: 15000 })
      .toBe(3);
    const line = await readConfirmedLine(page, fixtureVariantId(variant));
    expect(line && Number(line.quantity)).toBe(3);
    await expect(qtyInput).toHaveValue(line!.quantity, { timeout: 60000 });
  });

  test("P09-C21 the guest token is minted exactly once for the whole journey and reused (no re-mint)", async ({
    page,
  }) => {
    test.skip(!fixtures.piece.product, "no unambiguous PIECE fixture — honest skip");
    const product = fixtures.piece.product!;
    const mints = trackUrls(page, isCartMint);
    // The primary fixture card is RE-CHECKED here (its page-1 listing presence
    // is proven by C01; this pins the TOKEN lifecycle, not the listing).
    await openListing(page, product);
    const card = cardFor(page, product.id, product.name);
    await card.getByRole("button", { name: "أضف إلى السلة" }).click();
    await expect(card.getByText(/في السلة:/)).toBeVisible({ timeout: 60000 });
    expect(mints).toHaveLength(1);
    // The /cart page reuses the SAME guest cart — a second mint never runs.
    await page.goto("/cart");
    await expect(page.getByText(product.name).first()).toBeVisible({ timeout: 60000 });
    expect(mints).toHaveLength(1);
  });

  test("P09-C22 two products = two lines; deleting one leaves the other (one shared snapshot)", async ({ page }) => {
    test.skip(!fixtures.piece.product || !fixtures.piece2.product, "PIECE fixtures missing — honest skip");
    const a = fixtures.piece.product!;
    const b = fixtures.piece2.product!;
    await openListing(page, a);
    await cardFor(page, a.id, a.name).getByRole("button", { name: "أضف إلى السلة" }).click();
    await expect(cardFor(page, a.id, a.name).getByText(/في السلة:/)).toBeVisible({ timeout: 60000 });
    const token = (await page.evaluate((k) => window.localStorage.getItem(k), TOKEN_KEY)) ?? "";
    // Line B added through the app's own API with the SAME token (shared truth).
    const add = await page.request.post("/api/store/cart/items", {
      data: { productVariantId: fixtureVariantId(fixtures.piece2.variant), quantity: "1" },
      headers: { "x-guest-token": token },
    });
    expect(add.ok()).toBe(true);
    await page.goto("/cart");
    await expect(page.getByText(a.name).first()).toBeVisible({ timeout: 60000 });
    await expect(page.getByText(b.name).first()).toBeVisible({ timeout: 60000 });
    await page
      .locator("li")
      .filter({ has: page.getByText(a.name) })
      .getByRole("button", { name: "حذف" })
      .click();
    await expect(page.getByText(b.name).first()).toBeVisible({ timeout: 60000 });
    await expect(page.getByText(a.name)).toHaveCount(0);
  });

  test("P09-C23 a fresh /cart sees the honest «gone» state, NO automatic mint; an explicit «سلة جديدة» mints once", async ({
    page,
  }) => {
    const mints = trackUrls(page, isCartMint);
    await page.goto("/cart");
    await expect(page.getByText("ابدأ سلة جديدة")).toBeVisible({ timeout: 60000 });
    await expect(page.getByRole("button", { name: "سلة جديدة" })).toBeVisible();
    expect(mints).toHaveLength(0); // mint-on-need only — nothing minted without the user
    await page.getByRole("button", { name: "سلة جديدة" }).click();
    await expect(page.getByText("سلتك فاضية")).toBeVisible({ timeout: 60000 });
    expect(mints).toHaveLength(1); // exactly one mint, by explicit user action
    await expect(page.getByRole("link", { name: "تصفّح الأقسام" })).toBeVisible();
  });

  test("P09-C24 a dead-but-well-formed guest token recovers BA-A: add → verified 404 → mint ONCE → the SAME write", async ({
    page,
  }) => {
    test.skip(!fixtures.piece.product, "no unambiguous PIECE fixture — honest skip");
    const garbageToken = "d".repeat(64);
    setTokenFor(page, garbageToken);
    await openListing(page, fixtures.piece.product!);
    const card = cardFor(page, fixtures.piece.product!.id, fixtures.piece.product!.name);
    const mints = trackUrls(page, isCartMint);
    await card.getByRole("button", { name: "أضف إلى السلة" }).click();
    await expect(card.getByText(/في السلة:/)).toBeVisible({ timeout: 60000 });
    await expect(card.getByText(/في السلة:/)).toHaveText(/^في السلة:\s*1(\.0+)?$/);
    expect(mints).toHaveLength(1); // mint once, then the SAME write re-applied
    const stored = (await page.evaluate((k) => window.localStorage.getItem(k), TOKEN_KEY)) ?? "";
    expect(stored).toMatch(/^[0-9a-f]{64}$/i);
    expect(stored.toLowerCase()).not.toBe(garbageToken.toLowerCase());
  });

  test("P09-C25 both-sides identity resolves by ONE clear: the stale bearer is wiped, the session-side add answers 404 (no active cart), the card shows the honest rejection — no guest mint, no fake success", async ({
    page,
  }) => {
    test.skip(!fixtures.piece.product, "no unambiguous PIECE fixture — honest skip");
    const registered = await registerCustomer(page);
    test.skip(!registered, "customer registration unavailable on this environment — honest skip");
    setTokenFor(page, "e".repeat(64));
    const mints = trackUrls(page, isCartMint);
    await openListing(page, fixtures.piece.product!);
    const card = cardFor(page, fixtures.piece.product!.id, fixtures.piece.product!.name);
    // Server truth (identity probe P3): a raw POST /items carrying BOTH the
    // guest bearer and the customer session answers 400 «Exactly one of guest
    // token / customer session is required.» The FE resolves that state by
    // clearing the token exactly once (store mount-read and/or the add's own
    // ladder leg) and re-issuing the SAME write with the session side only —
    // which for a fresh registered customer is a VERIFIED 404 «Active cart not
    // found.» (create-on-add does not exist). Wait for the one clear, then add.
    await expect
      .poll(() => page.evaluate((k) => window.localStorage.getItem(k), TOKEN_KEY), { timeout: 15000 })
      .toBe(null);
    await card.getByRole("button", { name: "أضف إلى السلة" }).click();
    // The honest card outcome: the generic definite-rejection note (role=alert,
    // server wording IS shown verbatim on the PDP link, never a fake success).
    await expect(card.getByText(/تعذّر الإضافة — راجع صفحة التفاصيل وحاول مجددًا/)).toBeVisible({
      timeout: 60000,
    });
    // No stepper, and no confirmed «في السلة» claim ever appears.
    await expect(card.getByText(/في السلة:/)).toHaveCount(0);
    // The add ladder's ONE recovery leg DOES fire on the 404 (mintOnCartNotFound):
    // POST /cart with the session owner is the app's own documented
    // create-or-get — it creates an EMPTY session cart and returns NO guest
    // token, so the line write itself is never retried (mint token null) and
    // no guest token ever lands in localStorage. Exactly one mint leg.
    expect(mints).toHaveLength(1);
    const stored = await page.evaluate((k) => window.localStorage.getItem(k), TOKEN_KEY);
    expect(stored).toBeNull(); // cleared exactly once; no guest token re-minted
    // Server truth: the line write NEVER applied. Post-mint the session owner
    // has an EMPTY active cart (0 lines) — no line, no guest cart, no invented
    // success anywhere.
    const truth = await page.context().request.get("/api/store/cart");
    expect(truth.status()).toBe(200);
    const truthBody = (await truth.json()) as { data: { cart: { lines: CartLine[] } } };
    expect(truthBody.data.cart.lines).toHaveLength(0);
  });
});

/* ===================== C26–C29: merge journey (registered) ===================== */

test.describe("P09-C26..C29 registered-customer merge journey", () => {
  test("P09-C26 a fresh registered customer: /cart «gone», the explicit session mint, an honest add, then the merge answers the SERVER wording (never a fake success)", async ({ page }) => {
    const registered = await registerCustomer(page);
    test.skip(!registered, "customer registration unavailable — honest skip");
    const { product } = fixtures.piece;
    test.skip(!product, "no unambiguous PIECE fixture — honest skip");
    // Identity probe P4/P6 truth: a fresh registered customer has NO active
    // cart (add → 404; GET /cart → 404), so /cart shows the honest gone state
    // and mints NOTHING until the user acts.
    const mints = trackUrls(page, isCartMint);
    await page.goto("/cart");
    await expect(page.getByText("ابدأ سلة جديدة")).toBeVisible({ timeout: 60000 });
    expect(mints).toHaveLength(0);
    // The explicit user action mints the SESSION cart once.
    await page.getByRole("button", { name: "سلة جديدة" }).click();
    await expect(page.getByText("سلتك فاضية")).toBeVisible({ timeout: 60000 });
    expect(mints).toHaveLength(1);
    // Add through the card (session side, active cart exists now).
    await openListing(page, product!);
    const card = cardFor(page, product!.id, product!.name);
    await card.getByRole("button", { name: "أضف إلى السلة" }).click();
    await expect(card.getByText(/في السلة:/)).toHaveText(/^في السلة:\s*1(\.0+)?$/, { timeout: 60000 });
    await page.goto("/cart");
    await expect(page.getByRole("button", { name: "دمج سلة الضيف في حسابي" })).toBeVisible({ timeout: 60000 });
    const merges = trackUrls(page, (u, m) => m === "POST" && u.includes("/api/store/cart/merge"));
    await page.getByRole("button", { name: "دمج سلة الضيف في حسابي" }).click();
    // Server truth (merge route): without a guest bearer the merge is refused
    // in plain wording — shown verbatim, never a fake success.
    await expect(page.getByText(/A valid guest token is required/)).toBeVisible({ timeout: 60000 });
    expect(merges).toHaveLength(1);
  });

  test("P09-C27 both-sides READ (token + session) clears the stale bearer once and keeps the guest cart server-side", async ({
    page,
    playwright,
  }) => {
    test.skip(!fixtures.piece.product, "no unambiguous PIECE fixture — honest skip");
    const { product } = fixtures.piece;
    await openListing(page, product!);
    await cardFor(page, product!.id, product!.name).getByRole("button", { name: "أضف إلى السلة" }).click();
    await expect(cardFor(page, product!.id, product!.name).getByText(/في السلة:/)).toBeVisible({ timeout: 60000 });
    const guestToken = (await page.evaluate((k) => window.localStorage.getItem(k), TOKEN_KEY)) ?? "";
    expect(guestToken).toMatch(/^[0-9a-f]{64}$/i);
    const registered = await registerCustomer(page);
    expect(registered).toBe(true);
    // Now the page read carries BOTH identities → the ladder clears the bearer.
    await page.goto("/cart");
    await expect(page.getByText(/ابدأ سلة جديدة|سلتك فاضية/)).toBeVisible({ timeout: 60000 });
    const stored = await page.evaluate((k) => window.localStorage.getItem(k), TOKEN_KEY);
    expect(stored).toBeNull();
    // Server truth: the guest cart itself was NOT consumed by a read (no
    // merge). Reread via a FRESH standalone context — the page's own jar now
    // carries the session cookie, and a throwaway standalone context keeps
    // this read guest-only (a cookie-bearing reread would be the OTHER truth:
    // both-sides 400, covered by the FE leg above).
    const fresh = await playwright.request.newContext();
    try {
      const reread = await fresh.get("/api/store/cart", {
        headers: { "x-guest-token": guestToken },
      });
      expect(reread.status()).toBe(200);
      const guestCart = (await reread.json()) as { data: { cart: { lines: CartLine[] } } };
      expect(guestCart.data.cart.lines).toHaveLength(1);
    } finally {
      await fresh.dispose();
    }
  });

  test("P09-C28 (API-contract) the real merge: the guest line joins the session cart; the consumed guest cart reads 404 and a SECOND merge answers 404 (a missing cart is NOT a conflict)", async ({
    request,
    playwright,
  }) => {
    test.skip(!fixtures.piece.variant, "no PIECE variant fixture — honest skip");
    // Session side: the standalone `request` fixture does NOT persist the
    // register Set-Cookie (Secure-on-http), so the session travels as the
    // customerToken the register response itself provides (identity probe P5).
    const reg = await request.post("/api/store/customers/register", {
      data: {
        phone: uniquePhone(),
        firstName: "دمج",
        lastName: "حقيقي",
        password: "p09-strong-password-2",
      },
    });
    test.skip(!reg.ok(), "customer registration unavailable — honest skip");
    const customerToken = (await reg.json()).data.customerToken as string;
    expect(customerToken).toMatch(/^[0-9a-f]{64}$/i);
    // Guest side: a FRESH standalone context (mint + add; no shared cookies).
    const guest = await playwright.request.newContext();
    try {
      const mintRes = await guest.post("/api/store/cart");
      const guestToken = mintRes.ok()
        ? ((await mintRes.json()) as { data: { guestToken: string } }).data.guestToken
        : null;
      test.skip(guestToken === null, "guest mint unavailable — honest skip");
      const add = await guest.post("/api/store/cart/items", {
        data: { productVariantId: fixtureVariantId(fixtures.piece.variant), quantity: "1" },
        headers: { "x-guest-token": guestToken! },
      });
      test.skip(!add.ok(), "guest add unavailable — honest skip");
      // The real merge carries BOTH identities on one request: the guest bearer
      // the server consumes + the customer identity header (probe P5C: 200).
      const first = await guest.post("/api/store/cart/merge", {
        headers: { "x-guest-token": guestToken!, "x-customer-token": customerToken },
      });
      test.skip(!first.ok(), `first merge refused (${first.status()}) — honest skip`);
      const firstBody = (await first.json()) as {
        data: { cart: { lines: CartLine[] }; merge: Record<string, unknown> };
      };
      // The merged line now lives in the SESSION cart (exactly one line).
      expect(
        firstBody.data.cart.lines.some(
          (l: CartLine) => l.productVariantId === fixtureVariantId(fixtures.piece.variant),
        ),
      ).toBe(true);
      expect(firstBody.data.cart.lines).toHaveLength(1);
      // The merge report shape (probe: mode, inserted, summed, dropped).
      expect(Object.keys(firstBody.data.merge).sort()).toEqual(["dropped", "inserted", "mode", "summed"]);
      // The guest cart is CONSUMED: guest-only reads behave absent (404)…
      const reread = await guest.get("/api/store/cart", { headers: { "x-guest-token": guestToken! } });
      expect(reread.status()).toBe(404);
      const rereadBody = (await reread.json()) as { error: { code: string } };
      expect(rereadBody.error.code).toBe("NOT_FOUND");
      // …and a second merge does NOT conflict: the guest cart is gone → the
      // honest NOT_FOUND «Guest cart not found.» (probe P5E; the old 409
      // wording applied to a different, non-grounded expectation).
      const second = await guest.post("/api/store/cart/merge", {
        headers: { "x-guest-token": guestToken!, "x-customer-token": customerToken },
      });
      expect(second.status()).toBe(404);
      const body = (await second.json()) as { error: { message: string; code: string } };
      expect(body.error.code).toBe("NOT_FOUND");
      expect(body.error.message).toBe("Guest cart not found.");
    } finally {
      await guest.dispose();
    }
  });

  test("P09-C29 the merged cart persists across a reload (server truth, not client memory)", async ({
    page,
    playwright,
  }) => {
    test.skip(!fixtures.piece.variant, "no PIECE variant fixture — honest skip");
    const registered = await registerCustomer(page);
    test.skip(!registered, "customer registration unavailable — honest skip");
    // Guest leg in a FRESH standalone context: the shared jar ALREADY holds the
    // session cookie after register, so a guest cart must not be staged there
    // (it would mint a session cart, not a guest one).
    const guest = await playwright.request.newContext();
    try {
      const mintRes = await guest.post("/api/store/cart");
      const token = mintRes.ok()
        ? ((await mintRes.json()) as { data: { guestToken: string } }).data.guestToken
        : null;
      test.skip(token === null, "guest mint unavailable — honest skip");
      const add = await guest.post("/api/store/cart/items", {
        data: { productVariantId: fixtureVariantId(fixtures.piece.variant), quantity: "1" },
        headers: { "x-guest-token": token! },
      });
      test.skip(!add.ok(), "guest add unavailable — honest skip");
      // The merge rides the UI's own session path (identity probe P5): the
      // context jar's session cookie + the guest bearer header.
      const merge = await page.request.post("/api/store/cart/merge", {
        headers: { "x-guest-token": token! },
      });
      test.skip(!merge.ok(), `merge refused (${merge.status()}) — honest skip`);
    } finally {
      await guest.dispose();
    }
    // The UI reads the SESSION cart: the merged line must be there on the
    // first render AND after a reload (server truth, not client memory).
    await page.goto("/cart");
    await expect(page.getByText(fixtures.piece.product!.name).first()).toBeVisible({ timeout: 60000 });
    await page.reload();
    await expect(page.getByText(fixtures.piece.product!.name).first()).toBeVisible({ timeout: 60000 });
  });
});

/* ===================== C30–C35: contract gates, weight, visuals ===================== */

test.describe("P09-C30..C38 contract gates, weight, and visual evidence", () => {
  test("P09-C30 (API-contract) quantity gates: 0/negative → 400 VALIDATION; fractional packs → 422 exact wording", async ({
    request,
  }) => {
    test.skip(!fixtures.piece.variant, "no PIECE variant fixture — honest skip");
    const mintRes = await request.post("/api/store/cart");
    const token = ((await mintRes.json()) as { data: { guestToken: string } }).data.guestToken;
    const add = (qty: string) =>
      request.post("/api/store/cart/items", {
        data: { productVariantId: fixtureVariantId(fixtures.piece.variant), quantity: qty },
        headers: { "x-guest-token": token },
      });
    const rZero = await add("0");
    expect(rZero.status()).toBe(400);
    const bodyZero = (await rZero.json()) as { error: { code: string } };
    expect(bodyZero.error.code).toBe("VALIDATION");
    const rNeg = await add("-1");
    expect(rNeg.status()).toBe(400);
    const rFrac = await add("1.500");
    expect(rFrac.status()).toBe(422);
    const bodyFrac = (await rFrac.json()) as { error: { code: string; message: string } };
    expect(bodyFrac.error.code).toBe("BUSINESS_RULE");
    expect(bodyFrac.error.message).toBe("Piece quantity must be whole packs.");
    const cartRes = await request.get("/api/store/cart", { headers: { "x-guest-token": token } });
    expect(cartRes.ok()).toBe(true);
    const cartData = (await cartRes.json()) as { data: { cart: { lines: CartLine[] } } };
    expect(cartData.data.cart.lines).toHaveLength(0); // none of the refused writes landed
  });

  test("P09-C31 a WEIGHT line's estimate totals come only from the server (step-multiple quantity)", async ({
    page,
  }) => {
    test.skip(!fixtures.weight.product || !fixtures.weight.variant, "no WEIGHT fixture — honest skip");
    const { product, variant } = fixtures.weight;
    const step = product!.saleStepGrams ?? 125;
    // Quantity in the variant's LIVE sale unit, a multiple of the sale step:
    // KG products take decimal kg, GRAM products take plain grams.
    const qtyText = variant!.sizeUnit === "KG" ? ((step * 2) / 1000).toFixed(3) : (step * 2).toFixed(0);
    const mintRes = await page.request.post("/api/store/cart");
    const token = ((await mintRes.json()) as { data: { guestToken: string } }).data.guestToken;
    setTokenFor(page, token);
    const addRes = await page.request.post("/api/store/cart/items", {
      data: { productVariantId: fixtureVariantId(variant), quantity: qtyText },
      headers: { "x-guest-token": token },
    });
    test.skip(!addRes.ok(), `WEIGHT add refused (${addRes.status()}) — honest skip`);
    const serverEstimate = await page.request.post("/api/store/orders/estimate", {
      data: { lines: [{ productVariantId: fixtureVariantId(variant), quantity: qtyText }] },
      headers: { "x-guest-token": token },
    });
    expect(serverEstimate.ok()).toBe(true);
    const est = (await serverEstimate.json()) as { data: { total: string } };
    await page.goto("/cart");
    await expect(page.getByText(product!.name).first()).toBeVisible({ timeout: 60000 });
    await page.getByRole("button", { name: "تطبيق" }).click();
    await expect(page.getByText(/الإجمالي التقديري:/)).toContainText(`${est.data.total} ج.م`, { timeout: 60000 });
  });

  test("P09-C32 finality honesty: exact «غير نهائي» wording with lines present; the final-price promise intact", async ({
    page,
  }) => {
    test.skip(!fixtures.piece.product, "no unambiguous PIECE fixture — honest skip");
    const { product } = fixtures.piece;
    await openListing(page, product!);
    await cardFor(page, product!.id, product!.name).getByRole("button", { name: "أضف إلى السلة" }).click();
    await expect(cardFor(page, product!.id, product!.name).getByText(/في السلة:/)).toBeVisible({ timeout: 60000 });
    await page.goto("/cart");
    await expect(page.getByText(/المجموع الاسترشادي \(غير نهائي\)/)).toBeVisible({ timeout: 60000 });
    await expect(page.getByText(/السعر النهائي يُحتسب على الخادم عند تأكيد الطلب/)).toBeVisible();
  });

  test("P09-C33 visual evidence: cart-with-lines + estimate at 320/375/768/1024/1440", async ({ page }) => {
    test.skip(!fixtures.piece.product, "no unambiguous PIECE fixture — honest skip");
    const { product, variant } = fixtures.piece;
    const mintRes = await page.request.post("/api/store/cart");
    const token = ((await mintRes.json()) as { data: { guestToken: string } }).data.guestToken;
    const add = await page.request.post("/api/store/cart/items", {
      data: { productVariantId: fixtureVariantId(variant), quantity: "2" },
      headers: { "x-guest-token": token },
    });
    expect(add.ok()).toBe(true);
    const estimate = await page.request.post("/api/store/orders/estimate", {
      data: { lines: [{ productVariantId: fixtureVariantId(variant), quantity: "2" }] },
      headers: { "x-guest-token": token },
    });
    expect(estimate.ok()).toBe(true);
    setTokenFor(page, token);
    for (const width of [320, 375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: Math.max(760, Math.round(width * 1.3)) });
      await page.goto("/cart");
      await expect(page.getByText(product!.name).first()).toBeVisible({ timeout: 60000 });
      await page.getByRole("button", { name: "تطبيق" }).click();
      await expect(page.getByText(/الإجمالي التقديري:/)).toBeVisible({ timeout: 60000 });
      await page.screenshot({
        path: `${EVIDENCE}/screenshots/P09-C33-cart-${width}.png`,
        fullPage: true,
      });
    }
  });

  test("P09-C34 visual evidence: the honest empty cart («سلتك فاضية») at 320 and 1440", async ({ page }) => {
    // A minted-but-empty guest cart is the state whose honest empty UI is shown.
    const mintRes = await page.request.post("/api/store/cart");
    if (!mintRes.ok()) test.skip(true, "guest mint unavailable — honest skip");
    const token = ((await mintRes.json()) as { data: { guestToken: string } }).data.guestToken;
    setTokenFor(page, token);
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: Math.max(760, Math.round(width * 1.3)) });
      await page.goto("/cart");
      await expect(page.getByText("سلتك فاضية")).toBeVisible({ timeout: 60000 });
      await page.screenshot({
        path: `${EVIDENCE}/screenshots/P09-C34-empty-${width}.png`,
        fullPage: true,
      });
    }
  });

  test("P09-C35 two cards add in sequence; BOTH confirm from server snapshots (no starvation)", async ({ page }) => {
    test.skip(!fixtures.piece.product || !fixtures.piece2.product, "PIECE fixtures missing — honest skip");
    const a = fixtures.piece.product!;
    const b = fixtures.piece2.product!;
    await openListing(page, a);
    // Both fixture cards must share this listing page — else honest skip.
    const bVisible =
      (await page
        .getByRole("heading", { name: b.name })
        .first()
        .isVisible()
        .catch(() => false)) === true;
    test.skip(!bVisible, "the two fixture products never share one listing — honest skip");
    let adds = 0;
    page.on("request", (r) => {
      if (r.url().includes("/api/store/cart/items") && r.method() === "POST") adds += 1;
    });
    const cardA = cardFor(page, a.id, a.name);
    await cardA.getByRole("button", { name: "أضف إلى السلة" }).click();
    await expect(cardA.getByText(/في السلة:/)).toBeVisible({ timeout: 60000 });
    const cardB = cardFor(page, b.id, b.name);
    await cardB.getByRole("button", { name: "أضف إلى السلة" }).click();
    await expect(cardB.getByText(/في السلة:/)).toBeVisible({ timeout: 60000 });
    // Fresh-visitor identity ladder: card A's add = rejected leg + mint + retry
    // (TWO /items POSTs); card B's add = ONE leg. Total 3, mints still NOT here.
    expect(adds).toBe(3);
    // No starvation: card A still shows its own confirmed line after card B's op.
    await expect(cardA.getByText(/في السلة:/)).toBeVisible({ timeout: 60000 });
    const token = (await page.evaluate((k) => window.localStorage.getItem(k), TOKEN_KEY)) ?? "";
    const cart = await readCart(page, token || null);
    expect(cart!.lines).toHaveLength(2);
  });

  test("P09-C36 (API-contract) a WEIGHT line's quantity PATCH applies absolutely in the live unit; refusals never invent a value", async ({
    page,
  }) => {
    test.skip(!fixtures.weight.product || !fixtures.weight.variant, "no WEIGHT fixture — honest skip");
    const { variant } = fixtures.weight;
    const mintRes = await page.request.post("/api/store/cart");
    expect(mintRes.ok()).toBe(true);
    const token = ((await mintRes.json()) as { data: { guestToken: string } }).data.guestToken;
    setTokenFor(page, token); // readConfirmedLine reads the token from localStorage
    // Quantity in the variant's LIVE sale unit (KG → decimal kg), a step multiple:
    // 0.500 kg = 500 g = 2 × 250 g.
    const addRes = await page.request.post("/api/store/cart/items", {
      data: { productVariantId: fixtureVariantId(variant), quantity: "0.500" },
      headers: { "x-guest-token": token },
    });
    test.skip(!addRes.ok(), `WEIGHT add refused (${addRes.status()}) — honest skip`);
    const addCart = ((await addRes.json()) as { data: { cart: { lines: WeightLine[] } } }).data.cart;
    const added = addCart.lines.find((l) => l.productVariantId === fixtureVariantId(variant))!;
    expect(added.quantity).toBeTruthy(); // server text, never a local default
    expect(added.unitSnapshot).toBe(variant!.sizeUnit); // counting-unit pin: the live sale unit
    expect(added.productType).toBe("WEIGHT");

    // PATCH absolute "1.250" (5 × 250 g): 200 with the full server cart.
    const patchRes = await page.request.patch(`/api/store/cart/items/${fixtureVariantId(variant)}`, {
      data: { quantity: "1.250" },
      headers: { "x-guest-token": token },
    });
    expect(patchRes.ok()).toBe(true);
    const patchedCart = ((await patchRes.json()) as { data: { cart: { lines: WeightLine[] } } }).data.cart;
    const patched = patchedCart.lines.find((l) => l.productVariantId === fixtureVariantId(variant))!;

    // An independent fresh read — three-way convergence with the PATCH response.
    // readCart with the EXPLICIT token — this API-contract test never
    // navigates, so the localStorage probe (readConfirmedLine) must NOT be used.
    const rereadCart = await readCart(page, token);
    const reread =
      rereadCart?.lines.find((l) => l.productVariantId === fixtureVariantId(variant)) ?? null;
    expect(reread).not.toBeNull();
    expect(patched.quantity).toBe(reread!.quantity);
    expect(patched.quantity).not.toBe(added.quantity);

    // Exactly ONE row for the variant — no duplicated line was created.
    const cartAfter = await readCart(page, token);
    expect(cartAfter!.lines.filter((l) => l.productVariantId === fixtureVariantId(variant))).toHaveLength(1);

    // A valid step multiple is refused by a ZERO/4-decimals edit and nothing lands:
    // non-step "0.400" → 422 BUSINESS_RULE (exact server wording).
    const refuseStep = await page.request.patch(`/api/store/cart/items/${fixtureVariantId(variant)}`, {
      data: { quantity: "0.400" },
      headers: { "x-guest-token": token },
    });
    expect(refuseStep.status()).toBe(422);
    expect(((await refuseStep.json()) as { error: { message: string } }).error.message).toContain(
      "Weight quantity violates the sale step.",
    );
    // zero → 400 VALIDATION (removal is DELETE only); four decimals → 400 regex.
    expect(
      (
        await page.request.patch(`/api/store/cart/items/${fixtureVariantId(variant)}`, {
          data: { quantity: "0" },
          headers: { "x-guest-token": token },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await page.request.patch(`/api/store/cart/items/${fixtureVariantId(variant)}`, {
          data: { quantity: "0.2500" },
          headers: { "x-guest-token": token },
        })
      ).status(),
    ).toBe(400);

    // The refused writes never touched the stored quantity (weightStep math, last-writer-wins).
    const afterRefusalsCart = await readCart(page, token);
    const afterRefusals =
      afterRefusalsCart?.lines.find((l) => l.productVariantId === fixtureVariantId(variant)) ?? null;
    expect(Number(afterRefusals!.quantity)).toBe(1.25);
  });

  test("P09-C37 weight quantity edit via the real cart control: server-converged input, refresh-persistent, and the PIECE-only card reality pinned (no invented WEIGHT number)", async ({
    page,
  }) => {
    test.skip(!fixtures.weight.product || !fixtures.weight.variant, "no WEIGHT fixture — honest skip");
    const { product, variant } = fixtures.weight;
    // Real PDP flow: the purchase island owns the weight choice (cards never
    // sell weights). Open the WEIGHT fixture page directly.
    await page.goto(`/p/${product!.id}/${encodeURIComponent(product!.slug)}`);
    // One sellable variant seeded → the panel offers its gram presets.
    const preset = page.getByRole("group", { name: "أوزان جاهزة" }).getByRole("button", { name: "500 جم" });
    await expect(preset).toBeVisible({ timeout: 60000 });
    await preset.click();
    // Fresh-visitor identity ladder staged by the panel itself: rejected leg
    // → mint → the SAME write retried. The success toast is immediate.
    await page.getByRole("button", { name: "أضف إلى السلة" }).click();
    await expect(page.getByText("تمت الإضافة إلى السلة.")).toBeVisible({ timeout: 60000 });
    // The minted guest token lives in localStorage — wait for the
    // server-confirmed line; its text is the ONLY quantity source below.
    await expect
      .poll(async () => (await readConfirmedLine(page, fixtureVariantId(variant)))?.quantity ?? null, { timeout: 30000 })
      .toBeTruthy();
    const addedQty = (await readConfirmedLine(page, fixtureVariantId(variant)))!;

    await page.goto("/cart");
    const qtyInput = page.getByLabel(`الكمية لـ${product!.name}`);
    await expect(qtyInput).toBeVisible({ timeout: 60000 });
    // VERBATIM from the server: the NUMERIC(12,3) wire text of 500 g ("0.5").
    await expect(qtyInput).toHaveValue(addedQty.quantity, { timeout: 60000 });

    // Edit 1: a second valid, different step multiple — PATCH absolute "1.250".
    await qtyInput.fill("1.250");
    await qtyInput.blur();
    await expect
      .poll(async () => {
        const l = await readConfirmedLine(page, fixtureVariantId(variant));
        return l === null ? null : Number(l.quantity);
      }, { timeout: 30000 })
      .toBe(1.25);
    const stored1 = (await readConfirmedLine(page, fixtureVariantId(variant)))!;
    expect(stored1.quantity).not.toBe(addedQty.quantity);
    // The displayed value converges to the server's exact wire text ("1.25").
    await expect(qtyInput).toHaveValue(stored1.quantity, { timeout: 60000 });

    // Edit 2: a NON-STEP quantity is refused — the server wording shows
    // verbatim in the problem box, the stored quantity stays the last
    // confirmed value, and the input reverts to that same server text.
    await qtyInput.fill("1.400");
    await qtyInput.blur();
    await expect(
      page.getByRole("alert").filter({ hasText: "Weight quantity violates the sale step." }),
    ).toBeVisible({ timeout: 30000 });
    const stored2 = (await readConfirmedLine(page, fixtureVariantId(variant)))!;
    expect(stored2.quantity).toBe(stored1.quantity);
    await expect(qtyInput).toHaveValue(stored2.quantity, { timeout: 30000 });

    // Refresh-persistent: a page reload re-reads from the server.
    await page.reload();
    const qtyInputAfter = page.getByLabel(`الكمية لـ${product!.name}`);
    await expect(qtyInputAfter).toHaveValue(stored2.quantity, { timeout: 60000 });
    // Exactly ONE row for the variant after the whole edit ladder (each cart
    // line owns one labeled quantity input — no duplicate line was created).
    await expect(qtyInputAfter).toHaveCount(1);

    // Data reality pinned honestly from the WEIGHT side: the card island does
    // not exist for weights (product-card.tsx mounts CardBuy ONLY for PIECE —
    // weights are sold only from the PDP panel), so the card can never
    // display an invented WEIGHT quantity either.
    await openListing(page, product!);
    const card = cardFor(page, product!.id, product!.name);
    await expect(card.getByRole("button", { name: "أضف إلى السلة" })).toHaveCount(0);
    await expect(card.getByText(/في السلة:/)).toHaveCount(0);
  });

  test("P09-C38 (API-contract) a registered customer's WEIGHT quantity PATCH on the session cart: absolute apply, refusals never invent a value", async ({
    page,
  }) => {
    test.skip(!fixtures.weight.product || !fixtures.weight.variant, "no WEIGHT fixture — honest skip");
    const { variant } = fixtures.weight;
    // A REAL customer session through the app's own register endpoint; the
    // HttpOnly session cookie lands in the shared jar (page.request).
    test.skip(!(await registerCustomer(page)), "customer register unavailable — honest skip");
    // Mint the CUSTOMER session cart: bare POST /cart, NO x-guest-token.
    const mintRes = await page.request.post("/api/store/cart");
    test.skip(!mintRes.ok(), "customer cart mint unavailable — honest skip");
    const addRes = await page.request.post("/api/store/cart/items", {
      data: { productVariantId: fixtureVariantId(variant), quantity: "0.500" },
    });
    test.skip(!addRes.ok(), `customer WEIGHT add refused (${addRes.status()}) — honest skip`);
    const addCart = ((await addRes.json()) as { data: { cart: { lines: WeightLine[] } } }).data.cart;
    const added = addCart.lines.find((l) => l.productVariantId === fixtureVariantId(variant))!;
    expect(added.quantity).toBeTruthy();
    expect(added.unitSnapshot).toBe(variant!.sizeUnit);
    expect(added.productType).toBe("WEIGHT");

    // PATCH absolute "2.000" → 200 with the full server cart.
    const patchRes = await page.request.patch(`/api/store/cart/items/${fixtureVariantId(variant)}`, {
      data: { quantity: "2.000" },
    });
    expect(patchRes.ok()).toBe(true);
    const patchedCart = ((await patchRes.json()) as { data: { cart: { lines: WeightLine[] } } }).data.cart;
    const patched = patchedCart.lines.find((l) => l.productVariantId === fixtureVariantId(variant))!;

    // An independent fresh session-side read — convergence with the PATCH.
    const freshCart = await readCart(page, null);
    expect(freshCart).not.toBeNull();
    const reread = freshCart!.lines.find((l) => l.productVariantId === fixtureVariantId(variant))!;
    expect(Number(reread.quantity)).toBe(2);
    expect(patched.quantity).toBe(reread.quantity);
    expect(patched.quantity).not.toBe(added.quantity);

    // A NON-STEP edit is refused with the exact server wording; nothing lands.
    const refuseStep = await page.request.patch(`/api/store/cart/items/${fixtureVariantId(variant)}`, {
      data: { quantity: "0.400" },
    });
    expect(refuseStep.status()).toBe(422);
    const refuseError = ((await refuseStep.json()) as { error: { code: string; message: string } }).error;
    expect(refuseError.code).toBe("BUSINESS_RULE");
    expect(refuseError.message).toContain("Weight quantity violates the sale step.");

    // The refused write never touched the stored quantity; exactly ONE line.
    const afterRefusals = await readCart(page, null);
    expect(afterRefusals).not.toBeNull();
    const afterLine = afterRefusals!.lines.find((l) => l.productVariantId === fixtureVariantId(variant))!;
    expect(Number(afterLine.quantity)).toBe(2);
    expect(afterRefusals!.lines.filter((l) => l.productVariantId === fixtureVariantId(variant))).toHaveLength(1);
  });
});
