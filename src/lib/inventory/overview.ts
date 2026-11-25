// Inventory-only catalog projection: starts at variants, including missing balances.
import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api/errors";
import { uuidSchema } from "@/lib/api/validation";
import { movementTypeSchema, referenceTypeSchema } from "./validation";
import { boundedThousandths } from "./quantities";
import { unitLabel } from "@/lib/admin/terminology";

export const inventoryDeskSchema = z.object({
  search: z.string().trim().max(120).optional(),
  categoryId: uuidSchema.optional(), brandId: uuidSchema.optional(),
  productId: uuidSchema.optional(), variantId: uuidSchema.optional(),
  type: z.enum(["PIECE", "WEIGHT"]).optional(),
  status: z.enum(["balances", "in_stock", "low_stock", "out_of_stock", "missing", "history"]).optional(),
  cursor: uuidSchema.optional(),
  movementType: movementTypeSchema.optional(), referenceType: referenceTypeSchema.optional(),
  referenceId: z.string().trim().min(1).max(64).optional(),
});
export type InventoryDeskFilter = z.infer<typeof inventoryDeskSchema>;

export function parseInventoryDesk(raw: Record<string, string | string[] | undefined>): InventoryDeskFilter {
  const values = Object.fromEntries(Object.entries(raw).map(([key, value]) =>
    [key, (Array.isArray(value) ? value[0] : value) || undefined]));
  const parsed = inventoryDeskSchema.safeParse(values);
  if (!parsed.success) throw new ApiError("VALIDATION", "Invalid inventory filters or cursor.");
  return parsed.data;
}

export const inventoryVariantSelect = {
  id: true, name: true, sizeValue: true, sizeUnit: true, isActive: true, deletedAt: true,
  product: { select: {
    id: true, name: true, productType: true, isActive: true, deletedAt: true,
    category: { select: { id: true, name: true } }, brand: { select: { id: true, name: true } },
  } },
  codes: { select: { code: true, type: true, isPrimary: true }, orderBy: [{ isPrimary: "desc" }, { id: "asc" }] },
  inventory: { select: {
    quantity: true, reservedQuantity: true, availableQuantity: true, lowStockThreshold: true, updatedAt: true,
  } },
} satisfies Prisma.ProductVariantSelect;
export type InventoryVariant = Prisma.ProductVariantGetPayload<{ select: typeof inventoryVariantSelect }>;

/** Same measurement convention as service.ts: PIECE counts packs; GRAM else KG. */
export function inventoryUnit(productType: string, sizeUnit: string | null): string {
  return productType === "PIECE" ? "عبوة" : unitLabel(sizeUnit === "GRAM" ? "GRAM" : "KG");
}

export function variantBalanceState(row: Pick<InventoryVariant, "inventory">): "in_stock" | "low_stock" | "out_of_stock" | "missing" {
  const inventory = row.inventory;
  if (!inventory || inventory.availableQuantity === null) return "missing";
  const available = boundedThousandths(inventory.availableQuantity.toString(), true);
  if (available <= 0) return "out_of_stock";
  return inventory.lowStockThreshold !== null && available <= boundedThousandths(inventory.lowStockThreshold.toString())
    ? "low_stock" : "in_stock";
}

export function inventoryVariantScope(filter: InventoryDeskFilter): Prisma.ProductVariantWhereInput {
  const and: Prisma.ProductVariantWhereInput[] = [];
  if (filter.variantId) and.push({ id: filter.variantId });
  if (filter.productId) and.push({ productId: filter.productId });
  if (filter.categoryId) and.push({ product: { categoryId: filter.categoryId } });
  if (filter.brandId) and.push({ product: { brandId: filter.brandId } });
  if (filter.type) and.push({ product: { productType: filter.type } });
  if (filter.search) and.push({ OR: [
    { name: { contains: filter.search, mode: "insensitive" } },
    { product: { name: { contains: filter.search, mode: "insensitive" } } },
    { codes: { some: { code: { contains: filter.search, mode: "insensitive" } } } },
  ] });
  return { AND: and };
}

function balanceWhere(status: InventoryDeskFilter["status"]): Prisma.ProductVariantWhereInput {
  if (status === "missing") return { OR: [{ inventory: null }, { inventory: { availableQuantity: null } }] };
  if (status === "balances") return { inventory: { availableQuantity: { not: null } } };
  if (status === "out_of_stock") return { inventory: { availableQuantity: { lte: 0 } } };
  if (status === "low_stock") return { inventory: {
    availableQuantity: { gt: 0, lte: prisma.inventory.fields.lowStockThreshold }, lowStockThreshold: { not: null },
  } };
  if (status === "in_stock") return { inventory: { OR: [
    { availableQuantity: { gt: 0 }, lowStockThreshold: null },
    { availableQuantity: { gt: prisma.inventory.fields.lowStockThreshold } },
  ] } };
  return {};
}

export async function listInventoryVariants(filter: InventoryDeskFilter, limit = 20) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ApiError("VALIDATION", "Invalid limit.");
  const scope = { AND: [inventoryVariantScope(filter), balanceWhere(filter.status)] };
  const and: Prisma.ProductVariantWhereInput[] = [scope];
  if (filter.cursor) {
    if (!uuidSchema.safeParse(filter.cursor).success) throw new ApiError("VALIDATION", "Invalid pagination cursor.");
    const anchor = await prisma.productVariant.findFirst({
      where: { AND: [scope, { id: filter.cursor }] }, select: { product: { select: { name: true } } },
    });
    if (!anchor) throw new ApiError("VALIDATION", "Cursor no longer matches filters; restart the list.");
    const name = anchor.product.name;
    and.push({ OR: [
      { product: { name: { gt: name } } },
      { AND: [{ product: { name } }, { id: { gt: filter.cursor } }] },
    ] });
  }
  return prisma.productVariant.findMany({
    where: { AND: and }, select: inventoryVariantSelect,
    orderBy: [{ product: { name: "asc" } }, { id: "asc" }], take: limit + 1,
  });
}

/** Real variant counts across the active filters, never sums of incompatible units. */
export async function getInventoryOverview(filter: InventoryDeskFilter) {
  const scope = inventoryVariantScope(filter);
  const count = (status?: InventoryDeskFilter["status"]) => prisma.productVariant.count({
    where: { AND: [scope, balanceWhere(status)] },
  });
  const [total, known, low, zero, missing] = await Promise.all([
    count(), count("balances"), count("low_stock"), count("out_of_stock"), count("missing"),
  ]);
  return { total, known, low, zero, missing };
}

export function inventoryFormOptions(rows: InventoryVariant[]) {
  return rows.filter(row => variantBalanceState(row) !== "missing").map(row => ({
    id: row.id, productName: row.product.name, variantName: row.name,
    unit: inventoryUnit(row.product.productType, row.sizeUnit), quantity: row.inventory!.quantity.toString(),
    available: row.inventory!.availableQuantity!.toString(), threshold: row.inventory!.lowStockThreshold?.toString() ?? null,
  }));
}

export function getInventoryVariant(variantId: string) {
  if (!uuidSchema.safeParse(variantId).success) throw new ApiError("VALIDATION", "Invalid variant.");
  return prisma.productVariant.findUnique({ where: { id: variantId }, select: inventoryVariantSelect });
}
