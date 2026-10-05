// BA-6 order input validation (boundary layer, Zod only).
//
// Mirrors frozen CHECK shapes without re-owning them: the database remains
// the sole enforcer; these schemas reject malformed input early with 400.
// Pricing/ownership/transition semantics live in writes.ts + state-machine.
import { z } from "zod";
import { uuidSchema, paginationSchema, idempotencyKeySchema } from "../api/validation";
import { ORDER_STATUSES } from "./state-machine";

export const orderStatusSchema = z.enum(ORDER_STATUSES);

export const orderCreateSchema = z
  .object({
    customerId: uuidSchema,
    addressId: uuidSchema,
    // Optional when the canonical `Idempotency-Key` header carries the key
    // (BA-A contract); the route enforces at-least-one + no-conflict.
    idempotencyKey: idempotencyKeySchema.nullish(),
    /** Optional coupon code (server-normalized + validated; absent = autos only). */
    couponCode: z.string().trim().min(1).max(64).nullish(),
  })
  .strict();

export const orderListQuerySchema = paginationSchema.extend({
  customerId: uuidSchema,
});

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
  .object({
    customerId: uuidSchema,
  })
  .strict();

export type OrderCreate = z.infer<typeof orderCreateSchema>;
