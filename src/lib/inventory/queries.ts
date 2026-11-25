// BA-3 inventory read domain.
//
// Prisma owns representable reads (inventory rows, variants, movements,
// taxonomy). Raw SQL owns the product_stock_status VIEW (no Prisma model)
// and any read that must observe GENERATED values without drift. No read
// here mutates state; availability is always the DB GENERATED value.
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { ApiError } from "@/lib/api/errors";
import { uuidSchema } from "@/lib/api/validation";
import type { ProductStockCoverage } from "./stock-coverage";

export interface InventoryListFilter {
  limit: number;
  cursor: string | null;
  search: string | null;
  productId: string | null;
  inStock: boolean | null;
  lowStock: boolean | null;
  /** Stock status token — filtered in SQL, never in the page. */
  status?: "in_stock" | "low_stock" | "out_of_stock" | null;
  /** "id" keeps the legacy order; "product_name" groups the rows by product. */
  order?: "id" | "product_name";
}

/**
 * Stock status as a SQL predicate. The low-stock rule compares a row's own
 * available quantity with its own threshold, so it can only run in the
 * database — a field reference keeps that comparison row-local.
 */
function statusWhere(status: "in_stock" | "low_stock" | "out_of_stock"): Prisma.InventoryWhereInput {
  if (status === "out_of_stock") return { availableQuantity: { lte: 0 } };
  if (status === "low_stock") {
    return {
      availableQuantity: { gt: 0, lte: prisma.inventory.fields.lowStockThreshold },
      lowStockThreshold: { not: null },
    };
  }
  return {
    OR: [
      { lowStockThreshold: { equals: null }, availableQuantity: { gt: 0 } },
      { availableQuantity: { gt: prisma.inventory.fields.lowStockThreshold } },
    ],
  };
}

/**
 * The name of the product the cursor row belongs to. The admin order is
 * (product name, id), so the keyset needs both halves of the last row.
 */
async function cursorProductName(cursor: string, scope: Prisma.InventoryWhereInput[]): Promise<string> {
  if (!uuidSchema.safeParse(cursor).success) throw new ApiError("VALIDATION", "Invalid pagination cursor.");
  const anchor = await prisma.inventory.findFirst({
    where: { AND: [...scope, { id: cursor }] },
    select: { variant: { select: { product: { select: { name: true } } } } },
  });
  if (!anchor) throw new ApiError("VALIDATION", "Invalid pagination cursor.", null);
  return anchor.variant.product.name;
}

/** Admin inventory list (Prisma). The cursor is the id of the last row the
 * operator saw; with the product-name order the keyset compares the product
 * name first and the id as the tie-break, so no row is skipped or repeated.
 * Filters map onto stored columns only — available filtering uses the
 * GENERATED column directly in SQL (no JS math). */
export async function listInventory(filter: InventoryListFilter) {
  const and: Prisma.InventoryWhereInput[] = [];

  if (filter.productId) and.push({ variant: { productId: filter.productId } });

  if (filter.search) {
    and.push({
      OR: [
        { variant: { product: { name: { contains: filter.search, mode: "insensitive" } } } },
        { variant: { name: { contains: filter.search, mode: "insensitive" } } },
        { variant: { codes: { some: { code: { contains: filter.search, mode: "insensitive" } } } } },
      ],
    });
  }

  if (filter.inStock === true) and.push({ availableQuantity: { gt: 0 } });
  if (filter.inStock === false) and.push({ availableQuantity: { lte: 0 } });
  if (filter.status) and.push(statusWhere(filter.status));
  if (filter.lowStock === true) and.push(statusWhere("low_stock"));
  if (filter.lowStock === false) and.push({ OR: [
    { availableQuantity: { equals: null } },
    { availableQuantity: { lte: 0 } },
    { lowStockThreshold: { equals: null } },
    { availableQuantity: { gt: prisma.inventory.fields.lowStockThreshold } },
  ] });

  const byProductName = filter.order === "product_name";
  if (filter.cursor) {
    const name = await cursorProductName(filter.cursor, and);
    if (byProductName) {
      and.push({
        OR: [
          { variant: { product: { name: { gt: name } } } },
          { AND: [{ variant: { product: { name } } }, { id: { gt: filter.cursor } }] },
        ],
      });
    } else {
      and.push({ id: { gt: filter.cursor } });
    }
  }

  const orderBy: Prisma.InventoryOrderByWithRelationInput[] = byProductName
    ? [{ variant: { product: { name: "asc" } } }, { id: "asc" }]
    : [{ id: "asc" }];

  const rows = await prisma.inventory.findMany({
    where: and.length ? { AND: and } : {},
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
    orderBy,
    take: filter.limit + 1,
  });
  return rows; // every predicate precedes take+1; never filter a fetched page
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

/** Whether the product has ANY inventory row at all. Import honesty: the
 * catalog ships without inventory data, so absence of rows must render as
 * "unknown" on storefront cards — never the view's collapsed is_in_stock
 * false, which would claim "غير متوفر" without an owner-side stock decision. */
export async function productHasInventoryRows(productId: string): Promise<boolean> {
  const count = await prisma.inventory.count({ where: { variant: { productId } } });
  return count > 0;
}

/**
 * Whether the catalog carries ANY inventory data at all (Phase 07 D02).
 *
 * Programmatic availability signal for the storefront: while no inventory row
 * exists, every product's availability is UNKNOWN, and the "in stock only"
 * filter cannot honour its promise (it would return an empty listing for the
 * whole store). The listing pages pass this down so the filter can be shown
 * as unavailable — with the reason — instead of silently emptying results.
 */
export async function hasAnyInventoryRows(): Promise<boolean> {
  const row = await prisma.inventory.findFirst({ select: { id: true } });
  return row !== null;
}

/** Raw-SQL read of the frozen product_stock_status VIEW (no Prisma model).
 * Single definition of "product in stock" (REVIEW-02). */
export async function getProductStockStatus(productId: string): Promise<ProductStockCoverage | null> {
  const rows = await prisma.$queryRaw<Array<{
    product_id: string;
    sellable_variants: bigint;
    known_sellable_balances: bigint;
    in_stock_variants: bigint;
    is_in_stock: boolean | null;
  }>>`SELECT s.product_id, s.sellable_variants, s.in_stock_variants, s.is_in_stock,
        (SELECT COUNT(*) FROM product_variants v JOIN inventory i ON i.product_variant_id = v.id
         WHERE v.product_id = s.product_id AND v.is_active AND v.deleted_at IS NULL
           AND i.available_quantity IS NOT NULL) AS known_sellable_balances
        FROM product_stock_status s WHERE s.product_id = ${productId}::uuid`;
  const row = rows[0];
  if (!row) return null;
  return {
    productId: row.product_id,
    sellableVariants: Number(row.sellable_variants),
    knownSellableBalances: Number(row.known_sellable_balances),
    inStockVariants: Number(row.in_stock_variants),
    isInStock: row.is_in_stock === true,
  };
}

/**
 * Batch-fetch inventory presence + product_stock_status for a bounded list of
 * product IDs in TWO queries total instead of 2*N (BUG-09 N+1 remediation).
 */
export async function getProductsStockBatch(productIds: string[]): Promise<{
  hasInventorySet: Set<string>;
  statusByProduct: Map<string, ProductStockCoverage> | null;
}> {
  if (productIds.length === 0) {
    return { hasInventorySet: new Set(), statusByProduct: new Map() };
  }
  const [invRows, statusRows] = await Promise.all([
    prisma
      .$queryRaw<Array<{ product_id: string }>>`
        SELECT DISTINCT v.product_id::text AS product_id
        FROM inventory i
        JOIN product_variants v ON v.id = i.product_variant_id
        WHERE v.product_id = ANY(${productIds}::uuid[])
      `
      .catch(() => [] as Array<{ product_id: string }>),
    prisma
      .$queryRaw<
        Array<{
          product_id: string;
          sellable_variants: bigint;
          known_sellable_balances: bigint;
          in_stock_variants: bigint;
          is_in_stock: boolean | null;
        }>
      >`
        SELECT s.product_id::text AS product_id, s.sellable_variants, s.in_stock_variants, s.is_in_stock,
          (SELECT COUNT(*) FROM product_variants v JOIN inventory i ON i.product_variant_id = v.id
           WHERE v.product_id = s.product_id AND v.is_active AND v.deleted_at IS NULL
             AND i.available_quantity IS NOT NULL) AS known_sellable_balances
        FROM product_stock_status s
        WHERE s.product_id = ANY(${productIds}::uuid[])
      `
      .catch(() => null),
  ]);
  const hasInventorySet = new Set(invRows.map((r) => r.product_id));
  if (statusRows === null) {
    return { hasInventorySet, statusByProduct: null };
  }
  const statusByProduct = new Map<string, ProductStockCoverage>();
  for (const row of statusRows) {
    statusByProduct.set(row.product_id, {
      productId: row.product_id,
      sellableVariants: Number(row.sellable_variants),
      knownSellableBalances: Number(row.known_sellable_balances),
      inStockVariants: Number(row.in_stock_variants),
      isInStock: row.is_in_stock === true,
    });
  }
  return { hasInventorySet, statusByProduct };
}

export interface MovementListFilter {
  limit: number;
  cursor: string | null;
  variantId: string | null;
  movementType: string | null;
  referenceType: string | null;
  referenceId: string | null;
  productId?: string | null;
  categoryId?: string | null;
  brandId?: string | null;
  productType?: "PIECE" | "WEIGHT" | null;
  search?: string | null;
  /** "id" keeps the legacy order; "recent" returns the newest movement first. */
  order?: "id" | "recent";
}

async function validateMovementCursor(cursor: string, scope: Prisma.InventoryMovementWhereInput[]): Promise<void> {
  if (!uuidSchema.safeParse(cursor).success) throw new ApiError("VALIDATION", "Invalid pagination cursor.");
  const anchor = await prisma.inventoryMovement.findFirst({
    where: { AND: [...scope, { id: cursor }] },
    select: { id: true },
  });
  if (!anchor) throw new ApiError("VALIDATION", "Invalid pagination cursor.", null);
}

export async function listMovements(filter: MovementListFilter) {
  const and: Prisma.InventoryMovementWhereInput[] = [];
  if (filter.variantId) and.push({ productVariantId: filter.variantId });
  if (filter.movementType) and.push({ movementType: filter.movementType });
  if (filter.referenceType) and.push({ referenceType: filter.referenceType });
  if (filter.referenceId) and.push({ referenceId: filter.referenceId });
  if (filter.productId) and.push({ variant: { productId: filter.productId } });
  if (filter.categoryId) and.push({ variant: { product: { categoryId: filter.categoryId } } });
  if (filter.brandId) and.push({ variant: { product: { brandId: filter.brandId } } });
  if (filter.productType) and.push({ variant: { product: { productType: filter.productType } } });
  if (filter.search) and.push({ OR: [
    { variant: { name: { contains: filter.search, mode: "insensitive" } } },
    { variant: { product: { name: { contains: filter.search, mode: "insensitive" } } } },
    { variant: { codes: { some: { code: { contains: filter.search, mode: "insensitive" } } } } },
  ] });

  const recent = filter.order === "recent";
  if (filter.cursor) await validateMovementCursor(filter.cursor, and);

  const orderBy: Prisma.InventoryMovementOrderByWithRelationInput[] = recent
    ? [{ createdAt: "desc" }, { id: "desc" }]
    : [{ id: "asc" }];

  const rows = await prisma.inventoryMovement.findMany({
    where: and.length ? { AND: and } : {},
    // Keep the timestamp comparison inside PostgreSQL, not millisecond JS Dates.
    ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
    include: {
      variant: {
        select: {
          id: true,
          name: true,
          sizeUnit: true,
          product: { select: { id: true, name: true, slug: true, productType: true } },
        },
      },
    },
    orderBy,
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
