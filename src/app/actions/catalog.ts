// FE-3 paginated reads ("use server"): keyset append for listing/search pages.
// Same contracts as the initial RSC reads (bounded 12/page, enrichment capped).
// Cursor chains are append-only; page-1 URL stays canonical (no page numbers invented).
// P12-07 SEC-02: Server Actions are public POST endpoints; every argument is
// schema-validated at runtime before reaching Prisma or raw SQL.

"use server";

import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { opaqueCursorSchema, strictObject, uuidSchema } from "@/lib/api/validation";
import {
  listBrandProducts,
  listCategoryProducts,
  searchCatalogPaged,
  type HomeProductCard,
} from "@/lib/frontend/storefront-reads";
import { hasReversedPriceWindow, type ListingQuery } from "@/lib/frontend/listing-params";

const priceBoundSchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/)
  .refine((v) => Number(v) > 0)
  .nullable();

const listingQuerySchema = strictObject({
  sort: z.enum(["name", "created_at", "relevance", "newest"]),
  dir: z.enum(["asc", "desc"]),
  type: z.enum(["PIECE", "WEIGHT"]).nullable(),
  inStock: z.boolean().nullable(),
  minPrice: priceBoundSchema,
  maxPrice: priceBoundSchema,
  brandId: uuidSchema.nullable(),
  categoryId: uuidSchema.nullable(),
  q: z.string().trim().max(120).nullable(),
}).refine((q) => !hasReversedPriceWindow(q), { message: "Invalid price window." });

const searchTextSchema = z.string().trim().min(2).max(120);

function parseActionQuery(raw: unknown): ListingQuery {
  const parsed = listingQuerySchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError("VALIDATION", "Invalid listing query.");
  }
  return parsed.data;
}

function parseActionCursor(raw: unknown): string {
  const parsed = opaqueCursorSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError("VALIDATION", "Invalid pagination cursor.");
  }
  return parsed.data;
}

function parseActionUuid(raw: unknown, label: string): string {
  const parsed = uuidSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError("VALIDATION", `Invalid ${label}.`);
  }
  return parsed.data;
}

export interface ListingPageResult {
  cards: HomeProductCard[];
  nextCursor: string | null;
}

export async function loadMoreCategory(
  categoryId: string,
  query: ListingQuery,
  cursor: string,
): Promise<ListingPageResult> {
  const safeCategoryId = parseActionUuid(categoryId, "category id");
  const safeQuery = parseActionQuery(query);
  const safeCursor = parseActionCursor(cursor);
  return listCategoryProducts(safeCategoryId, safeQuery, safeCursor);
}

export async function loadMoreBrand(
  brandId: string,
  query: ListingQuery,
  cursor: string,
): Promise<ListingPageResult> {
  const safeBrandId = parseActionUuid(brandId, "brand id");
  const safeQuery = parseActionQuery(query);
  const safeCursor = parseActionCursor(cursor);
  return listBrandProducts(safeBrandId, safeQuery, safeCursor);
}

export async function loadMoreSearch(
  q: string,
  query: ListingQuery,
  cursor: string,
): Promise<ListingPageResult> {
  const parsedQ = searchTextSchema.safeParse(q);
  if (!parsedQ.success) {
    throw new ApiError("VALIDATION", "Invalid search query.");
  }
  const safeQuery = parseActionQuery(query);
  const safeCursor = parseActionCursor(cursor);
  return searchCatalogPaged(parsedQ.data, safeQuery, safeCursor);
}
