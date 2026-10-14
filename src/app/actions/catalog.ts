// FE-3 paginated reads ("use server"): keyset append for listing/search pages.
// Same contracts as the initial RSC reads (bounded 12/page, enrichment capped).
// Cursor chains are append-only; page-1 URL stays canonical (no page numbers invented).

"use server";

import {
  listBrandProducts,
  listCategoryProducts,
  searchCatalogPaged,
  type HomeProductCard,
} from "@/lib/frontend/storefront-reads";
import type { ListingQuery } from "@/lib/frontend/listing-params";

export interface ListingPageResult {
  cards: HomeProductCard[];
  nextCursor: string | null;
}

export async function loadMoreCategory(
  categoryId: string,
  query: ListingQuery,
  cursor: string,
): Promise<ListingPageResult> {
  return listCategoryProducts(categoryId, query, cursor);
}

export async function loadMoreBrand(
  brandId: string,
  query: ListingQuery,
  cursor: string,
): Promise<ListingPageResult> {
  return listBrandProducts(brandId, query, cursor);
}

export async function loadMoreSearch(
  q: string,
  query: ListingQuery,
  cursor: string,
): Promise<ListingPageResult> {
  return searchCatalogPaged(q, query, cursor);
}
