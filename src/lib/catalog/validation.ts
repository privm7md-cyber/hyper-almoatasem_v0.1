// BA-2 catalog input validation (boundary layer, Zod only).
//
// Mirrors frozen CHECK shapes without re-owning them: the database remains
// the sole enforcer; these schemas reject malformed input early with 400.
// Business semantics (weight rules, step mirrors, price history) live in
// domain services (writes.ts), not here.
import { z } from "zod";
import { strictObject, uuidSchema, opaqueCursorSchema, paginationSchema } from "@/lib/api/validation";

/** Price-window wire shape: positive decimal text (domain binds semantics). */
const priceFilterSchema = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, { message: "Invalid price." })
  .refine((s) => Number(s) > 0, { message: "Invalid price." })
  .nullish();

/** Same pagination bounds as the shared schema, but with the BA-B2 opaque
 * keyset cursor instead of a raw UUID (cursor semantics live in
 * api/pagination.ts; malformed cursors answer 400 downstream). */
const catalogPageSchema = paginationSchema.extend({
  cursor: opaqueCursorSchema.nullish(),
});

const nameSchema = z.string().trim().min(1).max(160);
const slugInputSchema = z
  .string()
  .trim()
  .min(1)
  .max(180)
  .refine((s) => !/\s/.test(s), { message: "Invalid slug." });

/** Boundary slug normalization: trim → lowercase → whitespace runs to '-'.
 * Arabic letters survive (lower() is identity on them); symbols that would
 * violate the frozen slug CHECK are stripped. Stored values always satisfy
 * the DB CHECK; normalization never alters code/barcode strings. */
export function normalizeSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\u0600-\u06FF\-_]/g, "");
}

/** Query-string boolean: only exact "true"/"false" (z.coerce.boolean would
 * mistrue "false" via Boolean()). Routes map to boolean|null. */
export const queryBoolSchema = z.enum(["true", "false"]).nullish();

export function queryBool(value: "true" | "false" | null | undefined): boolean | null {
  if (value === null || value === undefined) return null;
  return value === "true";
}

const PRODUCT_TYPES = ["PIECE", "WEIGHT"] as const;
const SIZE_UNITS = ["PIECE", "KG", "GRAM", "LITER", "ML"] as const;
const CODE_TYPES = ["BARCODE", "INTERNAL_CODE"] as const;
const SORT_FIELDS = ["name", "created_at"] as const;
const SORT_DIRS = ["asc", "desc"] as const;

export const productTypeSchema = z.enum(PRODUCT_TYPES);
export const sizeUnitSchema = z.enum(SIZE_UNITS);
export const codeTypeSchema = z.enum(CODE_TYPES);

const sortSchema = z.object({
  sort: z.enum(SORT_FIELDS).default("created_at"),
  dir: z.enum(SORT_DIRS).default("desc"),
});

/** Variant listing: limit + opaque keyset cursor (fixed name-asc order). */
export const variantListQuerySchema = catalogPageSchema;

const SEARCH_SORTS = ["relevance", "newest"] as const;

/**
 * Storefront search query (BA-B3). q is required (empty → 400, never
 * list-all); min raw length 2 keeps single-char noise out. relevance
 * needs no separate flag — it is the default whenever q is present.
 * Cursor is the search keyset token (v:2), NOT the list cursor.
 */
export const searchQuerySchema = z.object({
  q: z.string().trim().min(2).max(120),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: opaqueCursorSchema.nullish(),
  sort: z.enum(SEARCH_SORTS).default("relevance"),
  category: uuidSchema.nullish(),
  brand: uuidSchema.nullish(),
  type: productTypeSchema.nullish(),
  minPrice: priceFilterSchema,
  maxPrice: priceFilterSchema,
  inStock: queryBoolSchema,
});

export const categoryListQuerySchema = catalogPageSchema.extend({
  ...sortSchema.shape,
  search: z.string().trim().max(120).nullish(),
  parent: z.union([uuidSchema, z.literal("null")]).nullish(),
  active: queryBoolSchema,
});

export const brandListQuerySchema = catalogPageSchema.extend({
  ...sortSchema.shape,
  search: z.string().trim().max(120).nullish(),
  active: queryBoolSchema,
});

export const productListQuerySchema = catalogPageSchema.extend({
  ...sortSchema.shape,
  search: z.string().trim().max(160).nullish(),
  category: uuidSchema.nullish(),
  brand: uuidSchema.nullish(),
  type: productTypeSchema.nullish(),
  active: queryBoolSchema,
  minPrice: priceFilterSchema,
  maxPrice: priceFilterSchema,
  inStock: queryBoolSchema,
});

export const categoryInputSchema = strictObject({
  name: nameSchema.max(120),
  slug: slugInputSchema.max(140).nullish(),
  description: z.string().max(2000).nullish(),
  image: z.string().trim().max(500).nullish(),
  parentId: uuidSchema.nullish(),
  sortOrder: z.number().int().min(0).nullish(),
  isActive: z.boolean().nullish(),
});

export const brandInputSchema = strictObject({
  name: nameSchema.max(120),
  slug: slugInputSchema.max(140).nullish(),
  logo: z.string().trim().max(500).nullish(),
  isActive: z.boolean().nullish(),
});

export const productInputSchema = strictObject({
  name: nameSchema,
  slug: slugInputSchema.max(180).nullish(),
  description: z.string().max(4000).nullish(),
  categoryId: uuidSchema,
  brandId: uuidSchema.nullish(),
  productType: productTypeSchema,
  unit: sizeUnitSchema,
  saleStepGrams: z.number().int().positive().nullish(),
  isActive: z.boolean().nullish(),
});

export const productPatchSchema = strictObject({
  name: nameSchema.nullish(),
  slug: slugInputSchema.max(180).nullish(),
  description: z.string().max(4000).nullish(),
  categoryId: uuidSchema.nullish(),
  brandId: uuidSchema.nullish(),
  isActive: z.boolean().nullish(),
});

export const variantInputSchema = strictObject({
  productId: uuidSchema,
  name: z.string().trim().min(1).max(120),
  sizeValue: z.string().regex(/^\d+(\.\d{1,3})?$/).nullish(),
  sizeUnit: sizeUnitSchema.nullish(),
  price: z.string().regex(/^\d+(\.\d{1,2})?$/),
  compareAtPrice: z.string().regex(/^\d+(\.\d{1,2})?$/).nullish(),
  costPrice: z.string().regex(/^\d+(\.\d{1,2})?$/).nullish(),
  isActive: z.boolean().nullish(),
});

export const variantPriceInputSchema = strictObject({
  price: z.string().regex(/^\d+(\.\d{1,2})?$/),
  reason: z.string().trim().max(500).nullish(),
});

/** Code/barcode wire shape: trimmed, case preserved (codes are
 * case-sensitive per the global UNIQUE). Mirrors the frozen CHECK
 * (non-empty, no whitespace); the database remains the enforcer. */
export const codeStringSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((s) => !/\s/.test(s), { message: "Invalid code." });

export const codeInputSchema = strictObject({
  productVariantId: uuidSchema,
  code: codeStringSchema,
  type: codeTypeSchema,
  isPrimary: z.boolean().nullish(),
});

export const codePatchSchema = strictObject({
  type: codeTypeSchema.nullish(),
  isPrimary: z.boolean().nullish(),
});

export const codeLookupQuerySchema = z.object({
  code: codeStringSchema,
});

export const activePatchSchema = strictObject({
  isActive: z.boolean(),
});

const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"] as const;

/**
 * Media reference wire shape (BA-B4): metadata ONLY, never binary. URL must
 * be absolute https (blocks javascript:/data:/http injection + bare paths —
 * storage internals never leak to clients). SVG excluded at the DB CHECK.
 */
export const imageUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .refine(
    (s) => {
      try {
        return new URL(s).protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "Invalid image URL." },
  );

export const imageInputSchema = strictObject({
  url: imageUrlSchema,
  altText: z.string().trim().max(200).nullish(),
  mimeType: z.enum(IMAGE_MIMES).nullish(),
  byteSize: z.number().int().positive().nullish(),
  width: z.number().int().positive().nullish(),
  height: z.number().int().positive().nullish(),
  sortOrder: z.number().int().nullish(),
  isPrimary: z.boolean().nullish(),
});

export const imagePatchSchema = strictObject({
  altText: z.string().trim().max(200).nullish(),
  sortOrder: z.number().int().nullish(),
  isPrimary: z.boolean().nullish(),
});

export type CategoryInput = z.infer<typeof categoryInputSchema>;
export type BrandInput = z.infer<typeof brandInputSchema>;
export type ProductInput = z.infer<typeof productInputSchema>;
export type VariantInput = z.infer<typeof variantInputSchema>;
