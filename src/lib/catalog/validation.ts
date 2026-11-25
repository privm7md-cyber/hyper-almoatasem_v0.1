// BA-2 catalog input validation (boundary layer, Zod only).
//
// Mirrors frozen CHECK shapes without re-owning them: the database remains
// the sole enforcer; these schemas reject malformed input early with 400.
// Business semantics (weight rules, step mirrors, price history) live in
// domain services (writes.ts), not here.
import { z } from "zod";
import { strictObject, uuidSchema, opaqueCursorSchema, paginationSchema } from "@/lib/api/validation";
import { isValidPriceText } from "@/lib/catalog/price";

// P12-07 SEC-07: Disable Zod v4 `new Function("")` JIT codegen probe so client
// components importing catalog schemas (e.g., ProductImageManager on
// /admin/products/[id]) never trigger CSP `script-src: eval` violations.
z.config({ jitless: true });

function isDisallowedAssetHost(rawHostname: string): boolean {
  const h = rawHostname.toLowerCase();
  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h === "0.0.0.0" ||
    h === "[::1]" ||
    h === "[::]" ||
    /^\[(fc|fd)[0-9a-f]{0,2}:/i.test(h) ||
    /^\[fe[89ab][0-9a-f]:/i.test(h)
  ) {
    return true;
  }
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  return false;
}

function isSafeHttpsAssetUrl(s: string): boolean {
  if (/[\s\u0000-\u001f]/.test(s)) return false;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:") return false;
    if (u.username !== "" || u.password !== "") return false;
    if (!u.hostname || isDisallowedAssetHost(u.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * P12-07 SEC-08: Safe asset reference for category.image / brand.logo.
 * Accepts either a safe `https://` URL (no embedded credentials, no loopback/private/metadata IP)
 * or a clean root-relative path (`/assets/...`), blocking `javascript:`, `data:`, `vbscript:`,
 * `file:`, `http:`, and protocol-relative `//` / `/\` references.
 */
export const catalogAssetRefSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine(
    (s) => {
      if (/[\s\u0000-\u001f\\]/.test(s)) return false;
      if (s.startsWith("/")) {
        const lower = s.toLowerCase();
        return !lower.startsWith("//") && !lower.startsWith("/%2f") && !lower.startsWith("/%5c");
      }
      return isSafeHttpsAssetUrl(s);
    },
    { message: "Invalid asset URL." },
  );

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
/** Product sale/inventory unit (L3 Direction A): the closed sale model is
 * PIECE/KG/GRAM only (frozen weight rule + OpenAPI contract). LITER/ML stay
 * in `sizeUnitSchema` for descriptive variant package-size metadata — they
 * are never valid product sale units, so they are rejected here at the
 * boundary (400, like every other malformed enum input) instead of reaching
 * the domain weight rule (422). */
export const productUnitSchema = z.enum(["PIECE", "KG", "GRAM"] as const);
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
  image: catalogAssetRefSchema.nullish(),
  parentId: uuidSchema.nullish(),
  sortOrder: z.number().int().min(0).nullish(),
  isActive: z.boolean().nullish(),
});

export const brandInputSchema = strictObject({
  name: nameSchema.max(120),
  slug: slugInputSchema.max(140).nullish(),
  logo: catalogAssetRefSchema.nullish(),
  isActive: z.boolean().nullish(),
});

export const productInputSchema = strictObject({
  name: nameSchema,
  slug: slugInputSchema.max(180).nullish(),
  description: z.string().max(4000).nullish(),
  categoryId: uuidSchema,
  brandId: uuidSchema.nullish(),
  productType: productTypeSchema,
  unit: productUnitSchema,
  saleStepGrams: z.number().int().positive().nullish(),
  isActive: z.boolean().nullish(),
});

export const productPatchSchema = strictObject({
  // name/categoryId/isActive are optional-only: explicit null has no
  // clear-semantic on non-nullable columns (it 500s in Prisma), so the
  // boundary rejects it with 400. Nullable columns keep nullish (null clears).
  name: nameSchema.optional(),
  slug: slugInputSchema.max(180).nullish(),
  description: z.string().max(4000).nullish(),
  categoryId: uuidSchema.optional(),
  brandId: uuidSchema.nullish(),
  isActive: z.boolean().optional(),
  // GD-2 / BL-02 (owner-approved package, 2026-11-01): the sale-usage fields
  // become patchable. productType/unit are optional-only (non-nullable
  // columns — null is a 400); saleStepGrams is nullish (null clears the
  // nullable column, absent leaves it). The TWO-LEGAL-STATES transition rule
  // (chk_products_weight_rule) is enforced in the domain service against the
  // LOCKED prior state — 422 before any write; the DB CHECK remains the
  // final enforcer. The concurrency token is accepted in the body
  // (`expectedUpdatedAt`) as well as the `If-Match` header (header wins);
  // it is metadata, never a product field, and is stripped before the write.
  productType: productTypeSchema.optional(),
  unit: productUnitSchema.optional(),
  saleStepGrams: z.number().int().positive().nullish(),
  expectedUpdatedAt: z.string().trim().min(1).max(40).optional(),
});

/** Variant PATCH shape: name/isActive are optional-only (non-nullable
 * columns); size/compare/cost stay nullish (null clears the nullable column). */
/**
 * Price-shaped text (same rule as `variantPriceInputSchema`): plain
 * non-negative decimal, exactly representable at the approved precision.
 */
const priceTextSchema = z
  .string()
  .regex(/^\d+(\.\d{1,3})?$/, { message: "Invalid price." })
  .refine((s) => isValidPriceText(s), { message: "Invalid price." });

export const variantPatchSchema = strictObject({
  name: z.string().trim().min(1).max(120).optional(),
  sizeValue: z.string().regex(/^\d+(\.\d{1,3})?$/).nullish(),
  sizeUnit: sizeUnitSchema.nullish(),
  compareAtPrice: priceTextSchema.nullish(),
  costPrice: priceTextSchema.nullish(),
  isActive: z.boolean().optional(),
});

/** Category PATCH shape: name/sortOrder/isActive are optional-only
 * (non-nullable columns); slug null leaves the slug untouched, nullable
 * columns clear on null. */
export const categoryPatchSchema = strictObject({
  name: nameSchema.max(120).optional(),
  slug: slugInputSchema.max(140).nullish(),
  description: z.string().max(2000).nullish(),
  image: catalogAssetRefSchema.nullish(),
  parentId: uuidSchema.nullish(),
  sortOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

/** Brand PATCH shape: name/isActive are optional-only (non-nullable
 * columns); slug null leaves the slug untouched, logo clears on null. */
export const brandPatchSchema = strictObject({
  name: nameSchema.max(120).optional(),
  slug: slugInputSchema.max(140).nullish(),
  logo: catalogAssetRefSchema.nullish(),
  isActive: z.boolean().optional(),
});

export const variantInputSchema = strictObject({
  productId: uuidSchema,
  name: z.string().trim().min(1).max(120),
  sizeValue: z.string().regex(/^\d+(\.\d{1,3})?$/).nullish(),
  sizeUnit: sizeUnitSchema.nullish(),
  price: priceTextSchema,
  compareAtPrice: priceTextSchema.nullish(),
  costPrice: priceTextSchema.nullish(),
  isActive: z.boolean().nullish(),
});

/**
 * Selling price wire shape.
 *
 * The column is NUMERIC(10,2): two approved fraction digits. The text may
 * carry up to three digits, but a value that is NOT exactly representable at
 * the approved precision ("15.005") is rejected here instead of being
 * silently rounded. "15", "15.00" and "15.000" are all accepted and denote
 * the SAME price — the no-change comparison is numeric (see
 * `src/lib/catalog/price.ts` and `updateVariantPrice`), never a text compare.
 */
export const variantPriceInputSchema = strictObject({
  price: z
    .string()
    .regex(/^\d+(\.\d{1,3})?$/, { message: "Invalid price." })
    .refine((s) => isValidPriceText(s), { message: "Invalid price." }),
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
  // type is optional-only: null has no rename-semantic on the non-nullable
  // enum column (it 500s in Prisma), so the boundary rejects it with 400.
  type: codeTypeSchema.optional(),
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
  .refine((s) => isSafeHttpsAssetUrl(s), { message: "Invalid image URL." });

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
