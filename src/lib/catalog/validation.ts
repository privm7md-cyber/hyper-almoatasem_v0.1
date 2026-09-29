// BA-2 catalog input validation (boundary layer, Zod only).
//
// Mirrors frozen CHECK shapes without re-owning them: the database remains
// the sole enforcer; these schemas reject malformed input early with 400.
// Business semantics (weight rules, step mirrors, price history) live in
// domain services (writes.ts), not here.
import { z } from "zod";
import { uuidSchema, paginationSchema } from "@/lib/api/validation";

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

export const categoryListQuerySchema = paginationSchema.extend({
  ...sortSchema.shape,
  search: z.string().trim().max(120).nullish(),
  parent: z.union([uuidSchema, z.literal("null")]).nullish(),
  active: queryBoolSchema,
});

export const brandListQuerySchema = paginationSchema.extend({
  ...sortSchema.shape,
  search: z.string().trim().max(120).nullish(),
  active: queryBoolSchema,
});

export const productListQuerySchema = paginationSchema.extend({
  ...sortSchema.shape,
  search: z.string().trim().max(160).nullish(),
  category: uuidSchema.nullish(),
  brand: uuidSchema.nullish(),
  type: productTypeSchema.nullish(),
  active: queryBoolSchema,
});

export const categoryInputSchema = z.object({
  name: nameSchema.max(120),
  slug: slugInputSchema.max(140).nullish(),
  description: z.string().max(2000).nullish(),
  image: z.string().trim().max(500).nullish(),
  parentId: uuidSchema.nullish(),
  sortOrder: z.number().int().min(0).nullish(),
  isActive: z.boolean().nullish(),
});

export const brandInputSchema = z.object({
  name: nameSchema.max(120),
  slug: slugInputSchema.max(140).nullish(),
  logo: z.string().trim().max(500).nullish(),
  isActive: z.boolean().nullish(),
});

export const productInputSchema = z.object({
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

export const productPatchSchema = z.object({
  name: nameSchema.nullish(),
  slug: slugInputSchema.max(180).nullish(),
  description: z.string().max(4000).nullish(),
  categoryId: uuidSchema.nullish(),
  brandId: uuidSchema.nullish(),
  isActive: z.boolean().nullish(),
});

export const variantInputSchema = z.object({
  productId: uuidSchema,
  name: z.string().trim().min(1).max(120),
  sizeValue: z.string().regex(/^\d+(\.\d{1,3})?$/).nullish(),
  sizeUnit: sizeUnitSchema.nullish(),
  price: z.string().regex(/^\d+(\.\d{1,2})?$/),
  compareAtPrice: z.string().regex(/^\d+(\.\d{1,2})?$/).nullish(),
  costPrice: z.string().regex(/^\d+(\.\d{1,2})?$/).nullish(),
  isActive: z.boolean().nullish(),
});

export const variantPriceInputSchema = z.object({
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

export const codeInputSchema = z.object({
  productVariantId: uuidSchema,
  code: codeStringSchema,
  type: codeTypeSchema,
  isPrimary: z.boolean().nullish(),
});

export const codePatchSchema = z.object({
  type: codeTypeSchema.nullish(),
  isPrimary: z.boolean().nullish(),
});

export const codeLookupQuerySchema = z.object({
  code: codeStringSchema,
});

export const activePatchSchema = z.object({
  isActive: z.boolean(),
});

export type CategoryInput = z.infer<typeof categoryInputSchema>;
export type BrandInput = z.infer<typeof brandInputSchema>;
export type ProductInput = z.infer<typeof productInputSchema>;
export type VariantInput = z.infer<typeof variantInputSchema>;
