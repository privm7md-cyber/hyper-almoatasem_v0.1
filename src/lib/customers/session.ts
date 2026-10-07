// PHASE 2.5 storefront customer sessions (DB-backed opaque tokens).
//
// Replaces the Phase-2 stateless HMAC token (no revocation possible) with
// server-side sessions mirroring the admin session model: only token HASHES
// stored (SHA-256 hex), fixed expiry, revocation by flag, last_seen_at
// touch. Storage rule: the customer_sessions table is accessed ONLY through
// raw SQL in this module (created_ip is inet, Unsupported-mapped — Prisma
// 7.10 query-build fails on such models, proven on audit_logs/admin).
// Reads, writes and revocations below all use parameterized raw SQL.
// Lifecycle: fixed 30-day expiry (no sliding), revocation by flag (rows are
// history, never deleted by the app). Password change revokes every live
// session (see customers/auth.ts); login mints exactly one row.
import { ApiError } from "../api/errors";
import { prisma } from "@/lib/db";
import { hashToken, newOpaqueToken } from "@/lib/auth/tokens";
import {
  CUSTOMER_SESSION_COOKIE,
  CUSTOMER_TOKEN_HEADER,
  readCustomerToken,
} from "./cookies";

export { CUSTOMER_SESSION_COOKIE, CUSTOMER_TOKEN_HEADER, readCustomerToken };
// Customer session lifetime: 30 days, fixed (product-tunable constant —
export const CUSTOMER_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface CustomerSessionRecord {
  id: string;
  customerId: string;
  expiresAt: Date;
}

interface CustomerSessionRow {
  id: string;
  customer_id: string;
  expires_at: Date;
  revoked_at: Date | null;
}

/** Create a session row + return the RAW token (once). Caller sets the cookie. */
export async function createCustomerSession(input: {
  customerId: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{ token: string; record: CustomerSessionRecord }> {
  const token = newOpaqueToken();
  const tokenHash = hashToken(token);
  const rows = await prisma.$queryRaw<CustomerSessionRow[]>`
    INSERT INTO customer_sessions (customer_id, token_hash, expires_at, created_ip, user_agent)
    VALUES (
      ${input.customerId}::uuid,
      ${tokenHash}::text,
      (now() + (${CUSTOMER_SESSION_TTL_SECONDS}::text || ' seconds')::interval),
      ${input.ip ?? null}::inet,
      ${input.userAgent ?? null}::text
    )
    RETURNING id, customer_id, expires_at, revoked_at
  `;
  const row = rows[0];
  return {
    token,
    record: { id: row.id, customerId: row.customer_id, expiresAt: row.expires_at },
  };
}

export interface ValidatedCustomerSession {
  sessionId: string;
  customerId: string;
}

/**
 * Validate a raw session token. Checks existence, revocation, expiry, and
 * touches last_seen_at. Returns null for ANY invalid state (callers treat
 * all nulls identically — no reason is leaked). Expiry is gated INSIDE the
 * database (single clock source — the ONLY truth here; no JS comparison
 * of decoded TIMESTAMPTZ on this stack).
 */
export async function validateCustomerSessionToken(
  rawToken: string | undefined | null,
): Promise<ValidatedCustomerSession | null> {
  if (!rawToken || typeof rawToken !== "string" || rawToken.length !== 64) {
    return null;
  }
  const tokenHash = hashToken(rawToken);
  const rows = await prisma.$queryRaw<CustomerSessionRow[]>`
    SELECT id, customer_id, expires_at, revoked_at
      FROM customer_sessions
     WHERE token_hash = ${tokenHash}::text
       AND revoked_at IS NULL
       AND expires_at > now()
  `;
  const row = rows[0];
  if (!row) return null;
  await prisma.$executeRaw`
    UPDATE customer_sessions SET last_seen_at = now() WHERE id = ${row.id}::uuid
  `;
  return { sessionId: row.id, customerId: row.customer_id };
}

/** Revoke one session (idempotent). Returns true if a live session was revoked. */
export async function revokeCustomerSession(rawToken: string): Promise<boolean> {
  if (!rawToken || rawToken.length !== 64) return false;
  const tokenHash = hashToken(rawToken);
  const n = await prisma.$executeRaw`
    UPDATE customer_sessions SET revoked_at = now()
     WHERE token_hash = ${tokenHash}::text AND revoked_at IS NULL
  `;
  return n === 1;
}

/** Revoke every live session of a customer (logout-all / password change). */
export async function revokeAllCustomerSessions(customerId: string): Promise<number> {
  return Number(
    await prisma.$executeRaw`
      UPDATE customer_sessions SET revoked_at = now()
       WHERE customer_id = ${customerId}::uuid AND revoked_at IS NULL
    `,
  );
}

export interface CustomerIdentity {
  customerId: string;
}

/**
 * Server-verified current customer (the single source of truth for
 * storefront ownership). Missing/malformed/forged/expired/revoked → 401
 * UNAUTHENTICATED (never distinguishes); valid session for an unknown
 * customer → 401; inactive/deleted customer → 422 (checkout parity).
 */
export async function requireCustomer(request: Request): Promise<CustomerIdentity> {
  const token = readCustomerToken(request);
  const session = await validateCustomerSessionToken(token);
  if (!session) throw new ApiError("UNAUTHENTICATED", "Authentication is required.", null, false);
  try {
    // Usability gate lives here (not in the token check): locking or
    // deactivating an account takes effect on next use without waiting
    // for session expiry. Dynamic import keeps this module importable in
    // plain-node unit tests — the DB stack loads only at call time.
    const { assertCustomerUsable } = await import("../cart/writes");
    await assertCustomerUsable(session.customerId);
  } catch (error) {
    if (error instanceof ApiError && error.code === "NOT_FOUND") {
      throw new ApiError("UNAUTHENTICATED", "Authentication is required.", null, false);
    }
    throw error;
  }
  return { customerId: session.customerId };
}

/**
 * Optional session customer for read-only/preview contexts (e.g. estimate):
 * returns the customer id when a VALID session is presented, else null.
 * No error distinction is leaked either way.
 */
export async function maybeCustomer(request: Request): Promise<string | null> {
  if (!readCustomerToken(request)) return null;
  try {
    const me = await requireCustomer(request);
    return me.customerId;
  } catch {
    return null;
  }
}

/** Session expiry instant for a token minted now (ISO, response metadata). */
export function sessionExpiryIso(nowMs: number = Date.now()): string {
  return new Date(nowMs + CUSTOMER_SESSION_TTL_SECONDS * 1000).toISOString();
}
