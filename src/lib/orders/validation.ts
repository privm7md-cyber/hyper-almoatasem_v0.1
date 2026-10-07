// BA-6 order input validation (boundary layer, Zod only).
//
// Mirrors frozen CHECK shapes without re-owning them: the database remains
// the sole enforcer; these schemas reject malformed input early with 400.
// Pricing/ownership/transition semantics live in writes.ts + state-machine.
import { z } from "zod";
import { uuidSchema, paginationSchema, idempotencyKeySchema } from "../api/validation";
import { cartQuantitySchema } from "../cart/validation";
import { ORDER_STATUSES } from "./state-machine";

export const orderStatusSchema = z.enum(ORDER_STATUSES);

export const orderCreateSchema = z
  .object({
    // PHASE 2: no customerId — the owner is the server-verified session
    // customer (orders are customer-only; guests identify first, then merge).
    addressId: uuidSchema,
    // Optional when the canonical `Idempotency-Key` header carries the key
    // (BA-A contract); the route enforces at-least-one + no-conflict.
    idempotencyKey: idempotencyKeySchema.nullish(),
    /** Optional coupon code (server-normalized + validated; absent = autos only). */
    couponCode: z.string().trim().min(1).max(64).nullish(),
  })
  .strict();

export const orderListQuerySchema = paginationSchema;

export const adminOrderListQuerySchema = paginationSchema
  .extend({
    status: orderStatusSchema.nullish(),
    customerId: uuidSchema.nullish(),
    search: z.string().trim().max(24).nullish(),
    dateFrom: z.string().datetime({ offset: true }).nullish(),
    dateTo: z.string().datetime({ offset: true }).nullish(),
  })
  .refine((q) => q.dateFrom == null || q.dateTo == null || q.dateFrom <= q.dateTo, {
    message: "Invalid query.",
  });

export const orderCancelSchema = z
  .object({})
  .strict();

/** Fulfillment pick body: the weighed fact only (decimal string > 0;
 * R7 envelope + step rules live in domain code). Strict: no status,
 * actor, or customer fields from clients. */
export const pickLineSchema = z
  .object({
    actualQuantity: cartQuantitySchema,
  })
  .strict();

export type OrderCreate = z.infer<typeof orderCreateSchema>;
