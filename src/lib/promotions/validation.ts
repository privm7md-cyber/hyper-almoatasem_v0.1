// BA-8 promotion/coupon input validation (boundary layer, Zod only).
//
// Mirrors frozen CHECK shapes without re-owning them: the database remains
// the sole enforcer; these schemas reject malformed input early with 400.
// Type×scope×value gating, activation rules, and code normalization live
// in domain code (writes.ts); business math lives in engine.ts.
import { z } from "zod";
import { uuidSchema, paginationSchema } from "../api/validation";

export const promotionTypeSchema = z.enum(["PERCENTAGE", "FIXED_AMOUNT", "BUY_X_GET_Y", "FIXED_PRICE"]);
export const promotionScopeSchema = z.enum(["LINE", "ORDER"]);
export const promotionStatusSchema = z.enum(["DRAFT", "ACTIVE", "DISABLED"]);
export const targetTypeSchema = z.enum(["VARIANT", "PRODUCT", "BRAND", "CATEGORY"]);

/** Money wire: NUMERIC(10,2) text. Percent wire: NUMERIC(5,2) text. */
const moneySchema = z.string().regex(/^\d+(\.\d{1,2})?$/, { message: "Invalid amount." });
const percentSchema = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, { message: "Invalid percent." })
  .refine((s) => Number(s) > 0 && Number(s) <= 100, { message: "Invalid percent." });
const qtySchema = z
  .string()
  .regex(/^\d+(\.\d{1,3})?$/, { message: "Invalid quantity." })
  .refine((s) => Number(s) > 0, { message: "Invalid quantity." });
const windowSchema = z.string().datetime({ offset: true }).nullish();

export const promotionInputSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    description: z.string().max(4000).nullish(),
    type: promotionTypeSchema,
    scope: promotionScopeSchema,
    status: promotionStatusSchema.nullish(),
    startAt: windowSchema,
    endAt: windowSchema,
    discountPercent: percentSchema.nullish(),
    discountAmount: moneySchema.nullish(),
    fixedPrice: moneySchema.nullish(),
    priority: z.number().int().nullish(),
    isStackable: z.boolean().nullish(),
    usageLimit: z.number().int().positive().nullish(),
  })
  .strict();

export const promotionPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(160).nullish(),
    description: z.string().max(4000).nullable().nullish(),
    status: promotionStatusSchema.nullish(),
    startAt: z.string().datetime({ offset: true }).nullable().nullish(),
    endAt: z.string().datetime({ offset: true }).nullable().nullish(),
    discountPercent: percentSchema.nullable().nullish(),
    discountAmount: moneySchema.nullable().nullish(),
    fixedPrice: moneySchema.nullable().nullish(),
    priority: z.number().int().nullish(),
    isStackable: z.boolean().nullish(),
    usageLimit: z.number().int().positive().nullable().nullish(),
  })
  .strict();

export const targetInputSchema = z
  .object({
    targetType: targetTypeSchema,
    targetId: uuidSchema,
  })
  .strict();

export const rulesInputSchema = z
  .object({
    minimumQuantity: qtySchema.nullish(),
    minimumAmount: moneySchema.nullish(),
    maximumDiscount: moneySchema.nullish(),
  })
  .strict();

export const buyGetInputSchema = z
  .object({
    buyQuantity: qtySchema,
    getQuantity: qtySchema,
    discountPercent: percentSchema,
    freeVariantId: uuidSchema.nullish(),
  })
  .strict();

/** Coupon code wire: trimmed, no inner whitespace (frozen CHECK shape);
 * UPPER normalization happens in domain code (DB CHECK is the enforcer). */
export const couponCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((s) => !/\s/.test(s), { message: "Invalid coupon code." });

export const couponInputSchema = z
  .object({
    promotionId: uuidSchema,
    code: couponCodeSchema,
    usageLimit: z.number().int().positive().nullish(),
    perCustomerLimit: z.number().int().min(1).nullish(),
    minimumOrderAmount: moneySchema.nullish(),
    startAt: windowSchema,
    endAt: windowSchema,
    isActive: z.boolean().nullish(),
  })
  .strict();

export const couponPatchSchema = z
  .object({
    usageLimit: z.number().int().positive().nullable().nullish(),
    perCustomerLimit: z.number().int().min(1).nullable().nullish(),
    minimumOrderAmount: moneySchema.nullable().nullish(),
    startAt: z.string().datetime({ offset: true }).nullable().nullish(),
    endAt: z.string().datetime({ offset: true }).nullable().nullish(),
    isActive: z.boolean().nullish(),
  })
  .strict();

export const promotionListQuerySchema = paginationSchema.extend({
  status: promotionStatusSchema.nullish(),
  type: promotionTypeSchema.nullish(),
  scope: promotionScopeSchema.nullish(),
  search: z.string().trim().max(160).nullish(),
});

export const couponListQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(64).nullish(),
  active: z.enum(["true", "false"]).nullish(),
});

export const estimateInputSchema = z
  .object({
    lines: z
      .array(
        z
          .object({
            productVariantId: uuidSchema,
            quantity: qtySchema,
          })
          .strict(),
      )
      .min(1)
      .max(100),
    couponCode: couponCodeSchema.nullish(),
  })
  .strict();

export type PromotionInput = z.infer<typeof promotionInputSchema>;
export type CouponInput = z.infer<typeof couponInputSchema>;
