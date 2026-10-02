import "server-only";
// DB-backed opaque admin sessions.
// Storage rule: the sessions table is accessed ONLY through raw SQL in this
// module. Reason: AdminSession carries created_ip (inet, Unsupported-mapped),
// and Prisma 7.10 query-build fails on models containing Unsupported fields
// (proven on audit_logs). Reads, writes and revocations below all use
// parameterized raw SQL — never prisma.adminSession.
// Lifecycle: fixed expiry (no sliding), last_seen_at touch on validation,
// revocation by flag (rows are history, never deleted by the app).
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { hashToken, newOpaqueToken } from "@/lib/auth/tokens";

export const SESSION_COOKIE_NAME = "__Host-admin-session";
// Admin session lifetime: 8 hours, fixed (no sliding extension by design).
export const SESSION_TTL_HOURS = 8;

export interface SessionRecord {
  id: string;
  userId: string;
  expiresAt: Date;
}

interface SessionRow {
  id: string;
  user_id: string;
  expires_at: Date;
  revoked_at: Date | null;
}

/** Create a session row + return the RAW token (once). Caller sets the cookie. */
export async function createSession(input: {
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{ token: string; record: SessionRecord }> {
  const token = newOpaqueToken();
  const tokenHash = hashToken(token);
  const rows = await prisma.$queryRaw<SessionRow[]>`
    INSERT INTO admin_sessions (user_id, token_hash, expires_at, created_ip, user_agent)
    VALUES (
      ${input.userId}::uuid,
      ${tokenHash}::text,
      (now() + (${SESSION_TTL_HOURS}::text || ' hours')::interval),
      ${input.ip ?? null}::inet,
      ${input.userAgent ?? null}::text
    )
    RETURNING id, user_id, expires_at, revoked_at
  `;
  const row = rows[0];
  return {
    token,
    record: { id: row.id, userId: row.user_id, expiresAt: row.expires_at },
  };
}

export interface ValidatedSession {
  sessionId: string;
  userId: string;
}

/**
 * Validate a raw session token. Checks existence, revocation, expiry, and
 * touches last_seen_at. Returns null for ANY invalid state (callers treat all
 * nulls identically — no reason is leaked).
 */
export async function validateSessionToken(
  rawToken: string | undefined | null,
): Promise<ValidatedSession | null> {
  if (!rawToken || typeof rawToken !== "string" || rawToken.length !== 64) {
    return null;
  }
  const tokenHash = hashToken(rawToken);
  // Expiry is gated INSIDE the database (single clock source — the ONLY
  // truth here). No JS re-check on the decoded timestamp: Prisma 7.10
  // TIMESTAMPTZ decoding shifts instants on this stack (proven,
  // DST-varying — CC-1 class), so any JS comparison here could wrongly
  // reject valid sessions or (worse) mask the SQL decision. The SQL
  // predicate above is necessary AND sufficient.
  const rows = await prisma.$queryRaw<SessionRow[]>`
    SELECT id, user_id, expires_at, revoked_at
      FROM admin_sessions
     WHERE token_hash = ${tokenHash}::text
       AND revoked_at IS NULL
       AND expires_at > now()
   `;
  const row = rows[0];
  if (!row) return null;
  await prisma.$executeRaw`
    UPDATE admin_sessions SET last_seen_at = now() WHERE id = ${row.id}::uuid
  `;
  return { sessionId: row.id, userId: row.user_id };
}

/** Revoke one session (idempotent). Returns true if a live session was revoked. */
export async function revokeSession(rawToken: string): Promise<boolean> {
  if (!rawToken || rawToken.length !== 64) return false;
  const tokenHash = hashToken(rawToken);
  const n = await prisma.$executeRaw`
    UPDATE admin_sessions SET revoked_at = now()
     WHERE token_hash = ${tokenHash}::text AND revoked_at IS NULL
  `;
  return n === 1;
}

/** Revoke every live session of a user (logout-all / rotation / disable). */
export async function revokeAllSessions(
  userId: string,
  exceptSessionId?: string | null,
): Promise<number> {
  if (exceptSessionId) {
    return Number(
      await prisma.$executeRaw`
        UPDATE admin_sessions SET revoked_at = now()
         WHERE user_id = ${userId}::uuid
           AND revoked_at IS NULL
           AND id <> ${exceptSessionId}::uuid
      `,
    );
  }
  return Number(
    await prisma.$executeRaw`
      UPDATE admin_sessions SET revoked_at = now()
       WHERE user_id = ${userId}::uuid AND revoked_at IS NULL
    `,
  );
}

const isProd = process.env.NODE_ENV === "production";

/** Set the session cookie. __Host- requires Secure + Path=/ + no Domain. */
export async function setSessionCookie(rawToken: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_HOURS * 60 * 60,
  });
}

/** Clear the session cookie (always paired with server-side revocation). */
export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
}

/** Read the raw session token from the request cookies (presence only). */
export async function readSessionCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE_NAME)?.value ?? null;
}
