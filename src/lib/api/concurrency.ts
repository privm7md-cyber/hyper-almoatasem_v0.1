// Shared concurrency primitives (BA-1 foundation).
//
// Rule (frozen): row-local guards under READ COMMITTED with deterministic
// ASC lock order; never SERIALIZABLE, never read-check-write. These helpers
// are pure and side-effect free; the owning flow still opens its own
// transaction and issues its own row locks.

/** Deterministic lock order for any set of row ids (H1 contention rule). */
export function orderLockIds(ids: string[]): string[] {
  return [...new Set(ids)].sort();
}

/** PostgreSQL deadlock/serialization-failure codes worth a single re-read. */
const RETRYABLE_PG_CODES = new Set(["40P01", "40001"]);

/** True when the caller should re-read state (never blindly re-fire writes). */
export function isConcurrencyConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && RETRYABLE_PG_CODES.has(code);
}
