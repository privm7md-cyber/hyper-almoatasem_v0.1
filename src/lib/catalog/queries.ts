// BA-2 catalog read domain (Prisma queries only, no writes).
//
// Every read states its visibility contract explicitly: storefront reads
// force active-only rows (is_active AND deleted_at IS NULL); admin reads
// take an explicit active filter. Sorting is stable (requested field + id
// tiebreak); pagination is cursor-over-id with a bounded limit.
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export interface ListParams {
  limit: number;
  cursor: string | null;
  sort: "name" | "created_at";
  dir: "asc" | "desc";
}

const ACTIVE_ONLY: Prisma.CategoryWhereInput = { isActive: true, deletedAt: null };

function cursorClause(cursor: string | null): { id: { gt: string } } | object {
  return cursor ? { id: { gt: cursor } } : {};
}

export async function listCategories(params: ListParams & { search: string | null; parent: string | null | undefined; active: boolean | null }) {
  const where: Prisma.CategoryWhereInput = {
    ...(params.active === null || params.active === undefined ? ACTIVE_ONLY : params.active ? { isActive: true } : { isActive: false }),
    ...(params.search ? { name: { contains: params.search, mode: "insensitive" } } : {}),
    ...(params.parent === undefined || params.parent === null
      ? {}
      : params.parent === "null"
        ? { parentId: null }
        : { parentId: params.parent }),
    ...cursorClause(params.cursor),
  };
  return prisma.category.findMany({
    where,
    orderBy:
      params.sort === "name"
        ? [{ name: params.dir }, { id: "asc" as const }]
        : [{ createdAt: params.dir }, { id: "asc" as const }],
    take: params.limit + 1,
  });
}

export function getCategory(id: string, includeInactive: boolean) {
  return prisma.category.findFirst({
    where: { id, ...(includeInactive ? {} : ACTIVE_ONLY) },
  });
}

export async function listBrands(params: ListParams & { search: string | null; active: boolean | null }) {
  const where: Prisma.BrandWhereInput = {
    ...(params.active === null || params.active === undefined ? { isActive: true, deletedAt: null } : params.active ? { isActive: true } : { isActive: false }),
    ...(params.search ? { name: { contains: params.search, mode: "insensitive" } } : {}),
    ...cursorClause(params.cursor),
  };
  return prisma.brand.findMany({
    where,
    orderBy:
      params.sort === "name"
        ? [{ name: params.dir }, { id: "asc" as const }]
        : [{ createdAt: params.dir }, { id: "asc" as const }],
    take: params.limit + 1,
  });
}

export function getBrand(id: string, includeInactive: boolean) {
  return prisma.brand.findFirst({
    where: { id, ...(includeInactive ? {} : { isActive: true, deletedAt: null }) },
  });
}

export type ProductListFilter = ListParams & {
  search: string | null;
  categoryId: string | null;
  brandId: string | null;
  productType: "PIECE" | "WEIGHT" | null;
  active: boolean | null;
};

export async function listProducts(filter: ProductListFilter) {
  const where: Prisma.ProductWhereInput = {
    ...(filter.active === null || filter.active === undefined
      ? { isActive: true, deletedAt: null }
      : filter.active
        ? { isActive: true }
        : { isActive: false }),
    ...(filter.search ? { name: { contains: filter.search, mode: "insensitive" } } : {}),
    ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
    ...(filter.brandId ? { brandId: filter.brandId } : {}),
    ...(filter.productType ? { productType: filter.productType } : {}),
    ...cursorClause(filter.cursor),
  };
  const orderBy: Prisma.ProductOrderByWithRelationInput[] =
    filter.sort === "name"
      ? [{ name: filter.dir }, { id: "asc" }]
      : [{ createdAt: filter.dir }, { id: "asc" }];
  return prisma.product.findMany({
    where,
    include: {
      category: { select: { id: true, name: true, slug: true } },
      brand: { select: { id: true, name: true, slug: true } },
    },
    orderBy,
    take: filter.limit + 1,
  });
}

export function getProduct(id: string, includeInactive: boolean) {
  return prisma.product.findFirst({
    where: { id, ...(includeInactive ? {} : { isActive: true, deletedAt: null }) },
    include: {
      category: { select: { id: true, name: true, slug: true } },
      brand: { select: { id: true, name: true, slug: true } },
    },
  });
}

export function listVariantsByProduct(productId: string, includeInactive: boolean, limit: number, cursor: string | null) {
  return prisma.productVariant.findMany({
    where: {
      productId,
      ...(includeInactive ? {} : { isActive: true, deletedAt: null }),
      ...cursorClause(cursor),
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: limit + 1,
  });
}

export function getVariant(id: string, includeInactive: boolean) {
  return prisma.productVariant.findFirst({
    where: { id, ...(includeInactive ? {} : { isActive: true, deletedAt: null }) },
  });
}

/** Cashier/scan path: global code UNIQUE resolves to exactly one variant.
 * Active-only for storefront; admin callers pass includeInactive. */
export function resolveProductCode(code: string, includeInactive: boolean) {
  return prisma.productCode.findFirst({
    where: {
      code,
      ...(includeInactive
        ? {}
        : { variant: { isActive: true, deletedAt: null, product: { isActive: true, deletedAt: null } } }),
    },
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
