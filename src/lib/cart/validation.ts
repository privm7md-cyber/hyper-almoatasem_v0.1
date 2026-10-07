// BA-5 cart input validation (boundary layer, Zod only).
//
// Mirrors frozen CHECK shapes without re-owning them: the database remains
// the sole enforcer; these schemas reject malformed input early with 400.
// Quantity/step/pack rules live in domain code (writes.ts); ownership XOR
// is validated per request (exactly one of guest token / customer session).
import { z } from "zod";
import { uuidSchema } from "../api/validation";

/** Quantity wire shape: NUMERIC(12,3) text, strictly > 0 (frozen
 * chk_cart_items_qty). Never z.coerce — numeric JSON input is rejected. */
export const cartQuantitySchema = z
  .string()
  .regex(/^\d+(\.\d{1,3})?$/, { message: "Invalid quantity." })
  .refine((s) => Number(s) > 0, { message: "Invalid quantity." });

export const cartItemAddSchema = z
  .object({
    productVariantId: uuidSchema,
    quantity: cartQuantitySchema,
  })
  .strict();

export const cartItemSetSchema = z
  .object({
    quantity: cartQuantitySchema,
  })
  .strict();

export const cartMergeSchema = z
  .object({})
  .strict();

/** Reprice body: empty (owner resolves from header session/token only —
 * quantities/prices are never client-supplied). */
export const cartRepriceSchema = z
  .object({})
  .strict();

export type CartItemAdd = z.infer<typeof cartItemAddSchema>;
