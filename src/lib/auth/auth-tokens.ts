import "server-only";
// One-time auth tokens (INVITATION | PASSWORD_RESET).
// Plaintext exists exactly once (at creation, delivered out-of-band); only the
// SHA-256 hex digest is stored. Consumption is a single atomic UPDATE that
// succeeds for exactly one caller: used_at IS NULL + not expired + purpose
// (+ user, where applicable) must ALL hold in the same statement, so
// concurrent consumes yield a single winner. No reset/invitation emails or
// routes are built here — this module is the tested lifecycle core.
import { prisma } from "@/lib/db";
import { hashToken, newOpaqueToken } from "@/lib/auth/tokens";

export const INVITATION_TTL_HOURS = 72;
export const PASSWORD_RESET_TTL_HOURS = 1;

export type AuthTokenPurpose = "INVITATION" | "PASSWORD_RESET";

export interface CreatedToken {
  id: string;
  token: string; // plaintext — handle once, never log, never store
  expiresAt: Date;
}

export async function createAuthToken(input: {
  userId: string;
  purpose: AuthTokenPurpose;
  ttlHours: number;
}): Promise<CreatedToken> {
  const token = newOpaqueToken();
  const created = await prisma.adminAuthToken.create({
    data: {
      userId: input.userId,
      purpose: input.purpose,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + input.ttlHours * 60 * 60 * 1000),
    },
    select: { id: true, expiresAt: true },
  });
  return { id: created.id, token, expiresAt: created.expiresAt };
}

/**
 * Atomically consume a token. Returns the token row id + owner on the single
 * successful call; null for expired/used/wrong-purpose/wrong-user/unknown.
 */
export async function consumeAuthToken(input: {
  token: string;
  purpose: AuthTokenPurpose;
  expectedUserId?: string;
}): Promise<{ id: string; userId: string } | null> {
  if (!input.token || input.token.length !== 64) return null;
  const tokenHash = hashToken(input.token);
  const rows = (await prisma.$queryRaw<{ id: string; user_id: string }[]>`
    UPDATE admin_auth_tokens SET used_at = now()
     WHERE token_hash = ${tokenHash}::text
       AND purpose = ${input.purpose}::text
       AND used_at IS NULL
       AND expires_at > now()
       AND (${input.expectedUserId ?? null}::uuid IS NULL OR user_id = ${input.expectedUserId ?? null}::uuid)
    RETURNING id, user_id
  `) as unknown as { id: string; user_id: string }[];
  const row = rows[0];
  return row ? { id: row.id, userId: row.user_id } : null;
}
