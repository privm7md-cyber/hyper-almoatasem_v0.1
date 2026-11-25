// @vitest-environment node
// ADM-01 read contracts only: Prisma is mocked; no database or services.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), findFirst: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { product: mocks } }));

import { listProductsForAdmin, type AdminProductFilter } from "@/lib/catalog/queries";

const DATE = new Date("2026-11-01T00:00:00Z");
const ID = "00000000-0000-4000-8000-000000000001";
const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
function filter(overrides: Partial<AdminProductFilter> = {}): AdminProductFilter {
  return {
    limit: 20, cursor: null, search: null, categoryId: null, brandId: null,
    productType: null, unit: null, isActive: null, withPrices: false, ...overrides,
  };
}
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "p-1", name: "أرز", slug: "rice", productType: "WEIGHT", unit: "KG",
    saleStepGrams: 250, isActive: true, deletedAt: null, createdAt: DATE, updatedAt: DATE,
    category: { id: "c-1", name: "بقالة" }, brand: null, ...overrides,
  };
}
function selection() { return mocks.findMany.mock.calls.at(-1)![0].select; }
function where() { return mocks.findMany.mock.calls.at(-1)![0].where.AND[0]; }
function inventory(value: string | null) {
  return { inventory: { availableQuantity: value === null ? null : new Prisma.Decimal(value) } };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findMany.mockResolvedValue([]);
});

describe("ADM-01 product state predicates", () => {
  it.each([
    { state: undefined, isActive: null, expected: { deletedAt: null } },
    { state: null, isActive: true, expected: { deletedAt: null, isActive: true } },
    { state: undefined, isActive: false, expected: { deletedAt: null, isActive: false } },
    { state: "displayed" as const, isActive: false, expected: { deletedAt: null, isActive: true } },
    { state: "hidden" as const, isActive: true, expected: { deletedAt: null, isActive: false } },
    { state: "archived" as const, isActive: true, expected: { deletedAt: { not: null } } },
    { state: "archived" as const, isActive: false, expected: { deletedAt: { not: null } } },
  ])("state=$state legacy active=$isActive", async ({ state, isActive, expected }) => {
    await listProductsForAdmin(filter({ state, isActive }));
    expect(where()).toEqual(expected);
  });

  it("keeps search name/slug/barcode and taxonomy/type/unit predicates alongside state", async () => {
    await listProductsForAdmin(filter({
      state: "archived", search: "0123", categoryId: "c", brandId: "b", productType: "WEIGHT", unit: "KG",
    }));
    expect(where()).toEqual({
      deletedAt: { not: null }, categoryId: "c", brandId: "b", productType: "WEIGHT", unit: "KG",
      OR: [
        { name: { contains: "0123", mode: "insensitive" } },
        { slug: { contains: "0123", mode: "insensitive" } },
        { variants: { some: { codes: { some: { code: { contains: "0123" } } } } } },
      ],
    });
  });

  it("uses 20 rows plus a probe, anchors at the last displayed id, and retains state on the next query", async () => {
    mocks.findMany.mockResolvedValue(Array.from({ length: 21 }, (_, i) => row({ id: uuid(i) })));
    const page = await listProductsForAdmin(filter({ state: "hidden" }));
    expect(page.rows).toHaveLength(20);
    expect(page.nextCursor).toBe(uuid(19));
    expect(page.invalidCursor).toBe(false);
    expect(mocks.findMany.mock.calls[0][0]).toMatchObject({ take: 21, orderBy: [{ createdAt: "desc" }, { id: "asc" }] });
    mocks.findFirst.mockResolvedValue({ createdAt: DATE });
    await listProductsForAdmin(filter({ state: "hidden", cursor: page.nextCursor }));
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { AND: [{ deletedAt: null, isActive: false }, { id: uuid(19) }] }, select: { createdAt: true },
    });
    expect(mocks.findMany.mock.calls[1][0].where).toEqual({ AND: [
      { deletedAt: null, isActive: false },
      { OR: [{ createdAt: { lt: DATE } }, { createdAt: DATE, id: { gt: uuid(19) } }] },
    ] });
  });

  it("distinguishes exhausted or genuinely empty pages from invalid anchors", async () => {
    mocks.findMany.mockResolvedValue([row()]);
    expect(await listProductsForAdmin(filter())).toMatchObject({ nextCursor: null, invalidCursor: false });
    mocks.findFirst.mockResolvedValue({ createdAt: DATE });
    mocks.findMany.mockResolvedValue([]);
    expect(await listProductsForAdmin(filter({ cursor: ID }))).toEqual({ rows: [], nextCursor: null, invalidCursor: false });
    mocks.findFirst.mockResolvedValue(null);
    mocks.findMany.mockClear();
    expect(await listProductsForAdmin(filter({ cursor: ID }))).toEqual({ rows: [], nextCursor: null, invalidCursor: true });
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});

describe("CATALOG invalid product cursor contracts", () => {
  it.each(["bad", "", "'; DROP TABLE products", `${ID}x`])("rejects malformed %s before any DB read", async (cursor) => {
    expect(await listProductsForAdmin(filter({ cursor }))).toEqual({ rows: [], nextCursor: null, invalidCursor: true });
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it.each([
    { label: "missing anchor", overrides: {} },
    { label: "deleted anchor in nonarchived list", overrides: { state: "displayed" as const } },
    { label: "foreign category", overrides: { categoryId: uuid(2) } },
    { label: "foreign brand", overrides: { brandId: uuid(3) } },
    { label: "foreign search/type/unit/state", overrides: { search: "أرز", productType: "WEIGHT" as const, unit: "KG", state: "hidden" as const } },
  ])("$label is invalid, not an empty catalog; recovery keeps all predicates", async ({ overrides }) => {
    const requested = filter({ ...overrides, cursor: ID });
    mocks.findFirst.mockResolvedValue(null); // The anchor does not satisfy the scoped DB predicate.
    const invalid = await listProductsForAdmin(requested);
    expect(invalid).toEqual({ rows: [], nextCursor: null, invalidCursor: true });
    expect(mocks.findMany).not.toHaveBeenCalled();
    const anchorQuery = mocks.findFirst.mock.calls[0][0];
    expect(anchorQuery.select).toEqual({ createdAt: true });
    expect(anchorQuery.where.AND[1]).toEqual({ id: ID });
    expect(anchorQuery.where.AND[0]).toMatchObject({ deletedAt: null });
    mocks.findMany.mockResolvedValue([row()]);
    const recovered = await listProductsForAdmin({ ...requested, cursor: null });
    expect(recovered).toMatchObject({ invalidCursor: false, nextCursor: null });
    expect(recovered.rows).toHaveLength(1);
    expect(where()).toEqual(anchorQuery.where.AND[0]);
    expect(mocks.findMany.mock.calls[0][0].where.AND[1]).toEqual({});
  });

  it("allows an archived anchor only in the archived scope, regardless of legacy active", async () => {
    mocks.findFirst.mockResolvedValue({ createdAt: DATE });
    expect((await listProductsForAdmin(filter({ cursor: ID, state: "archived", isActive: false }))).invalidCursor).toBe(false);
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { AND: [{ deletedAt: { not: null } }, { id: ID }] }, select: { createdAt: true },
    });
  });

  it("propagates anchor read failures rather than misclassifying them as invalid cursors", async () => {
    mocks.findFirst.mockRejectedValue(new Error("anchor read unavailable"));
    await expect(listProductsForAdmin(filter({ cursor: ID }))).rejects.toThrow("anchor read unavailable");
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});

describe("ADM-01 permission-gated minimal projections", () => {
  it.each([
    { withPrices: false, withInventory: false },
    { withPrices: true, withInventory: false },
    { withPrices: false, withInventory: true },
    { withPrices: true, withInventory: true },
  ])("price=$withPrices inventory=$withInventory", async ({ withPrices, withInventory }) => {
    await listProductsForAdmin(filter({ withPrices, withInventory }));
    const select = selection();
    expect(select.deletedAt).toBe(true);
    expect(select.category).toEqual({ select: { id: true, name: true } });
    expect(select.brand).toEqual({ select: { id: true, name: true } });
    if (!withPrices && !withInventory) expect(select).not.toHaveProperty("variants");
    else expect(select.variants).toEqual({
      where: { isActive: true, deletedAt: null },
      select: {
        ...(withPrices ? { price: true } : {}),
        ...(withInventory ? { inventory: { select: { availableQuantity: true } } } : {}),
      },
    });
    expect(JSON.stringify(select)).not.toMatch(/cost|compareAt|reservedQuantity|lowStockThreshold/);
    expect(mocks.findMany.mock.calls[0][0]).not.toHaveProperty("include");
  });

  it("does not access pricing or inventory when neither was requested, even on an over-rich mock", async () => {
    const source = row({ costPrice: "867.53", description: "private", category: { id: "c", name: "بقالة", cost_price: "867.53" } });
    Object.defineProperty(source, "variants", { get() { throw new Error("Unrequested relation accessed"); } });
    mocks.findMany.mockResolvedValue([source]);
    const product = (await listProductsForAdmin(filter())).rows[0];
    expect(product).toMatchObject({ minPrice: null, stock: "unknown", deletedAt: null });
    expect(product.category).toEqual({ id: "c", name: "بقالة" });
    expect(product).not.toHaveProperty("costPrice");
    expect(product).not.toHaveProperty("description");
    expect(product).not.toHaveProperty("variants");
    expect(JSON.stringify(product)).not.toContain("867.53");
  });

  it("inventory-only reads do not access variant pricing", async () => {
    const variant = inventory("1");
    Object.defineProperty(variant, "price", { get() { throw new Error("Unauthorized price accessed"); } });
    mocks.findMany.mockResolvedValue([row({ variants: [variant] })]);
    expect((await listProductsForAdmin(filter({ withInventory: true }))).rows[0]).toMatchObject({ stock: "in", minPrice: null });
    expect(selection().variants.select).not.toHaveProperty("price");
  });

  it("compares minimum prices as exact Decimal values, with no cost or raw variants in the DTO", async () => {
    mocks.findMany.mockResolvedValue([row({
      deletedAt: DATE,
      variants: [
        { price: new Prisma.Decimal("9007199254740992.02"), costPrice: new Prisma.Decimal("867.53") },
        { price: new Prisma.Decimal("9007199254740992.01") },
      ],
    })]);
    const product = (await listProductsForAdmin(filter({ state: "archived", withPrices: true }))).rows[0];
    expect(product.minPrice).toBe("9007199254740992.01");
    expect(product.deletedAt).toEqual(DATE);
    expect(product.stock).toBe("unknown");
    expect(product).not.toHaveProperty("variants");
    expect(product).not.toHaveProperty("costPrice");
  });

  it("keeps a missing sellable price null", async () => {
    mocks.findMany.mockResolvedValue([row({ variants: [] })]);
    expect((await listProductsForAdmin(filter({ withPrices: true }))).rows[0].minPrice).toBeNull();
  });
});

describe("ADM-01 generated inventory coverage", () => {
  it.each([
    { label: "no sellable variants", variants: [], stock: "unknown" },
    { label: "no inventory row", variants: [{ inventory: null }], stock: "unknown" },
    { label: "missing relation", variants: [{}], stock: "unknown" },
    { label: "null generated availability", variants: [inventory(null)], stock: "unknown" },
    { label: "partial row coverage", variants: [inventory("0"), { inventory: null }], stock: "unknown" },
    { label: "partial generated coverage", variants: [inventory("-1"), inventory(null)], stock: "unknown" },
    { label: "all covered and nonpositive", variants: [inventory("0"), inventory("-0.001")], stock: "oos" },
    { label: "one tiny positive", variants: [inventory("0"), inventory("0.001")], stock: "in" },
    { label: "positive with missing coverage", variants: [inventory("2"), { inventory: null }], stock: "in" },
  ])("$label => $stock", async ({ variants, stock }) => {
    mocks.findMany.mockResolvedValue([row({ variants })]);
    const product = (await listProductsForAdmin(filter({ withInventory: true }))).rows[0];
    expect(product.stock).toBe(stock);
    expect(product).not.toHaveProperty("inventory");
    expect(product).not.toHaveProperty("availableQuantity");
    expect(product).not.toHaveProperty("variants");
  });
});
