// BA-6 order input validation (boundary layer, Zod only).
//
// Mirrors frozen CHECK shapes without re-owning them: the database remains
// the sole enforcer; these schemas reject malformed input early with 400.
// Pricing/ownership/transition semantics live in writes.ts + state-machine.
import { z } from "zod";
import { uuidSchema, paginationSchema, idempotencyKeySchema } from "../api/validation";
import { cartQuantitySchema } from "../cart/validation";
import { rawPhoneSchema } from "../customers/validation";
import { ORDER_STATUSES } from "./state-machine";

export const orderStatusSchema = z.enum(ORDER_STATUSES);

const guestNameSchema = z.string().trim().min(1).max(80);

/**
 * BG-Guest-Order inline guest address (checkout payload → order snapshots
 * only; zero customer_addresses rows). Field shapes mirror
 * addressInputSchema minus label/isDefault/ownership — no customer address
 * entity is created, read, or referenced on the guest path.
 */
export const guestAddressSchema = z
  .object({
    city: guestNameSchema,
    area: guestNameSchema.nullish(),
    village: guestNameSchema.nullish(),
    street: z.string().trim().min(1).max(120).nullish(),
    buildingNumber: z.string().trim().min(1).max(30).nullish(),
    landmark: z.string().trim().min(1).max(160).nullish(),
    phone: rawPhoneSchema,
  })
  .strict();

export const guestContactSchema = z
  .object({
    firstName: guestNameSchema,
    lastName: guestNameSchema.nullish(),
  })
  .strict();

export const orderCreateSchema = z
  .object({
    // Registered path: owned address entity id (server-verified ownership).
    // Guest path: guestAddress + guestContact instead (XOR, enforced below).
    // PHASE 2 rule kept: no customerId — the owner is the server-verified
    // session customer, or the guest cart bearer on the guest path.
    addressId: uuidSchema.nullish(),
    guestAddress: guestAddressSchema.nullish(),
    guestContact: guestContactSchema.nullish(),
    // Optional when the canonical `Idempotency-Key` header carries the key
    // (BA-A contract); the route enforces at-least-one + no-conflict.
    idempotencyKey: idempotencyKeySchema.nullish(),
    /** Optional coupon code (server-normalized + validated; absent = autos only). */
    couponCode: z.string().trim().min(1).max(64).nullish(),
    /**
     * Fee the customer reviewed in the estimate. REQUIRED for a NEW order:
     * the storefront always previews the fee (`POST /api/store/orders/estimate`)
     * and asserts the reviewed value here, so an order can never be created
     * without a reviewed price (a missing value → 400 VALIDATION, enforced by
     * the domain AFTER the idempotency lookup). The server still resolves the
     * authoritative fee; a mismatch rejects with 409 DELIVERY_FEE_CHANGED so a
     * fee edit can never silently change the confirmed total. Never an amount
     * the server charges (the server value wins or the request is rejected).
     *
     * Nullable ONLY so a same-key verification of an unresolved attempt is
     * never blocked by a validation error BEFORE the idempotency lookup: on
     * that path the server resolves the attempt first and the assertion is
     * never compared (no order is created from it).
     */
    expectedDeliveryFee: z
      .string()
      .regex(/^\d{1,8}(\.\d{1,2})?$/, { message: "Invalid delivery fee." })
      .nullish(),
    /**
     * D-7: the delivery-eligibility state the customer saw in the estimate.
     * The server re-resolves it inside the transaction and refuses a mismatch
     * with 409, so a coverage change is never applied silently. Optional: it
     * only asserts what was reviewed; it never decides anything.
     */
    expectedDeliveryEligibility: z
      .enum(["ZONE_MATCHED", "UNCONFIGURED", "UNMATCHED"])
      .nullish(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const owned = v.addressId != null;
    const guestSide = v.guestAddress != null || v.guestContact != null;
    if (owned === guestSide) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Exactly one of addressId / guest address is required.",
      });
      return;
    }
    if (guestSide && (v.guestAddress == null || v.guestContact == null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Guest checkout requires both guestAddress and guestContact.",
      });
    }
  });

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

/** Admin-only cancellation terms; customer cancellation stays an empty body. */
export const adminCancelSchema = z.object({
  reason: z.string().trim().min(1).max(2000),
  confirmed: z.literal(true),
}).strict();

/** Fulfillment pick body: the weighed fact only (decimal string > 0;
 * R7 envelope + step rules live in domain code). Strict: no status,
 * actor, or customer fields from clients. */
export const pickLineSchema = z
  .object({
    actualQuantity: cartQuantitySchema,
  })
  .strict();

export type OrderCreate = z.infer<typeof orderCreateSchema>;
