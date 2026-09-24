import "server-only";
// Opaque token helpers. Session and one-time tokens are 256-bit
// cryptographically secure random values rendered as 64 hex characters.
// The database stores ONLY the SHA-256 hex digest (64 chars, matching the
// `^[0-9a-f]{64}$` CHECKs); raw tokens exist transiently in the login/token
// flow and inside the HttpOnly session cookie. No user id, no payload, nothing
// reversible lives in either representation.
import { createHash, randomBytes } from "node:crypto";

export function newOpaqueToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}
