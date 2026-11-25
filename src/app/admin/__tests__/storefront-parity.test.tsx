// ADM-03: real catalog/search/serialization/enrichment/card code over an in-memory
// DB boundary. No connection, session, network, mutation, or SQL script is run.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";

const db = vi.hoisted(() => ({
  products: vi.fn(), count: vi.fn(), categories: vi.fn(), brands: vi.fn(), variants: vi.fn(),
  raw: vi.fn(), unsafe: vi.fn(), execute: vi.fn(), inventory: vi.fn(), auth: vi.fn(), purchase: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: {
  product: { findMany: db.products, count: db.count },
  category: { findMany: db.categories }, brand: { findMany: db.brands },
  productVariant: { findMany: db.variants }, inventory: { findFirst: db.inventory },
  $queryRaw: db.raw,
  $transaction: async (fn: (tx: unknown) => unknown) => fn({ $queryRawUnsafe: db.unsafe, $executeRawUnsafe: db.execute }),
} }));
vi.mock("@/lib/auth/rbac", () => ({ requirePermission: db.auth }));
vi.mock("@/lib/api/audit", () => ({ auditInTx: () => { throw new Error("No writes permitted in parity fixtures"); } }));
vi.mock("next/link", () => ({ default: ({ href, prefetch, ...props }: ComponentProps<"a"> & { prefetch?: boolean }) => { void prefetch; return <a href={href} {...props} />; } }));
vi.mock("@/components/store/card-buy", () => ({ CardBuy: (props: unknown) => { db.purchase(props); return <button>شراء الاختبار</button>; } }));

import AdminPage from "@/app/admin/products/storefront/page";
import { readAdminStorefrontCatalog } from "@/lib/admin/storefront-catalog";
import { enrichCards, getHomeCategorySections, listCategoryProducts, listBrandProducts, searchCatalogPaged } from "@/lib/frontend/storefront-reads";
import { parseListingParams } from "@/lib/frontend/listing-params";
import { ProductCard } from "@/components/store/product-card";
import { encodeCursor } from "@/lib/api/pagination";
import { encodeSearchCursor } from "@/lib/catalog/search";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const date = new Date("2026-11-01T00:00:00Z");
const category = (n: number, name: string, sortOrder: number, parentId: string | null = null, isActive = true) => ({
  id: id(n), name, slug: `c-${n}`, sortOrder, parentId, isActive, deletedAt: null,
  description: null, image: null, createdAt: date, updatedAt: date,
});
const CATEGORIES = [category(200, "أخرى", 20), category(102, "أ فرعي", 5, id(100)),
  category(100, "ي رئيسي", 1), category(101, "ي فرعي", 3, id(100)),
  category(103, "حفيد", 7, id(101)), category(300, "مخفي", 0, null, false)];
const BRAND = { id: id(400), name: "ماركة", slug: "brand", logo: null, isActive: true, deletedAt: null, createdAt: date, updatedAt: date };
const PRODUCTS = Array.from({ length: 29 }, (_, index) => {
  const n = index + 1;
  return { id: id(n), name: `متجر ${String(Math.ceil(n / 2)).padStart(2, "0")}`, slug: `منتج-${n}`,
    productType: n % 2 ? "PIECE" : "WEIGHT", unit: n % 2 ? "PIECE" : "KG", saleStepGrams: n % 2 ? null : 250,
    isActive: n !== 27, deletedAt: n === 28 ? date : null,
    categoryId: id(n === 29 ? 200 : n % 3 === 0 ? 103 : n % 2 ? 101 : 102), brandId: BRAND.id,
    category: CATEGORIES.find(c => c.id === id(n === 29 ? 200 : n % 3 === 0 ? 103 : n % 2 ? 101 : 102))!, brand: BRAND,
    createdAt: new Date(date.getTime() + Math.floor(n / 3) * 86400000), updatedAt: date,
  };
});
const VARIANTS = PRODUCTS.filter(p => p.id !== id(26)).flatMap((p, index) => [
  { id: id(1000 + index * 3), productId: p.id, name: "أول", price: index === 0 ? "100" : "66",
    compareAtPrice: "90", sizeValue: "125", sizeUnit: p.productType === "WEIGHT" ? "KG" : "GRAM",
    isActive: true, deletedAt: null, costPrice: "98765" },
  { id: id(1001 + index * 3), productId: p.id, name: "ثان", price: "10", compareAtPrice: null,
    sizeValue: "50", sizeUnit: "GRAM", isActive: true, deletedAt: null, costPrice: "98765" },
  { id: id(1002 + index * 3), productId: p.id, name: "أسبق مخفي", price: "1", compareAtPrice: null,
    sizeValue: null, sizeUnit: null, isActive: false, deletedAt: null, costPrice: "98765" },
  // Same active name, larger id: must not replace the authoritative first.
  { id: id(9000 + index), productId: p.id, name: "أول", price: "20", compareAtPrice: null,
    sizeValue: "50", sizeUnit: "GRAM", isActive: true, deletedAt: null, costPrice: "98765" },
]);
const IMAGES = PRODUCTS.filter(p => p.id !== id(26)).flatMap(p => [
  { id: `${p.id}-a`, productId: p.id, url: `https://images.test/${p.id}/fallback.jpg`, isPrimary: false, sortOrder: 0 },
  { id: `${p.id}-b`, productId: p.id, url: `https://images.test/${p.id}/primary.jpg`, isPrimary: p.id !== id(25), sortOrder: p.id === id(25) ? 0 : 99 },
]);
const permissions = ["products.view", "products.update", "prices.view", "inventory.view"];
type Where = Record<string, unknown>;
const comparable = (value: unknown): string | number => value instanceof Date ? value.getTime() : typeof value === "number" ? value : String(value);
function matches(row: unknown, where: Where): boolean {
  if (row === null || row === undefined) return false;
  const r = row as Where;
  return Object.entries(where).every(([key, value]) => {
    if (key === "AND") return (Array.isArray(value) ? value : [value]).every(w => matches(row, w as Where));
    if (key === "OR") return (value as Where[]).some(w => matches(row, w));
    if (key === "NOT") return !matches(row, value as Where);
    if (key === "variants") return VARIANTS.some(v => v.productId === r.id && matches(v, (value as { some: Where }).some));
    if (key === "inventory") {
      const n = PRODUCTS.findIndex(p => p.id === r.productId) + 1;
      return n % 3 !== 0 && matches({ availableQuantity: n % 3 === 1 ? 5 : 0 }, value as Where);
    }
    if (value === null || typeof value !== "object" || value instanceof Date) return comparable(r[key]) === comparable(value);
    const v = value as Where;
    return Object.entries(v).every(([op, operand]) => {
      if (op === "mode") return true;
      if (op === "in") return (operand as unknown[]).includes(r[key]);
      if (op === "contains") return String(r[key]).includes(String(operand));
      const a = comparable(r[key]), b = comparable(operand);
      if (op === "gt") return a > b;
      if (op === "lt") return a < b;
      if (op === "gte") return Number(a) >= Number(b);
      if (op === "lte") return Number(a) <= Number(b);
      throw new Error(`Unhandled fixture operator ${op}`);
    });
  });
}
function ordered<T extends object>(rows: T[], order: Where[]): T[] {
  return [...rows].sort((a, b) => {
    for (const o of order) {
      const [key, dir] = Object.entries(o)[0];
      const x = comparable((a as Where)[key]), y = comparable((b as Where)[key]);
      if (x !== y) return (x < y ? -1 : 1) * (dir === "asc" ? 1 : -1);
    }
    return 0;
  });
}
function descendants(root: string): string[] {
  if (!CATEGORIES.some(c => c.id === root && c.isActive)) return [];
  const result = [root];
  for (let i = 0; i < result.length; i++) result.push(...CATEGORIES.filter(c => c.parentId === result[i] && c.isActive).map(c => c.id));
  return result;
}
async function rawRead(parts: TemplateStringsArray, ...values: unknown[]) {
  const sql = parts.join("?");
  const ids = Array.isArray(values[0]) ? values[0] as string[] : [String(values[0])];
  if (sql.includes("WITH RECURSIVE sub")) return descendants(String(values[0])).map(id => ({ id }));
  if (sql.includes("FROM product_images")) {
    expect(sql).toContain("is_primary DESC, sort_order ASC, id ASC");
    return ids.flatMap(pid => ordered(IMAGES.filter(i => i.productId === pid), [{ isPrimary: "desc" }, { sortOrder: "asc" }, { id: "asc" }]).slice(0, 1));
  }
  if (sql.includes("FROM inventory i")) return ids.filter(pid => VARIANTS.some(v => v.productId === pid) && (PRODUCTS.findIndex(p => p.id === pid) + 1) % 3 !== 0).map(product_id => ({ product_id }));
  if (sql.includes("FROM product_stock_status")) return ids.map(pid => ({ product_id: pid,
    sellable_variants: BigInt(VARIANTS.filter(v => v.productId === pid && v.isActive).length),
    known_sellable_balances: (PRODUCTS.findIndex(p => p.id === pid) + 1) % 3 === 0 ? BigInt(0) : BigInt(VARIANTS.filter(v => v.productId === pid && v.isActive).length),
    in_stock_variants: (PRODUCTS.findIndex(p => p.id === pid) + 1) % 3 === 1 ? BigInt(1) : BigInt(0),
    is_in_stock: (PRODUCTS.findIndex(p => p.id === pid) + 1) % 3 === 1 }));
  throw new Error(`Unrecognized read-only fixture SQL: ${sql}`);
}
function searchRead(sql: string, ...params: unknown[]) {
  expect(sql).toContain("WITH cands(pid, tier, sim) AS");
  expect(sql).toContain("pc.code = $1");
  const where: Where = { isActive: true, deletedAt: null };
  const bound = (regex: RegExp) => { const m = sql.match(regex); return m ? params[Number(m[1]) - 1] : null; };
  const categoryIds = bound(/p.category_id = ANY\(\$(\d+)/);
  if (categoryIds) where.categoryId = { in: categoryIds };
  const brandId = bound(/p.brand_id = \$(\d+)/); if (brandId) where.brandId = brandId;
  const type = bound(/p.product_type = \$(\d+)/); if (type) where.productType = type;
  const min = bound(/v.price >= \$(\d+)/), max = bound(/v.price <= \$(\d+)/);
  if (min || max) where.AND = [{ variants: { some: { isActive: true, deletedAt: null, price: { ...(min ? { gte: min } : {}), ...(max ? { lte: max } : {}) } } } }];
  const positive = { variants: { some: { isActive: true, deletedAt: null, inventory: { availableQuantity: { gt: 0 } } } } };
  if (sql.includes("i.available_quantity > 0")) Object.assign(where, sql.includes("NOT EXISTS") ? { NOT: positive } : positive);
  let rows = PRODUCTS.filter(p => p.name.includes(String(params[0])) && matches(p, where));
  if (sql.includes("COUNT(DISTINCT p.id)")) return [{ total: BigInt(rows.length) }];
  const at = bound(/p.created_at < \$(\d+)/), cursorId = bound(/p.id > \$(\d+)::uuid/);
  if (at) rows = rows.filter(p => p.createdAt < new Date(String(at)) || (+p.createdAt === +new Date(String(at)) && p.id > String(cursorId)));
  const rankId = bound(/r.id > \$(\d+)::uuid/);
  if (rankId) rows = rows.filter(p => p.id > String(rankId));
  rows = ordered(rows, sql.includes("ORDER BY p.created_at") ? [{ createdAt: "desc" }, { id: "asc" }] : [{ id: "asc" }]);
  const limit = Number(bound(/LIMIT \$(\d+)/));
  return rows.slice(0, limit).map(p => ({ ...p, product_type: p.productType, sale_step_grams: p.saleStepGrams, is_active: p.isActive,
    created_at: p.createdAt, cid: p.category.id, cname: p.category.name, cslug: p.category.slug,
    bid: BRAND.id, bname: BRAND.name, bslug: BRAND.slug, tier: 2, sim: 0.75 }));
}
const paramsOf = (href: string) => Object.fromEntries(new URL(href, "https://admin.test").searchParams);

beforeEach(() => {
  vi.resetAllMocks();
  db.auth.mockResolvedValue({ permissions });
  db.inventory.mockResolvedValue({ id: "inventory-fixture" });
  db.products.mockImplementation(({ where, orderBy, take }) => ordered(PRODUCTS.filter(p => matches(p, where)), orderBy).slice(0, take));
  db.count.mockImplementation(({ where }) => PRODUCTS.filter(p => matches(p, where)).length);
  db.categories.mockImplementation(({ where, orderBy, take }) => ordered(CATEGORIES.filter(c => matches(c, where)), orderBy).slice(0, take));
  db.brands.mockResolvedValue([BRAND]);
  db.variants.mockImplementation(({ where, orderBy }) => ordered(VARIANTS.filter(v => matches(v, where)), orderBy));
  db.raw.mockImplementation(rawRead);
  db.unsafe.mockImplementation(searchRead);
  db.execute.mockImplementation((sql: string) => { expect(sql).toMatch(/^SET LOCAL pg_trgm.similarity_threshold = 0.2$/); return 0; });
});

describe("ADM-03 genuine storefront/admin read and card parity", () => {
  it.each([ ["name", "asc"], ["name", "desc"], ["created_at", "asc"], ["created_at", "desc"] ] as const)(
    "%s %s uses identical subtree/IDs, shape, variant, image, sort and 12-item keyset", async (sort, dir) => {
      const raw = { category: id(100), brand: BRAND.id, sort, dir };
      const query = parseListingParams(raw, "listing");
      const store = await listCategoryProducts(id(100), query);
      const storeRead = db.products.mock.calls.at(-1)![0];
      const expectedOrder = [{ [sort === "name" ? "name" : "createdAt"]: dir }, { id: dir }];
      expect(storeRead.orderBy).toEqual(expectedOrder);
      expect(storeRead.where).toMatchObject({ isActive: true, deletedAt: null, categoryId: { in: descendants(id(100)) }, brandId: BRAND.id });
      const admin = await readAdminStorefrontCatalog(Promise.resolve(raw));
      expect(admin.page).toEqual(store);
      expect(db.products.mock.calls.at(-1)![0]).toEqual(storeRead);
      expect(store.cards).toHaveLength(12);
      expect(admin.total).toBe(26); // not page length
      const store2 = await listCategoryProducts(id(100), query, store.nextCursor);
      const admin2 = await readAdminStorefrontCatalog(Promise.resolve(paramsOf(admin.nextHref!)));
      expect(admin2.page).toEqual(store2);
      const admin3 = await readAdminStorefrontCatalog(Promise.resolve(paramsOf(admin2.nextHref!)));
      const all = [...store.cards, ...store2.cards, ...admin3.page!.cards].map(c => c.id);
      const expected = ordered(PRODUCTS.filter(p => p.isActive && p.deletedAt === null && descendants(id(100)).includes(p.categoryId)), expectedOrder).map(p => p.id);
      expect(all).toEqual(expected);
      expect(all).toHaveLength(26);
      expect(new Set(all).size).toBe(26);
      expect(all).not.toContain(id(27)); expect(all).not.toContain(id(28)); expect(all).not.toContain(id(29));
      expect(admin3.nextHref).toBeNull();
      const card = [...store.cards, ...store2.cards, ...admin3.page!.cards].find(c => c.id === id(2))!;
      expect(card).toMatchObject({ price: "66", compareAt: "90", sizeValue: "125", sizeUnit: "KG", productType: "WEIGHT", saleStepGrams: 250, stock: "oos", brandName: BRAND.name, image: `https://images.test/${id(2)}/primary.jpg` });
      expect(JSON.stringify(admin.page)).not.toMatch(/costPrice|98765/);
    },
  );

  it("uses first active variant name/id rather than cheapest, and the same price basis card without purchase", async () => {
    const data = await readAdminStorefrontCatalog(Promise.resolve({ category: id(100), sort: "name", dir: "asc" }));
    const piece = data.page!.cards.find(c => c.id === id(1))!;
    expect(piece.price).toBe("100"); // cheaper active variant is 10, hidden variant is 1
    const { unmount, container } = render(<ProductCard product={piece} />);
    expect(screen.getByRole("button", { name: "شراء الاختبار" })).toBeInTheDocument();
    expect(container.textContent).toContain("100 ج.م"); expect(container.textContent).not.toContain("/ كجم");
    expect(container.querySelectorAll('a[href^="/admin/"]')).toHaveLength(0);
    const publicText = container.querySelector("article")!.textContent!.replace("شراء الاختبار", "");
    unmount(); db.purchase.mockClear();
    render(<ProductCard product={piece} showPurchase={false} />);
    expect(screen.queryByRole("button", { name: "شراء الاختبار" })).not.toBeInTheDocument();
    expect(db.purchase).not.toHaveBeenCalled();
    expect(screen.getByRole("article").textContent).toBe(publicText);
  });

  it.each(["newest", "relevance"] as const)("search %s has the same query/filter/SQL, shaped cards and cursor pages", async sort => {
    const raw = { q: "متجر", sort, category: id(100), brand: BRAND.id, minPrice: "40", maxPrice: "80", inStock: "false" };
    const query = parseListingParams(raw, "search");
    const store = await searchCatalogPaged(raw.q, query);
    const storeSql = db.unsafe.mock.calls.at(-1);
    const admin = await readAdminStorefrontCatalog(Promise.resolve(raw));
    expect(admin.page).toEqual(store);
    expect(db.unsafe.mock.calls.at(-1)).toEqual(storeSql);
    expect(admin.page!.cards.some(c => c.id === id(1))).toBe(false); // [10,100] cannot match [40,80]
    expect(admin.page!.cards.some(c => c.stock === "unknown")).toBe(true);
    expect(admin.page!.cards.every(c => c.stock !== "in")).toBe(true);
    const persisted = paramsOf(admin.nextHref ?? admin.startHref);
    expect({ ...persisted, sort: parseListingParams(persisted, "search").sort }).toMatchObject(raw);
    if (store.nextCursor) {
      const nextStore = await searchCatalogPaged(raw.q, query, store.nextCursor);
      const nextAdmin = await readAdminStorefrontCatalog(Promise.resolve(paramsOf(admin.nextHref!)));
      expect(nextAdmin.page).toEqual(nextStore);
      expect(new Set([...store.cards, ...nextStore.cards].map(c => c.id)).size).toBe(store.cards.length + nextStore.cards.length);
    }
  });

  it("brand listing and combined price + positive inventory gates match, and count shares the full where", async () => {
    const raw = { brand: BRAND.id, category: id(100), type: "WEIGHT", minPrice: "40", maxPrice: "80", inStock: "true" };
    const store = await listBrandProducts(BRAND.id, parseListingParams(raw, "listing"));
    const data = await readAdminStorefrontCatalog(Promise.resolve(raw));
    expect(data.page).toEqual(store);
    const where = db.products.mock.calls.at(-1)![0].where;
    expect(where.AND[0].variants.some.price).toEqual({ gte: "40", lte: "80" });
    expect(where.variants.some.inventory.availableQuantity).toEqual({ gt: 0 });
    expect(db.count.mock.calls.at(-1)![0].where).toEqual(where);
    expect(data.page!.cards.every(c => c.stock === "in" && c.productType === "WEIGHT")).toBe(true);
  });

  it("navigation uses homepage approved sortOrder, real child groups and active-only categories", async () => {
    const home = await getHomeCategorySections();
    const data = await readAdminStorefrontCatalog(Promise.resolve({}));
    expect(data.sections).toEqual(home);
    expect(home.mains.map(c => c.id)).toEqual([id(100), id(200)]); // opposite name order
    expect(home.subs[0].children.map(c => c.id)).toEqual([id(101), id(102)]);
    render(await AdminPage({ searchParams: Promise.resolve({}) }));
    const nav = within(screen.getByRole("navigation", { name: "أقسام كتالوج المتجر" }));
    expect(nav.getAllByRole("link").map(a => paramsOf(a.getAttribute("href")!).category)).toEqual([id(100), id(200), id(101), id(102)]);
    expect(nav.queryByText("مخفي")).not.toBeInTheDocument();
  });
});

describe("ADM-03 permission boundaries, recovery and honest missing states", () => {
  it("denies products.view before parameter consumption, catalog, navigation, inventory or price reads", async () => {
    db.auth.mockRejectedValue(new Error("FORBIDDEN"));
    const consumed = vi.fn();
    const params = { then: consumed } as unknown as Promise<Record<string, string>>;
    await expect(readAdminStorefrontCatalog(params)).rejects.toThrow("FORBIDDEN");
    expect(db.auth).toHaveBeenCalledWith("products.view");
    for (const fn of [consumed, db.products, db.count, db.categories, db.brands, db.variants, db.inventory, db.raw, db.unsafe]) expect(fn).not.toHaveBeenCalled();
  });

  it.each([false, true])("denied price/stock URL filters cannot change results, counts, validation or protected enrichment (search=%s)", async searching => {
    db.auth.mockResolvedValue({ permissions: ["products.view"] });
    const base = searching ? { q: "متجر" } : {};
    const clean = await readAdminStorefrontCatalog(Promise.resolve(base));
    const crafted = await readAdminStorefrontCatalog(Promise.resolve({ ...base, minPrice: "100", maxPrice: "1", inStock: "true" }));
    expect(crafted.page).toEqual(clean.page); expect(crafted.total).toBe(clean.total); expect(crafted.state).toBe("ready");
    expect(crafted.query).toMatchObject({ minPrice: null, maxPrice: null, inStock: null });
    expect(crafted.startHref).not.toMatch(/minPrice|maxPrice|inStock/);
    expect(db.variants).not.toHaveBeenCalled(); expect(db.inventory).not.toHaveBeenCalled();
    expect(db.raw.mock.calls.every(([parts]) => !parts.join("").match(/FROM inventory|product_stock_status/))).toBe(true);
    for (const c of crafted.page!.cards) expect(c).toMatchObject({ price: null, compareAt: null, sizeValue: null, sizeUnit: null, stock: "unknown", pricesUnavailable: true });
    render(await AdminPage({ searchParams: Promise.resolve({ ...base, minPrice: "100", inStock: "true" }) }));
    expect(screen.queryByLabelText("من سعر")).not.toBeInTheDocument(); expect(screen.queryByLabelText("التوفر")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "تعديل المنتج" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "بحث مخزون المنتج" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "شراء الاختبار" })).not.toBeInTheDocument();
  });

  it.each([
    { grants: ["products.view", "prices.view"], prices: true, inventory: false },
    { grants: ["products.view", "inventory.view"], prices: false, inventory: true },
  ])("price/inventory capabilities project independently %j", async ({ grants, prices, inventory }) => {
    db.auth.mockResolvedValue({ permissions: grants });
    const data = await readAdminStorefrontCatalog(Promise.resolve({ category: id(100), minPrice: "40", maxPrice: "80", inStock: "true" }));
    expect(data.state).toBe("ready");
    expect(data.query.minPrice).toBe(prices ? "40" : null);
    expect(data.query.inStock).toBe(inventory ? true : null);
    expect(db.variants).toHaveBeenCalledTimes(prices ? 1 : 0);
    expect(db.inventory).toHaveBeenCalledTimes(inventory ? 1 : 0);
    expect(data.page!.cards.length).toBeGreaterThan(0);
    for (const c of data.page!.cards) {
      expect(c.price).toBe(prices ? "66" : null);
      expect(c.stock).toBe(inventory ? "in" : "unknown");
    }
  });

  it("inventory read errors preserve unknown stock instead of a false zero-stock claim", async () => {
    db.raw.mockImplementation((parts, ...values) => parts.join("").includes("FROM product_stock_status") ? Promise.reject(new Error("stock failed")) : rawRead(parts, ...values));
    const data = await readAdminStorefrontCatalog(Promise.resolve({}));
    expect(data.state).toBe("ready"); expect(data.page!.cards.every(c => c.stock === "unknown")).toBe(true);
    db.inventory.mockRejectedValue(new Error("availability failed"));
    const unknown = await readAdminStorefrontCatalog(Promise.resolve({ inStock: "true" }));
    expect(unknown.availabilityKnown).toBeNull(); expect(unknown.query.inStock).toBeNull();
  });

  it("search count failure leaves real cards available with unavailable total", async () => {
    db.unsafe.mockImplementation((sql, ...params) => sql.includes("COUNT(DISTINCT p.id)") ? Promise.reject(new Error("count failed")) : searchRead(sql, ...params));
    const data = await readAdminStorefrontCatalog(Promise.resolve({ q: "متجر" }));
    expect(data.state).toBe("ready"); expect(data.page!.cards).toHaveLength(12); expect(data.total).toBeNull();
  });

  it.each([{}, { q: "متجر" }])("reversed authorized price window prevents product/search/count queries %j", async raw => {
    const data = await readAdminStorefrontCatalog(Promise.resolve({ ...raw, minPrice: "90", maxPrice: "10" }));
    expect(data.state).toBe("invalid-window"); expect(data.page).toBeNull(); expect(data.total).toBeNull();
    for (const fn of [db.products, db.count, db.unsafe, db.variants]) expect(fn).not.toHaveBeenCalled();
  });

  it.each(["x", "x".repeat(121)])("invalid search query %s never runs a product/search/count query", async q => {
    const data = await readAdminStorefrontCatalog(Promise.resolve({ q }));
    expect(data.state).toBe("invalid-query"); expect(db.products).not.toHaveBeenCalled(); expect(db.unsafe).not.toHaveBeenCalled(); expect(db.count).not.toHaveBeenCalled();
  });

  it.each(["bad-cursor", encodeCursor("not-a-date", id(2)), ["a", "b"]])("invalid listing cursor %j recovers to first page with truthful state", async cursor => {
    const clean = await readAdminStorefrontCatalog(Promise.resolve({ category: id(100) }));
    const recovered = await readAdminStorefrontCatalog(Promise.resolve({ category: id(100), cursor }));
    expect(recovered.invalidCursor).toBe(true); expect(recovered.page).toEqual(clean.page);
    expect(paramsOf(recovered.startHref)).toEqual({ category: id(100) });
  });

  it.each([
    { sort: "newest", cursor: encodeSearchCursor(2, 0.75, id(2)) },
    { sort: "relevance", cursor: encodeSearchCursor(0, date.getTime(), id(2)) },
    { sort: "relevance", cursor: encodeSearchCursor(5, 0.75, id(2)) },
  ])("wrong-sort or invalid search tuples recover instead of silently returning a misleading empty page %j", async tuple => {
    const clean = await readAdminStorefrontCatalog(Promise.resolve({ q: "متجر", sort: tuple.sort }));
    const recovered = await readAdminStorefrontCatalog(Promise.resolve({ q: "متجر", ...tuple }));
    expect(recovered.invalidCursor).toBe(true); expect(recovered.page).toEqual(clean.page);
  });

  it("invalid search cursor recovers, but a failed recovery does not claim first-page success", async () => {
    const data = await readAdminStorefrontCatalog(Promise.resolve({ q: "متجر", cursor: encodeCursor("name", id(1)) }));
    expect(data.invalidCursor).toBe(true); expect(data.page).not.toBeNull();
    db.products.mockRejectedValue(new Error("read failed"));
    render(await AdminPage({ searchParams: Promise.resolve({ cursor: "broken" }) }));
    expect(screen.getByText(/لم نتمكن من عرض بداية النتائج/)).toBeInTheDocument();
    expect(screen.queryByText(/عرضنا بداية النتائج/)).not.toBeInTheDocument();
    expect(screen.getByText("تعذّر تحميل كتالوج المتجر")).toBeInTheDocument();
  });

  it("count failure stays unavailable, not 12; failed taxonomy keeps selected options", async () => {
    db.count.mockRejectedValue(new Error("count failed")); db.categories.mockRejectedValue(new Error("category failed")); db.brands.mockRejectedValue(new Error("brand failed"));
    render(await AdminPage({ searchParams: Promise.resolve({ category: id(100), brand: BRAND.id }) }));
    expect(screen.getByText("إجمالي النتائج غير متاح حاليًا")).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(12);
    expect(screen.getByLabelText("القسم")).toHaveValue(id(100)); expect(screen.getByLabelText("العلامة التجارية")).toHaveValue(BRAND.id);
  });

  it("empty subtree is actual zero; missing variant/image/stock are null/unknown, not invented", async () => {
    const absent = await readAdminStorefrontCatalog(Promise.resolve({ category: id(999) }));
    expect(absent.page!.cards).toEqual([]); expect(absent.total).toBe(0);
    const [card] = await enrichCards([PRODUCTS[25]]);
    expect(card).toMatchObject({ price: null, sizeValue: null, image: null, stock: "unknown" });
    expect(card.imageUnavailable).toBeUndefined();
    const [fallback] = await enrichCards([PRODUCTS[24]]);
    expect(fallback.image).toBe(`https://images.test/${id(25)}/fallback.jpg`); // gallery sort/id when no primary
    db.inventory.mockResolvedValue(null);
    const data = await readAdminStorefrontCatalog(Promise.resolve({ inStock: "true" }));
    expect(data.query.inStock).toBeNull(); expect(data.availabilityKnown).toBe(false);
  });

  it("failed image read and browser broken image are observable unavailable states, never no-image claims", async () => {
    db.raw.mockImplementation((parts, ...values) => parts.join("").includes("FROM product_images") ? Promise.reject(new Error("media failed")) : rawRead(parts, ...values));
    const data = await readAdminStorefrontCatalog(Promise.resolve({}));
    expect(data.page!.cards.every(c => c.imageUnavailable && c.image === null)).toBe(true);
    const { unmount } = render(<ProductCard product={data.page!.cards[0]} showPurchase={false} />);
    expect(screen.getByRole("status")).toHaveTextContent("الصورة غير متاحة حاليًا"); expect(screen.queryByText("بلا صورة")).not.toBeInTheDocument();
    unmount(); db.raw.mockImplementation(rawRead);
    const healthy = await readAdminStorefrontCatalog(Promise.resolve({}));
    render(<ProductCard product={healthy.page!.cards[0]} showPurchase={false} />);
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByRole("status")).toHaveTextContent("الصورة غير متاحة حاليًا"); expect(screen.queryByText("بلا صورة")).not.toBeInTheDocument();
  });

  it("server GET form, category links, retry and pagination preserve q + all filters/sort; card tools stay admin-only", async () => {
    const raw = { q: "متجر", sort: "newest", category: id(100), brand: BRAND.id, type: "PIECE", minPrice: "10", maxPrice: "100", inStock: "false" };
    render(await AdminPage({ searchParams: Promise.resolve(raw) }));
    const form = screen.getByRole("form", { name: "فلاتر كتالوج المتجر" }) as HTMLFormElement;
    expect(form.method).toBe("get"); expect(form.getAttribute("action")).toBe("/admin/products/storefront");
    expect(Object.fromEntries(new FormData(form))).toEqual(raw);
    const categoryLink = within(screen.getByRole("navigation", { name: "أقسام كتالوج المتجر" })).getAllByRole("link")[1];
    expect(paramsOf(categoryLink.getAttribute("href")!)).toEqual({ ...raw, category: id(200) });
    expect(screen.getAllByRole("link", { name: "تفاصيل الإدارة" })).toHaveLength(screen.getAllByRole("article").length);
    expect(screen.getAllByRole("link", { name: "تعديل المنتج" })[0]).toHaveAttribute("href", expect.stringContaining("#edit-product"));
    expect(screen.getAllByRole("link", { name: "بحث مخزون المنتج" })[0]).toHaveAttribute("href", expect.stringContaining("/admin/inventory?search="));
    expect(db.purchase).not.toHaveBeenCalled();
  });

  it("listing GET direction persists and search error retry retains every result-defining filter", async () => {
    const first = render(await AdminPage({ searchParams: Promise.resolve({ sort: "name", dir: "asc", category: id(100) }) }));
    const form = screen.getByRole("form", { name: "فلاتر كتالوج المتجر" }) as HTMLFormElement;
    expect(new FormData(form).get("dir")).toBe("asc"); first.unmount();
    db.unsafe.mockRejectedValue(new Error("search failed"));
    const raw = { q: "متجر", sort: "newest", category: id(100), brand: BRAND.id, type: "WEIGHT", minPrice: "40", maxPrice: "80", inStock: "false" };
    render(await AdminPage({ searchParams: Promise.resolve(raw) }));
    expect(paramsOf(screen.getByRole("link", { name: "إعادة المحاولة بنفس الفلترة" }).getAttribute("href")!)).toEqual(raw);
  });
});
