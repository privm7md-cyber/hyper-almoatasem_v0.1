// G5-A: HMAC-bound phone bucket keys for registration rate limiting.
//
// Pure module (node:crypto only — no server-only, no DB): safe to import in
// plain-node unit tests. The phone bucket key MUST depend on the dedicated
// server secret, never on plain SHA-256 alone: Egyptian mobile numbers are
// low-entropy and dictionary-recoverable from an unkeyed digest, unlike the
// 256-bit random bearer tokens that `hashToken` was designed for.
//
// Secret contract (`REG_RATE_LIMIT_PHONE_SECRET`): at least 32 bytes of
// cryptographically random material. A 64-char hex encoding of 32 bytes is
// accepted and decoded consistently. Missing/empty/invalid secret THROWS —
// callers must fail closed (generic 500) with NO fallback to plain SHA-256.
// Rotating the secret orphans prior phone counters (documented consequence:
// temporary under-counting within one window; no migration, no dual-key).
import { createHmac } from "node:crypto";

export const REG_RATE_LIMIT_PHONE_SECRET_NAME = "REG_RATE_LIMIT_PHONE_SECRET";

/** Resolve + validate the dedicated secret. Throws on missing/empty/short. */
export function resolveRegPhoneSecret(): Buffer {
  const raw = process.env[REG_RATE_LIMIT_PHONE_SECRET_NAME];
  if (!raw || raw.trim() === "") {
    throw new Error("Registration rate-limit phone secret is not configured.");
  }
  const s = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(s)) return Buffer.from(s, "hex");
  const buf = Buffer.from(s, "utf8");
  if (buf.length < 32) {
    throw new Error("Registration rate-limit phone secret is too short.");
  }
  return buf;
}

/** Secret-bound bucket key for a canonical phone (`201…` R8 form). */
export function regPhoneBucketKey(canonicalPhone: string): string {
  const secret = resolveRegPhoneSecret();
  return `reg:cust-acct:${createHmac("sha256", secret).update(canonicalPhone, "utf8").digest("hex")}`;
}
