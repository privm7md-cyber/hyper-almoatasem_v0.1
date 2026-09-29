// BA-5 guest cart sessions (opaque bearer tokens, cart-lines scope only).
//
// Frozen rule: sessions are ≥128-bit server-random opaque tokens, stored
// HASHED, server-side expiry. Storage is the SHA-256 hex digest (64 chars —
// fits session_id VARCHAR(64) and its no-spaces CHECK); the raw token is
// returned once at creation and never persisted. Rotation-on-login and the
// exact guest TTL number are deferred/config-level (see writes.ts).
// Pure helpers here (no DB) stay unit-testable under plain node.
import { createHash, randomBytes } from "node:crypto";

/** Mint a 256-bit raw token (hex64) for first presentation to the client. */
export function mintGuestToken(): string {
  return randomBytes(32).toString("hex");
}

/** Storage form: SHA-256 hex digest of the presented token. */
export function hashGuestToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

/** Wire shape guard: 64 lowercase hex chars (rejects hashes pasted back in
 * confusion? No — a digest IS 64 hex too. This guards shape only; the DB
 * lookup decides existence. Kept intentionally loose: [0-9a-f]{64}. */
export function isGuestTokenShape(raw: string): boolean {
  return /^[0-9a-f]{64}$/i.test(raw);
}
