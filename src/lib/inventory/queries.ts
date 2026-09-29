// BA-3 inventory read domain.
//
// Prisma owns representable reads (inventory rows, variants, movements,
// taxonomy). Raw SQL owns the product_stock_status VIEW (no Prisma model)
// and any read that must observe GENERATED values without drift. No read
// here mutates state; availability is always the DB GENERATED value.
import { prisma } from "@/lib/db";

export interface InventoryListFilter {
  limit: number;
  cursor: string | null;
  search: string | null;
  productId: string | null;
  inStock: boolean | null;
  lowStock: boolean | null;
}

function cursorClause(cursor: string | null): { id: { gt: string } } | object {
  return cursor ? { id: { gt: cursor } } : {};
}

/** Admin inventory list (Prisma). Variant id IS the cursor domain key, but
 * inventory rows carry their own ids; paginate over inventory.id (stable,
 * id-tiebreak inherent). Filters map onto stored columns only — available
 * filtering uses the GENERATED column directly in SQL (no JS math). */
export async function listInventory(filter: InventoryListFilter) {
  const where: Record<string, unknown> = {
    ...cursorClause(filter.cursor),
    ...(filter.productId ? { variant: { productId: filter.productId } } : {}),
    ...(filter.search
      ? { variant: { product: { name: { contains: filter.search, mode: "insensitive" as const } } } }
      : {}),
    ...(filter.inStock === true ? { availableQuantity: { gt: 0 } } : {}),
    ...(filter.inStock === false ? { availableQuantity: { lte: 0 } } : {}),
  };
  const rows = await prisma.inventory.findMany({
    where,
    include: {
      variant: {
        select: {
          id: true,
          name: true,
          sizeUnit: true,
          isActive: true,
          product: {
            select: {
              id: true,
              name: true,
              slug: true,
              productType: true,
              unit: true,
              saleStepGrams: true,
            },
          },
        },
      },
    },
    orderBy: [{ id: "asc" as const }],
    take: filter.limit + 1,
  });
  if (filter.lowStock === null || filter.lowStock === undefined) return rows;
  // low_stock is threshold-relative: apply in memory over the fetched page
  // (threshold comparison is row-local display logic, not a stock guard).
  return rows.filter((r) => {
    const available = Number(r.availableQuantity?.toString() ?? "0");
    const threshold = r.lowStockThreshold === null ? null : Number(r.lowStockThreshold.toString());
    const low = threshold !== null && available > 0 && available <= threshold;
    return filter.lowStock ? low : !low;
  });
}

export function getInventory(variantId: string) {
  return prisma.inventory.findUnique({
    where: { productVariantId: variantId },
    include: {
      variant: {
        include: {
          product: {
            include: {
              category: { select: { id: true, name: true, slug: true } },
              brand: { select: { id: true, name: true, slug: true } },
            },
          },
        },
      },
    },
  });
}

/** Raw-SQL read of the frozen product_stock_status VIEW (no Prisma model).
 * Single definition of "product in stock" (REVIEW-02). */
export async function getProductStockStatus(productId: string): Promise<{
  productId: string;
  sellableVariants: number;
  inStockVariants: number;
  isInStock: boolean;
} | null> {
  const rows = await prisma.$queryRaw<Array<{
    product_id: string;
    sellable_variants: bigint;
    in_stock_variants: bigint;
    is_in_stock: boolean | null;
  }>>`SELECT product_id, sellable_variants, in_stock_variants, is_in_stock
        FROM product_stock_status WHERE product_id = ${productId}::uuid`;
  const row = rows[0];
  if (!row) return null;
  return {
    productId: row.product_id,
    sellableVariants: Number(row.sellable_variants),
    inStockVariants: Number(row.in_stock_variants),
    isInStock: row.is_in_stock === true,
  };
}

export interface MovementListFilter {
  limit: number;
  cursor: string | null;
  variantId: string | null;
  movementType: string | null;
  referenceType: string | null;
  referenceId: string | null;
}

export async function listMovements(filter: MovementListFilter) {
  const rows = await prisma.inventoryMovement.findMany({
    where: {
      ...(filter.variantId ? { productVariantId: filter.variantId } : {}),
      ...(filter.movementType ? { movementType: filter.movementType } : {}),
      ...(filter.referenceType ? { referenceType: filter.referenceType } : {}),
      ...(filter.referenceId ? { referenceId: filter.referenceId } : {}),
      ...(filter.cursor ? { id: { gt: filter.cursor } } : {}),
    },
    orderBy: [{ id: "asc" as const }],
    take: filter.limit + 1,
  });
  return rows;
}

export function getMovement(id: string) {
  return prisma.inventoryMovement.findUnique({ where: { id } });
}

/** Variant context needed for step/unit/piece domain checks. */
export function getVariantStockContext(variantId: string) {
  return prisma.productVariant.findUnique({
    where: { id: variantId },
    select: {
      id: true,
      isActive: true,
      deletedAt: true,
      sizeUnit: true,
      product: {
        select: { id: true, productType: true, saleStepGrams: true, isActive: true, deletedAt: true },
      },
    },
  });
}
