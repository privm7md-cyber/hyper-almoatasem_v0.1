// @vitest-environment node
// Read-query contracts and pure classifiers; Prisma methods are in-memory spies.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const m = vi.hoisted(() => ({
  inventoryMany: vi.fn(), inventoryFirst: vi.fn(), variantMany: vi.fn(),
  variantFirst: vi.fn(), count: vi.fn(), query: vi.fn(), movementFirst: vi.fn(), movementMany: vi.fn(),
  thresholdField: { modelName: "Inventory", name: "lowStockThreshold" },
}));
vi.mock("@/lib/db", () => ({ prisma: {
  inventory: { fields: { lowStockThreshold: m.thresholdField }, findMany: m.inventoryMany, findFirst: m.inventoryFirst },
  productVariant: { findMany: m.variantMany, findFirst: m.variantFirst, count: m.count },
  inventoryMovement: { findFirst: m.movementFirst, findMany: m.movementMany },
  $queryRaw: m.query,
} }));
import {
  getInventoryOverview, inventoryFormOptions, inventoryUnit, listInventoryVariants,
  variantBalanceState, type InventoryVariant,
} from "../overview";
import { getProductStockStatus, getProductsStockBatch, listInventory, listMovements, type InventoryListFilter } from "../queries";
import { productStockState, type ProductStockCoverage } from "../stock-coverage";

const ID = "abcdefab-1234-4000-8000-000000000001";
const OTHER = "abcdefab-1234-4000-8000-000000000002";
const DATE = new Date("2026-11-12T00:00:00.000Z");
const decimal = (value: string) => new Prisma.Decimal(value);
function row(available: string | null, threshold: string | null = "2"): InventoryVariant {
  return {
    id: ID, name: "Pack", sizeValue: decimal("1"), sizeUnit: "KG", isActive: true, deletedAt: null,
    product: { id: OTHER, name: "Product", productType: "PIECE", isActive: true, deletedAt: null, category: { id: OTHER, name: "Category" }, brand: null },
    codes: [], inventory: {
      quantity: decimal("10"), reservedQuantity: decimal("3"),
      availableQuantity: available === null ? null : decimal(available),
      lowStockThreshold: threshold === null ? null : decimal(threshold), updatedAt: DATE,
    },
  };
}
function filter(patch: Partial<InventoryListFilter> = {}): InventoryListFilter {
  return { limit: 20, cursor: null, search: null, productId: null, inStock: null, lowStock: null, ...patch };
}
const low = () => ({ availableQuantity: { gt: 0, lte: m.thresholdField }, lowStockThreshold: { not: null } });
const sql = (call: unknown[]) => (call[0] as TemplateStringsArray).join("?").replace(/\s+/g, " ").trim();

beforeEach(() => {
  vi.resetAllMocks();
  m.inventoryMany.mockResolvedValue([]);
  m.variantMany.mockResolvedValue([]);
});

describe("ADM04 overview known/missing and measurement classifiers", () => {
  it.each([
    { label: "absent row", value: { inventory: null }, state: "missing" },
    { label: "null generated availability", value: row(null), state: "missing" },
    { label: "known zero", value: row("0"), state: "out_of_stock" },
    { label: "negative availability", value: row("-0.001"), state: "out_of_stock" },
    { label: "threshold equality", value: row("2"), state: "low_stock" },
    { label: "tiny positive", value: row("0.001"), state: "low_stock" },
    { label: "above threshold", value: row("2.001"), state: "in_stock" },
    { label: "unset threshold", value: row("0.001", null), state: "in_stock" },
    { label: "zero threshold", value: row("0.001", "0"), state: "in_stock" },
  ])("$label is $state", ({ value, state }) => {
    expect(variantBalanceState(value)).toBe(state);
  });

  it("classifies only generated availability, not quantity minus reserved", () => {
    const value = row("0");
    Object.defineProperty(value.inventory!, "quantity", { get() { throw new Error("Quantity recomputed"); } });
    Object.defineProperty(value.inventory!, "reservedQuantity", { get() { throw new Error("Reserved recomputed"); } });
    expect(variantBalanceState(value)).toBe("out_of_stock");
  });

  it.each([
    ["PIECE", "KG", "عبوة"], ["PIECE", "GRAM", "عبوة"], ["PIECE", null, "عبوة"],
    ["WEIGHT", "GRAM", "جم"], ["WEIGHT", "KG", "كجم"], ["WEIGHT", null, "كجم"],
  ])("%s with size unit %s uses stock unit %s", (type, unit, expected) => {
    expect(inventoryUnit(type!, unit)).toBe(expected);
  });

  it("forms exclude missing balances but keep known zero, real quantity and measurement units", () => {
    const zero = row("0", null);
    const weight = { ...row("1.125"), id: OTHER, product: { ...row("1").product, productType: "WEIGHT" } };
    expect(inventoryFormOptions([{ ...row("0"), inventory: null }, row(null), zero, weight])).toEqual([
      { id: ID, productName: "Product", variantName: "Pack", unit: "عبوة", quantity: "10", available: "0", threshold: null },
      { id: OTHER, productName: "Product", variantName: "Pack", unit: "كجم", quantity: "10", available: "1.125", threshold: "2" },
    ]);
  });

  it("overview counts scoped variants/known/low/zero/missing independently, not mixed-unit totals", async () => {
    for (const value of [9, 6, 2, 1, 3]) m.count.mockResolvedValueOnce(value);
    expect(await getInventoryOverview({ categoryId: ID, type: "WEIGHT", status: "missing" })).toEqual({ total: 9, known: 6, low: 2, zero: 1, missing: 3 });
    const scope = { AND: [{ product: { categoryId: ID } }, { product: { productType: "WEIGHT" } }] };
    expect(m.count.mock.calls).toEqual([
      [{ where: { AND: [scope, {}] } }],
      [{ where: { AND: [scope, { inventory: { availableQuantity: { not: null } } }] } }],
      [{ where: { AND: [scope, { inventory: low() }] } }],
      [{ where: { AND: [scope, { inventory: { availableQuantity: { lte: 0 } } }] } }],
      [{ where: { AND: [scope, { OR: [{ inventory: null }, { inventory: { availableQuantity: null } }] }] } }],
    ]);
    expect(m.variantMany).not.toHaveBeenCalled();
    expect(m.inventoryMany).not.toHaveBeenCalled();
  });
});

describe("ADM04 predicates precede take, never filter a fetched page", () => {
  it.each([{ lowStock: true }, { status: "low_stock" as const }])("legacy inventory low filter %j is row-local in Prisma where", async (patch) => {
    const records = [{ id: "database-probe" }];
    m.inventoryMany.mockResolvedValue(records);
    expect(await listInventory(filter(patch))).toBe(records);
    expect(m.inventoryMany).toHaveBeenCalledOnce();
    const query = m.inventoryMany.mock.calls[0][0];
    expect(query.where).toEqual({ AND: [low()] });
    expect(query.where.AND[0].availableQuantity.lte).toBe(m.thresholdField);
    expect(query.take).toBe(21);
    expect(query.orderBy).toEqual([{ id: "asc" }]);
  });

  it("lowStock=false sends the complement (including zero and unknown) before take", async () => {
    await listInventory(filter({ lowStock: false }));
    expect(m.inventoryMany.mock.calls[0][0]).toMatchObject({
      where: { AND: [{ OR: [
        { availableQuantity: { equals: null } }, { availableQuantity: { lte: 0 } },
        { lowStockThreshold: { equals: null } }, { availableQuantity: { gt: m.thresholdField } },
      ] }] }, take: 21,
    });
  });

  it("overview low-stock listing filters the inventory relation before take+1", async () => {
    const records = [{ id: "database-probe" }];
    m.variantMany.mockResolvedValue(records);
    expect(await listInventoryVariants({ status: "low_stock", productId: ID }, 7)).toBe(records);
    const query = m.variantMany.mock.calls[0][0];
    expect(query.where).toEqual({ AND: [{ AND: [{ AND: [{ productId: ID }] }, { inventory: low() }] }] });
    expect(query.where.AND[0].AND[1].inventory.availableQuantity.lte).toBe(m.thresholdField);
    expect(query.take).toBe(8);
    expect(query.orderBy).toEqual([{ product: { name: "asc" } }, { id: "asc" }]);
    expect(query.select.inventory.select.availableQuantity).toBe(true);
    expect(query.select.inventory.select.quantity).toBe(true);
  });

  it.each([
    { status: "missing" as const, expected: { OR: [{ inventory: null }, { inventory: { availableQuantity: null } }] } },
    { status: "balances" as const, expected: { inventory: { availableQuantity: { not: null } } } },
    { status: "out_of_stock" as const, expected: { inventory: { availableQuantity: { lte: 0 } } } },
    { status: "in_stock" as const, expected: { inventory: { OR: [
      { availableQuantity: { gt: 0 }, lowStockThreshold: null }, { availableQuantity: { gt: m.thresholdField } },
    ] } } },
  ])("overview $status is a database relation predicate", async ({ status, expected }) => {
    await listInventoryVariants({ status });
    expect(m.variantMany.mock.calls[0][0]).toMatchObject({ where: { AND: [{ AND: [{ AND: [] }, expected] }] }, take: 21 });
  });

  it("legacy low-stock cursor anchor and page both retain the SQL predicate", async () => {
    m.inventoryFirst.mockResolvedValue({ variant: { product: { name: "Rice" } } });
    await listInventory(filter({ lowStock: true, cursor: ID, order: "product_name" }));
    expect(m.inventoryFirst.mock.calls[0][0].where).toEqual({ AND: [low(), { id: ID }] });
    expect(m.inventoryMany.mock.calls[0][0]).toMatchObject({
      where: { AND: [low(), { OR: [
        { variant: { product: { name: { gt: "Rice" } } } },
        { AND: [{ variant: { product: { name: "Rice" } } }, { id: { gt: ID } }] },
      ] }] }, take: 21,
    });
  });

  it("overview cursor anchor is scoped and the page uses product-name/id keyset", async () => {
    m.variantFirst.mockResolvedValue({ product: { name: "Rice" } });
    await listInventoryVariants({ status: "low_stock", categoryId: OTHER, cursor: ID });
    const scope = { AND: [{ AND: [{ product: { categoryId: OTHER } }] }, { inventory: low() }] };
    expect(m.variantFirst.mock.calls[0][0].where).toEqual({ AND: [scope, { id: ID }] });
    expect(m.variantMany.mock.calls[0][0].where).toEqual({ AND: [scope, { OR: [
      { product: { name: { gt: "Rice" } } }, { AND: [{ product: { name: "Rice" } }, { id: { gt: ID } }] },
    ] }] });
  });

  it("a cursor outside the low-stock scope is rejected rather than returning a false empty page", async () => {
    m.variantFirst.mockResolvedValue(null);
    await expect(listInventoryVariants({ status: "low_stock", cursor: ID })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(m.variantMany).not.toHaveBeenCalled();
  });

  it.each([0, 101, 1.5, Number.NaN])("invalid limit %s fails before reads", async (limit) => {
    await expect(listInventoryVariants({}, limit)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(m.variantFirst).not.toHaveBeenCalled();
    expect(m.variantMany).not.toHaveBeenCalled();
  });
});

describe("ADM04 movement cursor preserves database precision", () => {
  const movementFilter = { limit: 20, cursor: ID, variantId: OTHER, movementType: "ADJUSTMENT", referenceType: null, referenceId: null, order: "recent" as const };
  it("validates the scoped anchor and delegates timestamp keyset to Prisma without reading a JS Date", async () => {
    m.movementFirst.mockResolvedValue({ id: ID });
    m.movementMany.mockResolvedValue([]);
    await listMovements(movementFilter);
    const scope = [{ productVariantId: OTHER }, { movementType: "ADJUSTMENT" }];
    expect(m.movementFirst).toHaveBeenCalledWith({ where: { AND: [...scope, { id: ID }] }, select: { id: true } });
    expect(m.movementMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { AND: scope }, cursor: { id: ID }, skip: 1, take: 21,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }));
  });
  it.each(["invalid", ID])("rejects invalid or nonmatching anchor %s before the page read", async cursor => {
    m.movementFirst.mockResolvedValue(null);
    await expect(listMovements({ ...movementFilter, cursor })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(m.movementMany).not.toHaveBeenCalled();
  });
  it("preserves legacy ascending-id order without a fabricated first-page cursor", async () => {
    m.movementMany.mockResolvedValue([]);
    await listMovements({ ...movementFilter, cursor: null, order: "id" });
    expect(m.movementFirst).not.toHaveBeenCalled();
    expect(m.movementMany.mock.calls[0][0]).toMatchObject({ orderBy: [{ id: "asc" }], take: 21 });
    expect(m.movementMany.mock.calls[0][0]).not.toHaveProperty("cursor");
  });
});

describe("ADM04 product availability requires honest sellable coverage", () => {
  it.each([
    { label: "no status", value: null, state: "unknown" },
    { label: "undefined status", value: undefined, state: "unknown" },
    { label: "no sellable variants", value: { sellableVariants: 0, knownSellableBalances: 0, inStockVariants: 0, isInStock: false }, state: "unknown" },
    { label: "no balances", value: { sellableVariants: 2, knownSellableBalances: 0, inStockVariants: 0, isInStock: false }, state: "unknown" },
    { label: "partial coverage cannot prove zero", value: { sellableVariants: 2, knownSellableBalances: 1, inStockVariants: 0, isInStock: false }, state: "unknown" },
    { label: "complete zero coverage", value: { sellableVariants: 2, knownSellableBalances: 2, inStockVariants: 0, isInStock: false }, state: "oos" },
    { label: "partial but positive", value: { sellableVariants: 2, knownSellableBalances: 1, inStockVariants: 1, isInStock: true }, state: "in" },
    { label: "positive count beats collapsed flag", value: { sellableVariants: 2, knownSellableBalances: 2, inStockVariants: 1, isInStock: false }, state: "in" },
    { label: "flag alone cannot prove coverage", value: { sellableVariants: 2, knownSellableBalances: 1, inStockVariants: 0, isInStock: true }, state: "unknown" },
  ])("$label => $state", ({ value, state }) => {
    const stock: ProductStockCoverage | null = value == null ? null : { productId: ID, ...value };
    expect(productStockState(value === undefined ? undefined : stock)).toBe(state);
  });

  it("single-product read counts only active nondeleted variants with nonnull generated balances", async () => {
    m.query.mockResolvedValue([{ product_id: ID, sellable_variants: BigInt(2), known_sellable_balances: BigInt(1), in_stock_variants: BigInt(0), is_in_stock: false }]);
    const stock = await getProductStockStatus(ID);
    expect(stock).toEqual({ productId: ID, sellableVariants: 2, knownSellableBalances: 1, inStockVariants: 0, isInStock: false });
    expect(productStockState(stock)).toBe("unknown");
    expect(sql(m.query.mock.calls[0])).toContain("JOIN inventory i ON i.product_variant_id = v.id WHERE v.product_id = s.product_id AND v.is_active AND v.deleted_at IS NULL AND i.available_quantity IS NOT NULL");
    expect(m.query.mock.calls[0].slice(1)).toEqual([ID]);
  });

  it("missing status row remains null/unknown", async () => {
    m.query.mockResolvedValue([]);
    const stock = await getProductStockStatus(ID);
    expect(stock).toBeNull();
    expect(productStockState(stock)).toBe("unknown");
  });

  it("batch read uses two queries, and mere inventory presence cannot imply complete coverage", async () => {
    m.query.mockResolvedValueOnce([{ product_id: ID }, { product_id: OTHER }]).mockResolvedValueOnce([
      { product_id: ID, sellable_variants: BigInt(2), known_sellable_balances: BigInt(1), in_stock_variants: BigInt(0), is_in_stock: false },
      { product_id: OTHER, sellable_variants: BigInt(2), known_sellable_balances: BigInt(2), in_stock_variants: BigInt(0), is_in_stock: false },
    ]);
    const result = await getProductsStockBatch([ID, OTHER]);
    expect(m.query).toHaveBeenCalledTimes(2);
    expect(result.hasInventorySet).toEqual(new Set([ID, OTHER]));
    expect(productStockState(result.statusByProduct?.get(ID))).toBe("unknown");
    expect(productStockState(result.statusByProduct?.get(OTHER))).toBe("oos");
    expect(sql(m.query.mock.calls[1])).toContain("v.is_active AND v.deleted_at IS NULL AND i.available_quantity IS NOT NULL");
    for (const call of m.query.mock.calls) expect(call.slice(1)).toEqual([[ID, OTHER]]);
  });

  it("failed stock-status query remains unavailable rather than fabricated out-of-stock", async () => {
    m.query.mockResolvedValueOnce([{ product_id: ID }]).mockRejectedValueOnce(new Error("view unavailable"));
    const result = await getProductsStockBatch([ID]);
    expect(result.hasInventorySet.has(ID)).toBe(true);
    expect(result.statusByProduct).toBeNull();
    expect(productStockState(result.statusByProduct?.get(ID))).toBe("unknown");
  });

  it("empty batch does not touch Prisma", async () => {
    expect(await getProductsStockBatch([])).toEqual({ hasInventorySet: new Set(), statusByProduct: new Map() });
    expect(m.query).not.toHaveBeenCalled();
  });
});
