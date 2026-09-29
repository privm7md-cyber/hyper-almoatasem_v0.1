// BA-9 admin boundary validation (Zod only).
//
// Mirrors frozen CHECK shapes without re-owning them: the database remains
// the sole enforcer; these schemas reject malformed input early with 400.
// SUPER_ADMIN-row protection, grant semantics, and audit pairing live in
// domain code (writes.ts). Never z.coerce.* here.
import { z } from "zod";
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
