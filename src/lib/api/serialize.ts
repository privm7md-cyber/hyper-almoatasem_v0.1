// Shared serialization primitives (BA-A contract §31).
//
// One canonical implementation (previously duplicated per domain module):
// - money/quantity/percent: Prisma Decimal → decimal STRING (never binary
//   floating-point on the wire; integer-piastres math lives in domain code).
// - timestamps: Date → ISO-8601 UTC string (toISOString; the exact instant,
//   unambiguous — Cairo display is a frontend concern).
// - null/undefined pass through as null (never invented defaults).
import "server-only";
import type { Prisma } from "@prisma/client";

/** Nullable decimal → decimal string (money/quantity/percent wire format). */
export function dec(v: Prisma.Decimal | null | undefined): string | null {
  return v === null || v === undefined ? null : v.toString();
}

/** Required decimal → decimal string. */
export function decReq(v: Prisma.Decimal): string {
  return v.toString();
}

/** Nullable timestamp → ISO-8601 UTC string. */
export function iso(v: Date | null | undefined): string | null {
  return v === null || v === undefined ? null : v.toISOString();
}

/** Required timestamp → ISO-8601 UTC string. */
export function isoReq(v: Date): string {
  return v.toISOString();
}

/** Cursor-page meta shape (limit + nextCursor, null at the end). */
export function pageMeta(limit: number, nextCursor: string | null): { limit: number; nextCursor: string | null } {
  return { limit, nextCursor };
}
