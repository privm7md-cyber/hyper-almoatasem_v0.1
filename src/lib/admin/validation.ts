// BA-9 admin boundary validation (Zod only).
//
// Mirrors frozen CHECK shapes without re-owning them: the database remains
// the sole enforcer; these schemas reject malformed input early with 400.
// SUPER_ADMIN-row protection, grant semantics, and audit pairing live in
// domain code (writes.ts). Never z.coerce.* here.
import { z } from "zod";
import { deliveryScopeSchema } from "@/lib/orders/delivery-scope";
import { uuidSchema, paginationSchema } from "../api/validation";

const nameSchema = (max: number) => z.string().trim().min(1).max(max);

/** Admin email: trimmed + lowercased at the boundary (frozen convention:
 * login identifier stored lowercase); format CHECK stays in SQL. */
export const adminEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(160)
  .refine((s) => s.includes("@") && !s.includes(" "), { message: "Invalid email." });

/** Admin contact phone: frozen shape ^[0-9]{8,15}$ (digits only; the R8
 * ladder is customer identity and does NOT apply here). */
export const adminPhoneSchema = z
  .string()
  .trim()
  .regex(/^[0-9]{8,15}$/, { message: "Invalid phone." });

/** Role name: frozen chk_roles_name (non-empty, no spaces). */
export const roleNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .refine((s) => !s.includes(" "), { message: "Invalid role name." });

/** Query-string boolean: only exact "true"/"false" (never z.coerce.boolean). */
export const queryBoolSchema = z.enum(["true", "false"]).nullish();

export function queryBool(value: "true" | "false" | null | undefined): boolean | null {
  if (value === null || value === undefined) return null;
  return value === "true";
}

export const userListQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(160).nullish(),
  active: queryBoolSchema,
});

export const userInputSchema = z
  .object({
    name: nameSchema(120),
    email: adminEmailSchema,
    phone: adminPhoneSchema.nullish(),
  })
  .strict();

export const userPatchSchema = z
  .object({
    name: nameSchema(120).nullish(),
    email: adminEmailSchema.nullish(),
    phone: adminPhoneSchema.nullable().nullish(),
    isActive: z.boolean().nullish(),
  })
  .strict();

export const userPasswordSchema = z
  .object({
    password: z.string().min(1).max(128),
  })
  .strict();

export const roleAssignSchema = z
  .object({
    roleId: uuidSchema,
  })
  .strict();

export const roleListQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(60).nullish(),
  active: queryBoolSchema,
});

export const roleInputSchema = z
  .object({
    name: roleNameSchema,
    description: z.string().max(2000).nullish(),
  })
  .strict();

export const rolePatchSchema = z
  .object({
    name: roleNameSchema.nullish(),
    description: z.string().max(2000).nullable().nullish(),
    isActive: z.boolean().nullish(),
  })
  .strict();

export const grantInputSchema = z
  .object({
    permissionId: uuidSchema,
  })
  .strict();

export const permissionListQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(120).nullish(),
});

export const settingPatchSchema = z
  .object({
    value: z.string().max(4000),
  })
  .strict();

/** Delivery-zone fee: identical wire shape to the checkout/estimate contract
 * (non-negative, ≤2 decimals, NUMERIC(10,2) bound). */
const deliveryFeeTextSchema = z
  .string()
  .trim()
  .regex(/^\d{1,8}(\.\d{1,2})?$/, { message: "Invalid delivery fee." });

export const deliveryZoneCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    fee: deliveryFeeTextSchema,
    isActive: z.boolean().nullish(),
    scope: deliveryScopeSchema.optional(),
  })
  .strict();

/** PATCH is compare-and-set: `version` is the row version the admin read. */
export const deliveryZonePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(80).nullish(),
    fee: deliveryFeeTextSchema.nullish(),
    isActive: z.boolean().nullish(),
    version: z.number().int().positive(),
    scope: deliveryScopeSchema.optional(),
  })
  .strict()
  .refine((v) => v.name != null || v.fee != null || v.isActive != null || v.scope != null, {
    message: "At least one field is required.",
  });

export const deliveryZoneListQuerySchema = paginationSchema.extend({
  active: z.enum(["true", "false"]).nullish(),
});

export const auditListQuerySchema = paginationSchema.extend({
  userId: uuidSchema.nullish(),
  action: z.string().trim().min(1).max(80).nullish(),
  entityType: z.string().trim().min(1).max(40).nullish(),
  entityId: uuidSchema.nullish(),
  since: z.string().datetime({ offset: true }).nullish(),
  until: z.string().datetime({ offset: true }).nullish(),
});

export type UserInput = z.infer<typeof userInputSchema>;
export type RoleInput = z.infer<typeof roleInputSchema>;
