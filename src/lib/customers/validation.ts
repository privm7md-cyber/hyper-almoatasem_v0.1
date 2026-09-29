// BA-4 customer input validation (boundary layer, Zod only).
//
// Mirrors frozen CHECK shapes without re-owning them: the database remains
// the sole enforcer; these schemas reject malformed input early with 400.
// Phone/email ladders live in domain code (phone.ts); business semantics
// (uniqueness, transitions, ownership) live in writes.ts.
import { z } from "zod";
import { paginationSchema } from "../api/validation";

/** Raw phone wire shape: non-empty text; the R8 ladder runs in domain code
 * (ladder failures → 422, never 400 — the value parses as a string but is
 * semantically not an identity). Never z.coerce.* here. */
export const rawPhoneSchema = z.string().trim().min(1).max(32);

/** Query-string boolean: only exact "true"/"false" (never z.coerce.boolean). */
export const queryBoolSchema = z.enum(["true", "false"]).nullish();

export function queryBool(value: "true" | "false" | null | undefined): boolean | null {
  if (value === null || value === undefined) return null;
  return value === "true";
}

const nameSchema = (max: number) => z.string().trim().min(1).max(max);

/** Email wire shape: trimmed + lowercased at the boundary (matches the
 * users-table convention); the partial-UNIQUE + format CHECKs stay in SQL.
 * `null` clears the value (many NULLs coexist). */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(160)
  .refine((s) => s.includes("@") && !s.includes(" "), { message: "Invalid email." });

export const identifyInputSchema = z
  .object({
    phone: rawPhoneSchema,
    firstName: nameSchema(80),
    lastName: nameSchema(80).nullish(),
  })
  .strict();

export const adminCustomerListQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(80).nullish(),
  registered: queryBoolSchema,
  active: queryBoolSchema,
});

export const customerPatchSchema = z
  .object({
    firstName: nameSchema(80).nullish(),
    lastName: nameSchema(80).nullable().nullish(),
    email: emailSchema.nullable().nullish(),
    autoAcceptReplacements: z.boolean().nullish(),
    isActive: z.boolean().nullish(),
  })
  .strict();

export const registerInputSchema = z
  .object({
    password: z.string().min(1).max(128),
  })
  .strict();

const labelSchema = z.string().trim().min(1).max(30);

export const addressInputSchema = z
  .object({
    label: labelSchema.nullish(),
    city: nameSchema(80),
    area: nameSchema(80).nullish(),
    village: nameSchema(80).nullish(),
    street: nameSchema(120).nullish(),
    buildingNumber: nameSchema(30).nullish(),
    landmark: nameSchema(160).nullish(),
    phone: rawPhoneSchema,
    isDefault: z.boolean().nullish(),
  })
  .strict();

export const addressPatchSchema = z
  .object({
    label: labelSchema.nullable().nullish(),
    city: nameSchema(80).nullish(),
    area: nameSchema(80).nullable().nullish(),
    village: nameSchema(80).nullable().nullish(),
    street: nameSchema(120).nullable().nullish(),
    buildingNumber: nameSchema(30).nullable().nullish(),
    landmark: nameSchema(160).nullable().nullish(),
    phone: rawPhoneSchema.nullish(),
    isDefault: z.boolean().nullish(),
  })
  .strict();

export type IdentifyInput = z.infer<typeof identifyInputSchema>;
export type AddressInput = z.infer<typeof addressInputSchema>;
