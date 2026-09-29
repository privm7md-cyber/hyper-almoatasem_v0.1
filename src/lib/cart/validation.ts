// BA-5 cart input validation (boundary layer, Zod only).
//
// Mirrors frozen CHECK shapes without re-owning them: the database remains
// the sole enforcer; these schemas reject malformed input early with 400.
// Quantity/step/pack rules live in domain code (writes.ts); ownership XOR
// is validated per request (exactly one of guest token / customer id).
import { z } from "zod";
import { uuidSchema } from "../api/validation";

/** Quantity wire shape: NUMERIC(12,3) text, strictly > 0 (frozen
 * chk_cart_items_qty). Never z.coerce — numeric JSON input is rejected. */
export const cartQuantitySchema = z
  .string()
  .regex(/^\d+(\.\d{1,3})?$/, { message: "Invalid quantity." })
  .refine((s) => Number(s) > 0, { message: "Invalid quantity." });

/** Owner reference: exactly one side set (XOR mirrors the DB CHECK).
 * customerId travels in query/body; the guest token travels in the
 * `x-guest-token` header (never in URLs). */
export const ownerRefSchema = z
  .object({
    customerId: uuidSchema.nullish(),
    guestToken: z.string().trim().min(1).max(128).nullish(),
  })
  .strict()
  .refine((v) => (v.customerId == null) !== (v.guestToken == null), {
    message: "Exactly one of customerId / guestToken is required.",
  });

export const cartItemAddSchema = z
  .object({
    customerId: uuidSchema.nullish(),
    productVariantId: uuidSchema,
    quantity: cartQuantitySchema,
  })
  .strict();

export const cartItemSetSchema = z
  .object({
    customerId: uuidSchema.nullish(),
    quantity: cartQuantitySchema,
  })
  .strict();

export const cartMergeSchema = z
  .object({
    customerId: uuidSchema,
  })
  .strict();

export type CartItemAdd = z.infer<typeof cartItemAddSchema>;
