// BA-3 inventory input validation (boundary layer, Zod only).
//
// Mirrors frozen CHECK shapes without re-owning them: the database remains
// the sole enforcer; these schemas reject malformed input early with 400.
// Business semantics (step multiples, R7 envelope, counting units) live in
// domain services (service.ts), not here.
//
// Quantity wire format: decimal strings, never floats. Positive quantities
// match /^\d+(\.\d{1,3})?$/ (NUMERIC(12,3) shape); adjust deltas are signed.
import { z } from "zod";
import { uuidSchema, paginationSchema } from "../api/validation";

/** Positive quantity wire shape: NUMERIC(12,3) text, > 0. */
export const positiveQtySchema = z
  .string()
  .regex(/^\d+(\.\d{1,3})?$/, { message: "Invalid quantity." })
  .refine((s) => Number(s) > 0, { message: "Invalid quantity." });

/** Signed delta wire shape for stock adjustments: NUMERIC(12,3) text, != 0. */
export const signedQtySchema = z
  .string()
  .regex(/^-?\d+(\.\d{1,3})?$/, { message: "Invalid quantity." })
  .refine((s) => Number(s) !== 0, { message: "Invalid quantity." });

/** Threshold wire shape: >= 0, up to 3 decimals (NULL clears). */
export const thresholdSchema = z
  .string()
  .regex(/^\d+(\.\d{1,3})?$/, { message: "Invalid threshold." })
  .refine((s) => Number(s) >= 0, { message: "Invalid threshold." });

/** Query-string boolean: only exact "true"/"false" (never z.coerce.boolean). */
export const queryBoolSchema = z.enum(["true", "false"]).nullish();

export function queryBool(value: "true" | "false" | null | undefined): boolean | null {
  if (value === null || value === undefined) return null;
  return value === "true";
}

const MOVEMENT_TYPES = [
  "STOCK_IN",
  "SALE",
  "RETURN",
  "WASTE",
  "ADJUSTMENT",
  "REPLACEMENT",
  "CANCELLED_ORDER",
] as const;

const REFERENCE_TYPES = ["ORDER", "PURCHASE", "RETURN", "ADJUSTMENT", "MANUAL"] as const;

/** Admin-adjust allowlist: order-lifecycle types are NOT writable here.
 * SALE / CANCELLED_ORDER / REPLACEMENT belong to BA-6/BA-7 flows only. */
const ADJUST_MOVEMENT_TYPES = ["STOCK_IN", "ADJUSTMENT", "WASTE", "RETURN"] as const;

export const movementTypeSchema = z.enum(MOVEMENT_TYPES);
export const adjustMovementTypeSchema = z.enum(ADJUST_MOVEMENT_TYPES);
export const referenceTypeSchema = z.enum(REFERENCE_TYPES);

export const inventoryListQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(120).nullish(),
  productId: uuidSchema.nullish(),
  inStock: queryBoolSchema,
  lowStock: queryBoolSchema,
});

export const movementListQuerySchema = paginationSchema.extend({
  variantId: uuidSchema.nullish(),
  movementType: movementTypeSchema.nullish(),
  referenceType: referenceTypeSchema.nullish(),
  referenceId: z.string().trim().min(1).max(64).nullish(),
});

export const adjustInputSchema = z
  .object({
    productVariantId: uuidSchema,
    delta: signedQtySchema,
    movementType: adjustMovementTypeSchema,
    referenceType: referenceTypeSchema.nullish(),
    referenceId: z.string().trim().min(1).max(64).nullish(),
    reason: z.string().trim().max(2000).nullish(),
  })
  .strict()
  .refine((v) => v.referenceId == null || v.referenceType != null, {
    message: "referenceId requires referenceType.",
    path: ["referenceType"],
  });

export const reserveInputSchema = z
  .object({
    productVariantId: uuidSchema,
    quantity: positiveQtySchema,
  })
  .strict();

export const releaseInputSchema = z
  .object({
    productVariantId: uuidSchema,
    quantity: positiveQtySchema,
  })
  .strict();

export const commitInputSchema = z
  .object({
    productVariantId: uuidSchema,
    requested: positiveQtySchema,
    actual: positiveQtySchema,
    referenceType: referenceTypeSchema.nullish(),
    referenceId: z.string().trim().min(1).max(64).nullish(),
    reason: z.string().trim().max(2000).nullish(),
  })
  .strict()
  .refine((v) => v.referenceId == null || v.referenceType != null, {
    message: "referenceId requires referenceType.",
    path: ["referenceType"],
  });

export const thresholdPatchSchema = z
  .object({
    lowStockThreshold: thresholdSchema.nullable(),
  })
  .strict();

export type AdjustInput = z.infer<typeof adjustInputSchema>;
export type ReserveInput = z.infer<typeof reserveInputSchema>;
export type ReleaseInput = z.infer<typeof releaseInputSchema>;
export type CommitInput = z.infer<typeof commitInputSchema>;
