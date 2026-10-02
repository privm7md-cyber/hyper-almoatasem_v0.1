// Shared keyset pagination (BA-B2 foundation).
//
// Correct cursor-over-(sort-field, id) paging: the cursor is an OPAQUE
// base64url JSON token `{ v: 1, s: <last sort value>, id: <last row id> }`
// minted server-side (never a raw UUID, never client-computed). Pages are
// exact under static data: no duplicates, no skips — unlike id-only
// cursors under non-id sorts. Under concurrent writes the standard keyset
// caveat applies (rows inserted before the cursor are missed, never
// duplicated); callers document this, never paper over it.
//
// Supported sort fields: `name` (text) and `created_at` (timestamptz).
// Every sort carries a direction-consistent id tie-break, so ordering is
// total and deterministic. Comparisons run in PostgreSQL (Prisma OR/AND
// predicates over exact values; the cursor echoes observed row values —
// no JS clock participates).
import "server-only";
import { ApiError } from "@/lib/api/errors";
import { uuidSchema } from "@/lib/api/validation";

export type PageSort = "name" | "created_at";
export type PageDir = "asc" | "desc";

export interface PageCursor {
  v: 1;
  s: string;
  id: string;
}

/** Encode a page cursor from the last row of a page (server-minted). */
export function encodeCursor(sortValue: string, id: string): string {
  return Buffer.from(JSON.stringify({ v: 1, s: sortValue, id }), "utf8").toString("base64url");
}

/** Decode + validate an opaque cursor (malformed → 400 VALIDATION). */
export function decodeCursor(raw: string | null | undefined): PageCursor | null {
  if (raw === null || raw === undefined || raw === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new ApiError("VALIDATION", "Invalid pagination cursor.", null);
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { v?: unknown }).v !== 1 ||
    typeof (parsed as { s?: unknown }).s !== "string" ||
    !uuidSchema.safeParse((parsed as { id?: unknown }).id).success
  ) {
    throw new ApiError("VALIDATION", "Invalid pagination cursor.", null);
  }
  return parsed as PageCursor;
}

/** Prisma orderBy for a total deterministic order (field + direction-matched id tiebreak). */
export function pageOrder(sort: PageSort, dir: PageDir): Array<Record<string, unknown>> {
  const idDir = dir;
  if (sort === "name") return [{ name: dir }, { id: idDir }];
  return [{ createdAt: dir }, { id: idDir }];
}

/**
 * Prisma AND-clause restricting rows to strictly-after-cursor under
 * (sort, dir). Merges into the caller's `where` via AND. Returns {} when
 * no cursor is supplied. Field-specific builders keep the tuple
 * comparison exact (no id-only shortcut that skips/duplicates).
 */
export function pageWhereCreatedAt(cursor: PageCursor | null, dir: PageDir): object {
  if (!cursor) return {};
  const at = new Date(cursor.s);
  if (Number.isNaN(at.getTime())) throw new ApiError("VALIDATION", "Invalid pagination cursor.", null);
  const idCmp = dir === "asc" ? { gt: cursor.id } : { lt: cursor.id };
  const fieldCmp = dir === "asc" ? { gt: at } : { lt: at };
  return {
    OR: [{ createdAt: fieldCmp }, { createdAt: at, id: idCmp }],
  };
}

/** Same as pageWhereCreatedAt for text sort fields. */
export function pageWhereName(cursor: PageCursor | null, dir: PageDir): object {
  if (!cursor) return {};
  const idCmp = dir === "asc" ? { gt: cursor.id } : { lt: cursor.id };
  const fieldCmp = dir === "asc" ? { gt: cursor.s } : { lt: cursor.s };
  return {
    OR: [{ name: fieldCmp }, { name: cursor.s, id: idCmp }],
  };
}
