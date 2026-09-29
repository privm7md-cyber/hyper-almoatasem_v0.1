// Shared idempotency foundation (BA-1 — contract helpers only, no storage).
//
// Rule (frozen): same key + same terms → replay original outcome; same key +
// different terms → 409 CONFLICT; never silent duplicates; no blanket
// ON CONFLICT DO NOTHING in product paths. Order/replacement idempotency
// itself lives in BA-6/BA-7; this module holds only the shared decision
// shape so every future flow answers identically.
import { conflict } from "./errors";

export interface IdempotencyTerms {
  /** Canonical fingerprint of the request terms both sides agreed on. */
  fingerprint: string;
}

export type IdempotencyDecision =
  | { outcome: "proceed" }
  | { outcome: "replay"; fingerprint: string }
  | { outcome: "conflict"; fingerprint: string };

/**
 * Decide a write guarded by an idempotency key against at most one stored
 * record for that key. Pure function — storage stays in the owning flow.
 */
export function decideIdempotentWrite(
  stored: IdempotencyTerms | null,
  incomingFingerprint: string,
): IdempotencyDecision {
  if (!stored) return { outcome: "proceed" };
  if (stored.fingerprint === incomingFingerprint) {
    return { outcome: "replay", fingerprint: stored.fingerprint };
  }
  return { outcome: "conflict", fingerprint: stored.fingerprint };
}

/** Raise the standard conflict when fingerprints diverge. */
export function idempotencyConflictError(): never {
  throw conflict("Conflicting request under the same idempotency key.", null);
}
