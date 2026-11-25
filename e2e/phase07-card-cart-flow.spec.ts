// Phase 07 (P07-T01) — card ⇄ PDP ⇄ cart one-truth journey against the live local
// dev DB through the app's OWN surfaces: server-rendered listings/PDP render the
// islands and all cart writes happen via the app's own API routes (guest token
// identity). Catalog reads stay read-only; the ONLY business rows this suite
// creates are guest-cart lines created through the app, cleared again through
// the app's DELETE /api/store/cart/items (evidence in the run folder report —
// cleared ACTIVE cart rows may remain and are disclosed, no fake cleanup).
// Data-agnostic where catalog rows vary, while server/config/DB preconditions
// MUST fail loudly rather than skipping silently (never masquerade broken setup as 0 failed).
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { Client } from "pg";

test.setTimeout(120000);

function resolveIsolatedTarget(): { baseUrl: string; databaseUrl: string } {
  const rawBase =
    process.env.PHASE07_BASE_URL ??
    process.env.E2E_BASE_URL ??
    process.env.PHASE10_BASE_URL ??
    "";
  if (rawBase.trim() === "") {
    throw new Error(
      "PHASE07_MISSING_BASE_URL: Set PHASE07_BASE_URL (or E2E_BASE_URL / PHASE10_BASE_URL) pointing to an isolated loopback server; refusing hardcoded fallback.",
    );
  }
  const parsed = new URL(rawBase);
  const loopback = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  if (!loopback.has(parsed.hostname)) {
    throw new Error(`PHASE07_REFUSED_HOST: Expected loopback URL, got ${rawBase}`);
  }
  if (parsed.port === "3150") {
    throw new Error(
      `PHASE07_REFUSED_PRIMARY_PORT: Refusing Primary-DB preview port 3150 (${rawBase}). Target an isolated scratch server.`,
    );
  }
  const dbUrl =
    process.env.PHASE07_DATABASE_URL ??
    process.env.SCRATCH_DATABASE_URL ??
    "";
  if (dbUrl.trim() === "") {
    throw new Error(
      "PHASE07_MISSING_DB_IDENTITY: Set PHASE07_DATABASE_URL (or SCRATCH_DATABASE_URL) to prove the target database is not Primary DB.",
    );
  }
  return { baseUrl: parsed.origin, databaseUrl: dbUrl };
}

const { baseUrl: BASE, databaseUrl: SCRATCH_DB_URL } = resolveIsolatedTarget();
const TOKEN_KEY = "hyper_cart_guest_token";

test.use({ baseURL: BASE });

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

const piece: { product: CardProduct | null; variant: VariantRow | null } = { product: null, variant: null };
const weightPerKg: { product: CardProduct | null; variant: VariantRow | null } = { product: null, variant: null };
const weightUnsupported: { product: CardProduct | null; variant: VariantRow | null } = { product: null, variant: null };
const cleanupTokens: string[] = [];
let apiCtx: APIRequestContext | null = null;

async function readJson<T>(ctx: APIRequestContext, url: string): Promise<T | null> {
  const res = await ctx.get(url);
  if (!res.ok()) return null;
  const body = (await res.json()) as { data: T };
  return body.data;
}

test.beforeAll(async ({ playwright }) => {
  // 1) Verify direct Postgres database identity is isolated (never Primary DB `hyper_almoatasem`).
  const db = new Client({ connectionString: SCRATCH_DB_URL, connectionTimeoutMillis: 8000 });
  await db.connect();
  let isolatedDbName = "";
  let scratchTopPieceId: string | null = null;
  try {
    const dbRes = await db.query<{ db: string }>("SELECT current_database() AS db");
    isolatedDbName = dbRes.rows[0]?.db ?? "";
    if (!isolatedDbName || isolatedDbName === "hyper_almoatasem") {
      throw new Error(
        `PHASE07_UNSAFE_DATABASE: Refusing write-capable card/cart E2E against Primary database "${isolatedDbName}".`,
      );
    }
    const allowedDb = /(scratch|p07|p09|p10|closure|test)/i.test(isolatedDbName);
    if (!allowedDb) {
      throw new Error(
        `PHASE07_UNALLOWLISTED_DATABASE: Refusing write-capable E2E against non-isolated database "${isolatedDbName}".`,
      );
    }
    const topPieceRes = await db.query<{ id: string }>(
      `SELECT p.id::text AS id
       FROM products p
       WHERE p.product_type = 'PIECE'
         AND p.is_active = true
         AND p.deleted_at IS NULL
         AND EXISTS (
           SELECT 1 FROM product_variants v
           WHERE v.product_id = p.id AND v.is_active = true AND v.deleted_at IS NULL
         )
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT 1`,
    );
    scratchTopPieceId = topPieceRes.rows[0]?.id ?? null;
  } finally {
    await db.end();
  }

  // 2) Verify target HTTP server is healthy and bound to that verified isolated database.
  apiCtx = await playwright.request.newContext({ baseURL: BASE });
  let healthOk = false;
  try {
    const healthRes = await apiCtx.get("/api/health");
    healthOk = healthRes.ok();
  } catch (err) {
    throw new Error(
      `PHASE07_SERVER_UNAVAILABLE: Target server at ${BASE} is unreachable (${err instanceof Error ? err.message : String(err)}).`,
    );
  }
  if (!healthOk) {
    throw new Error(`PHASE07_SERVER_UNHEALTHY: ${BASE}/api/health did not return HTTP 2xx.`);
  }

  const piecePage = await readJson<CardProduct[]>(apiCtx, "/api/store/catalog/products?type=PIECE&limit=20");
  if (!piecePage || piecePage.length === 0) {
    throw new Error(
      `PHASE07_EMPTY_CATALOG: ${BASE}/api/store/catalog/products?type=PIECE returned 0 rows (db=${isolatedDbName}). Refusing silent skip.`,
    );
  }
  if (scratchTopPieceId && piecePage[0]?.id !== scratchTopPieceId) {
    throw new Error(
      `PHASE07_SERVER_DB_MISMATCH: HTTP ${BASE} returned top PIECE id=${piecePage[0]?.id}, expected id=${scratchTopPieceId} from DB "${isolatedDbName}". Target server may be connected to another database!`,
    );
  }

  {
    const product = piecePage[0]!;
    const variants = await readJson<VariantRow[]>(
      apiCtx,
      `/api/store/catalog/products/${product.id}/variants`,
    );
    const sellable = variants?.filter((v) => v.isActive) ?? [];
    if (variants && sellable.length > 0) {
      piece.product = product;
      piece.variant = sellable[0] ?? null;
    }
  }
  const weightPage = await readJson<CardProduct[]>(
    apiCtx,
    "/api/store/catalog/products?type=WEIGHT&limit=20",
  );
  if (weightPage) {
    for (const product of weightPage) {
      const variants = await readJson<VariantRow[]>(
        apiCtx,
        `/api/store/catalog/products/${product.id}/variants`,
      );
      const sellable = variants?.filter((v) => v.isActive) ?? [];
      const first = sellable[0];
      if (!first) continue;
      if (first.sizeUnit === "KG" && weightPerKg.product === null) {
        weightPerKg.product = product;
        weightPerKg.variant = first;
      }
      if (first.sizeUnit !== "KG" && weightUnsupported.product === null) {
        weightUnsupported.product = product;
        weightUnsupported.variant = first;
      }
    }
  }
  if (!piece.product || !piece.variant) {
    throw new Error("PHASE07_PRECONDITION_FAILED: No sellable PIECE product found in isolated DB.");
  }
  if (!weightPerKg.product || !weightPerKg.variant) {
    throw new Error("PHASE07_PRECONDITION_FAILED: No sellable WEIGHT/KG product found in isolated DB.");
  }
});

test.afterAll(async () => {
  // Cleanup verification (via the app's own API only): every token this suite
  // used must now hold an EMPTY active cart — zero line rows created by tests.
  if (apiCtx) {
    for (const token of cleanupTokens) {
      const res = await apiCtx.get("/api/store/cart", { headers: { "x-guest-token": token } });
      if (res.ok()) {
        const body = (await res.json()) as { data: { cart: { lines: unknown[] } } };
        expect(body.data.cart.lines).toEqual([]);
      }
      // A NOT_FOUND here means the cart сам vanished (expiry) — also acceptable.
    }
    await apiCtx.dispose();
  }
});

/** Clear THIS page's guest cart lines through the app's own API (cleanup). */
async function clearGuestCart(page: Page): Promise<void> {
  const token = await page.evaluate((key) => window.localStorage.getItem(key), TOKEN_KEY);
  if (!token) return;
  cleanupTokens.push(token);
  const res = await page.request.delete(BASE + "/api/store/cart/items", {
    headers: { "x-guest-token": token },
  });
  if (res.ok()) {
    const body = (await res.json()) as { data: { cart: { lines: unknown[] } } };
    expect(body.data.cart.lines).toEqual([]);
  }
}

function cardFor(page: Page, productId: string, productName: string) {
  return page
    .locator("article")
    .filter({ has: page.locator(`a[href^="/p/${productId}"]`) })
    .filter({ has: page.getByRole("heading", { name: productName }) });
}

function listingUrl(product: CardProduct): string {
  return `/c/${product.category.id}/${encodeURIComponent(product.category.slug)}`;
}

// === T1: card add → server-quantity stepper → + / − per contract → DELETE at 1 ===
test("PIECE card: add one pack, then stepper parity (+ aggregate / − absolute / − at 1 removes)", async ({
  page,
}) => {
  expect(piece.product).not.toBeNull();
  expect(piece.variant).not.toBeNull();
  const product = piece.product!;
  await page.goto(listingUrl(product));
  const card = cardFor(page, product.id, product.name);
  const add = card.getByRole("button", { name: "أضف إلى السلة" });
  await expect(add).toBeVisible({ timeout: 60000 });

  // 1) add one pack → the stepper appears with the SERVER quantity text.
  await add.click();
  const reduce = card.getByRole("button", { name: "تقليل الكمية" });
  const increase = card.getByRole("button", { name: "زيادة الكمية" });
  await expect(card.getByText(/في السلة:/)).toHaveText(/1/, { timeout: 60000 });

  // 2) "+" = POST aggregate quantity "1" — the server's number becomes 2.
  await increase.click();
  await expect(card.getByText(/في السلة:/)).toHaveText(/2/, { timeout: 60000 });

  // 3) "−" at 2 = PATCH absolute "1" — reaching 1, never a 0 patch.
  await reduce.click();
  await expect(card.getByText(/في السلة:/)).toHaveText(/1/, { timeout: 60000 });

  // 4) "−" at 1 = DELETE — the add button returns with the honest removal note.
  await reduce.click();
  await expect(add).toBeVisible({ timeout: 60000 });
  await expect(card.getByRole("status").last()).toHaveText(/أُزيل من السلة/, { timeout: 60000 });

  await clearGuestCart(page);
});

// T1b: the − path never sends PATCH 0 (server contract rejects it).
test("PIECE card: reaching zero goes through DELETE, never a PATCH 0", async ({ page }) => {
  expect(piece.product).not.toBeNull();
  expect(piece.variant).not.toBeNull();
  const product = piece.product!;
  await page.goto(listingUrl(product));
  const card = cardFor(page, product.id, product.name);
  const add = card.getByRole("button", { name: "أضف إلى السلة" });
  await expect(add).toBeVisible({ timeout: 60000 });

  const seen: string[] = [];
  await page.route("**/api/store/cart/items/**", async (route) => {
    const req = route.request();
    if (req.method() === "PATCH") {
      const body = req.postDataJSON() as { quantity?: string } | null;
      if (body && typeof body.quantity === "string") seen.push(body.quantity);
    }
    await route.continue();
  });

  await add.click();
  const reduce = card.getByRole("button", { name: "تقليل الكمية" });
  await expect(card.getByText(/في السلة:/)).toHaveText(/1/, { timeout: 60000 });
  await reduce.click();
  await expect(add).toBeVisible({ timeout: 60000 });
  expect(seen).toEqual([]); // zero quantity is never PATCHed — DELETE owns removal

  await clearGuestCart(page);
});

// === T2: PDP add → card parity (one shared truth across surfaces) ===
test("PIECE PDP add 2 packs → the listing card reflects the same confirmed quantity", async ({ page }) => {
  expect(piece.product).not.toBeNull();
  expect(piece.variant).not.toBeNull();
  const product = piece.product!;
  const pdpUrl = `/p/${product.id}/${encodeURIComponent(product.slug)}`;
  await page.goto(pdpUrl);
  await expect(page.getByRole("button", { name: "أضف إلى السلة" })).toBeVisible({ timeout: 60000 });

  // The panel's quantity input defaults to whole packs; set 2 packs, add.
  const packsInput = page.getByLabel(/^الكمية/);
  await expect(packsInput).toHaveValue("1", { timeout: 60000 });
  await packsInput.fill("2");
  await page.getByRole("button", { name: "أضف إلى السلة" }).click();
  await expect(page.getByText("تمت الإضافة إلى السلة.", { exact: false })).toBeVisible({ timeout: 60000 });

  // Parity: back to the listing — the card shows the SERVER quantity (2).
  await page.goto(listingUrl(product));
  const card = cardFor(page, product.id, product.name);
  await expect(card.getByText(/في السلة:/)).toHaveText(/2/, { timeout: 60000 });

  await clearGuestCart(page);
});

// === T3: cart page parity (card ⇄ /cart) ===
test("card add → /cart shows the line → cart edit reflects back on the card", async ({ page }) => {
  expect(piece.product).not.toBeNull();
  expect(piece.variant).not.toBeNull();
  const product = piece.product!;
  await page.goto(listingUrl(product));
  const card = cardFor(page, product.id, product.name);
  const add = card.getByRole("button", { name: "أضف إلى السلة" });
  await expect(add).toBeVisible({ timeout: 60000 });
  await add.click();
  await expect(card.getByText(/في السلة:/)).toHaveText(/1/, { timeout: 60000 });

  await page.goto("/cart");
  const line = page.locator("li").filter({ has: page.getByText(product.name, { exact: false }) });
  await expect(line).toBeVisible({ timeout: 60000 });
  await expect(line.locator("input[id^='qty-']")).toHaveValue(/1/, { timeout: 60000 });

  // Cart-page edit (absolute set 2) — then the card (fresh probe) agrees.
  await line.locator("input[id^='qty-']").fill("2");
  await line.locator("input[id^='qty-']").blur();
  await expect(line.locator("input[id^='qty-']")).toHaveValue(/2/, { timeout: 60000 });

  await page.goto(listingUrl(product));
  const card2 = cardFor(page, product.id, product.name);
  await expect(card2.getByText(/في السلة:/)).toHaveText(/2/, { timeout: 60000 });

  await clearGuestCart(page);
});

// === T4: rapid double tap while inflight = exactly ONE add request ===
test("rapid double tap on the card add sends ONE cart POST (guard in logic, not cosmetics)", async ({ page }) => {
  expect(piece.product).not.toBeNull();
  expect(piece.variant).not.toBeNull();
  const product = piece.product!;
  await page.goto(listingUrl(product));
  const card = cardFor(page, product.id, product.name);
  const add = card.getByRole("button", { name: "أضف إلى السلة" });
  await expect(add).toBeVisible({ timeout: 60000 });

  // Count only the CONFIRMED add POST (with the guest-token bearer): a fresh
  // visitor goes through the contract's identity ladder first (a rejected
  // identityless POST → mint → retried POST with the token) — the documentd
  // ladder contract, not a duplicate line add.
  let tokenPostCount = 0;
  await page.route("**/api/store/cart/items", async (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      const header = (await req.headerValue("x-guest-token")) ?? null;
      if (header) tokenPostCount += 1;
    }
    await route.continue();
  });

  // A genuine pre-commit duplicate tap: THREE synchronous clicks in ONE task —
  // React has no chance to disable the button between them, so only the store's
  // per-line logic guard can stop the duplicate ops (Playwright .click() with
  // force can't reproduce this: it re-resolves the locator and hangs once the
  // pending label replaced the button text).
  await add.evaluate((el: HTMLElement) => {
    el.click();
    el.click();
    el.click();
  });

  await expect(card.getByText(/في السلة:/)).toHaveText(/1/, { timeout: 60000 });
  expect(tokenPostCount).toBe(1); // ONE confirmed aggregate — never two/three
  expect(await card.getByRole("button", { name: "تقليل الكمية" }).isVisible()).toBe(true);

  await clearGuestCart(page);
});

// === T5: failure (transport uncertainty + definite contract refusal) keeps confirmed truth; manual retry recovers ===
test("stepper step failure keeps the server quantity; retry then succeeds", async ({ page }) => {
  expect(piece.product).not.toBeNull();
  expect(piece.variant).not.toBeNull();
  const product = piece.product!;
  await page.goto(listingUrl(product));
  const card = cardFor(page, product.id, product.name);
  const add = card.getByRole("button", { name: "أضف إلى السلة" });
  await expect(add).toBeVisible({ timeout: 60000 });
  await add.click();
  await expect(card.getByText(/في السلة:/)).toHaveText(/1/, { timeout: 60000 });

  // 1) Network drop (P09 §6 uncertain outcome): client cannot tell if POST landed,
  //    must show uncertain verification warning and preserve last confirmed truth (1).
  let mode: "abort" | "conflict" | "ok" = "abort";
  await page.route("**/api/store/cart/items", async (route) => {
    if (route.request().method() === "POST") {
      if (mode === "abort") {
        await route.abort("connectionrefused");
        return;
      }
      if (mode === "conflict") {
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: { code: "CONFLICT", message: "تعارض في السلة." } }),
        });
        return;
      }
    }
    await route.continue();
  });

  await card.getByRole("button", { name: "زيادة الكمية" }).click();
  await expect(card.getByRole("alert")).toHaveText(/تعذّر التأكد من نتيجة العملية/, { timeout: 60000 });
  await expect(card.getByText(/في السلة:/)).toHaveText(/1/, { timeout: 60000 });

  // 2) Definite parsed contract rejection (409 CONFLICT): client knows mutation was rejected,
  //    shows definite step error and keeps server quantity (1).
  mode = "conflict";
  await card.getByRole("button", { name: "زيادة الكمية" }).click();
  await expect(card.getByRole("alert")).toHaveText(/تعذّرت زيادة الكمية/, { timeout: 60000 });
  await expect(card.getByText(/في السلة:/)).toHaveText(/1/, { timeout: 60000 });

  // 3) Recover: manual retry through the same control reaches confirmed quantity 2.
  mode = "ok";
  await card.getByRole("button", { name: "زيادة الكمية" }).click();
  await expect(card.getByText(/في السلة:/)).toHaveText(/2/, { timeout: 60000 });

  await clearGuestCart(page);
});

// === T6: WEIGHT card — no island on the card; PDP owns the weight draft ===
test("WEIGHT card shows per-kg price without an island; PDP preset draft follows the sale step", async ({
  page,
}) => {
  expect(weightPerKg.product).not.toBeNull();
  expect(weightPerKg.variant).not.toBeNull();
  const product = weightPerKg.product!;
  await page.goto(listingUrl(product));
  const card = cardFor(page, product.id, product.name);
  await expect(card.getByText(/ج\.م/)).toBeVisible({ timeout: 60000 });
  // Price basis: per kilogram — "/ كجم" present on the card price.
  await expect(card.getByText(/\/\s*كجم/)).toBeVisible({ timeout: 60000 });
  // No card island at all for WEIGHT (weights are chosen on the PDP).
  await expect(card.getByRole("button", { name: "أضف إلى السلة" })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "زيادة الكمية" })).toHaveCount(0);

  // PDP: presets generated from sale_step_grams (125 g by data reality) and the
  // draft never leaves the panel unless it is a valid step.
  await page.goto(`/p/${product.id}/${encodeURIComponent(product.slug)}`);
  await expect(page.getByRole("group", { name: "أوزان جاهزة" })).toBeVisible({ timeout: 60000 });
  await expect(page.getByRole("button", { name: "250 جم" })).toBeVisible({ timeout: 60000 });

  // Track POSTs; an INVALID draft must send NOTHING.
  let postCount = 0;
  await page.route("**/api/store/cart/items", (route) => {
    if (route.request().method() === "POST") postCount += 1;
    return route.continue();
  });
  await page.locator("input[inputmode='decimal']").fill("1.3");
  // The valid-request listener is registered BEFORE the send (no race).
  const itemsReq = page.waitForRequest(
    (req) => req.url().includes("/api/store/cart/items") && req.method() === "POST",
    { timeout: 60000 },
  );
  await page.getByRole("button", { name: "أضف إلى السلة" }).click();
  // Scope to THIS panel's alert — the PDP can carry other alerts.
  await expect(
    page.getByRole("alert").filter({ hasText: /اختر وزنًا صالحًا وفق خطوة البيع/ }),
  ).toBeVisible({ timeout: 60000 });
  expect(postCount).toBe(0); // invalid draft stays a local draft — never a request

  // A valid preset sends exactly one request with the kilogram-fraction quantity.
  await page.getByRole("button", { name: "250 جم" }).click();
  const addPromise = page.getByRole("button", { name: "أضف إلى السلة" }).click();
  const sent = await itemsReq.catch(() => null);
  await addPromise.catch(() => undefined);
  expect(sent).not.toBeNull();
  expect(postCount).toBe(1);
  const body = sent!.postDataJSON() as { quantity?: string };
  // Gram-equivalence, not string-format equality (250 g ⇒ 0.25 by the panel's
  // helper; NUMERIC(12,3) accepts both notations).
  expect(Number(body.quantity) * 1000).toBe(250);

  await clearGuestCart(page);
});

// === T7: availability chip stays "unknown" (no inventory data) + honest image fallback ===
test("PIECE card: unknown availability chip + بلا صورة fallback (data reality)", async ({ page }) => {
  expect(piece.product).not.toBeNull();
  const product = piece.product!;
  await page.goto(listingUrl(product));
  const card = cardFor(page, product.id, product.name);
  // Inventory has no rows in this environment: the chip must stay UNKNOWN,
  // never converted into a claim ("متوفر"/"غير متوفر").
  await expect(card.getByText("التوفر غير محدد حاليًا")).toBeVisible({ timeout: 60000 });
  // No image columns exist: the card renders the honest بلا صورة fallback.
  await expect(card.locator("img")).toHaveCount(0);
  await expect(card.getByText("بلا صورة")).toBeVisible();
});



