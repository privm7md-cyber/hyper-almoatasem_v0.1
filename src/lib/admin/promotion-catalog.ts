// ADM-07 — the catalogue the owner picks an offer's products from.
//
// A read-only loader over the SAME catalogue the storefront reads: active,
// not-deleted products with their own sellable variants, prices and images.
// The rows are plain data; the presentational part lives in the component.

import "server-only";

import { prisma } from "@/lib/db";
import { listPrimaryImagesForProducts } from "@/lib/catalog/media";

export interface PromotionCatalogRow {
  id: string;
  name: string;
  brandName: string | null;
  /** Cheapest sellable variant price, as EGP text (null when unknown). */
  price: string | null;
  variantCount: number;
  imageUrl: string | null;
}

const PAGE_LIMIT = 20;

export async function loadPromotionCatalog(search: string): Promise<PromotionCatalogRow[]> {
  const q = search.trim().slice(0, 80);
  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      deletedAt: null,
      ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: PAGE_LIMIT,
    select: {
      id: true,
      name: true,
      brand: { select: { name: true } },
      variants: {
        where: { isActive: true, deletedAt: null },
        orderBy: [{ price: "asc" }, { name: "asc" }],
        select: { price: true },
      },
    },
  });

  const images = await listPrimaryImagesForProducts(products.map((p) => p.id)).catch(() => new Map());

  return products.map((product) => ({
    id: product.id,
    name: product.name,
    brandName: product.brand?.name ?? null,
    price: product.variants[0]?.price ? product.variants[0].price.toString() : null,
    variantCount: product.variants.length,
    imageUrl: images.get(product.id)?.url ?? null,
  }));
}
