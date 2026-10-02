// Shared boundary-validation primitives (BA-1 foundation).
//
// Transport-layer shapes only (malformed JSON, missing/unknown fields, wrong
// types, bad UUIDs/numbers/quantities). Business rules live in domain
// services, enforcement in the database. Zod only — no new library.
import { z } from "zod";

/** UUID path/body field (frozen PK shape everywhere). */
export const uuidSchema = z.string().uuid();

/** Strict object: unknown fields rejected (fail-closed boundary). */
export function strictObject<T extends z.ZodRawShape>(shape: T) {
  return z.strictObject(shape);
}

/** Idempotency-key wire shape (mirrors the frozen DB CHECK: non-empty, no spaces). */
export const idempotencyKeySchema = z
  .string()
  .min(1)
  .max(64)
  .refine((s) => s.trim() === s && !s.includes(" "), { message: "Invalid idempotency key." });

/** Quantity wire shape: positive decimal text; domain layer binds step/unit semantics. */
export const quantitySchema = z
  .string()
  .regex(/^\d+(\.\d{1,3})?$/, { message: "Invalid quantity." })
  .refine((s) => Number(s) > 0, { message: "Invalid quantity." });

/** Admin pagination query: bounded, stable, never unbounded. */
export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: uuidSchema.nullish(),
});

/**
 * Opaque keyset-cursor wire shape (BA-B2): server-minted base64url token.
 * Transport shape only — semantic validation (decode + structure) happens
 * in decodeCursor (api/pagination.ts), which rejects malformed cursors
 * with 400 VALIDATION. Modules with keyset sorts override the uuid
 * cursor with this field.
 */
export const opaqueCursorSchema = z.string().min(1).max(512);

export type Pagination = z.infer<typeof paginationSchema>;
