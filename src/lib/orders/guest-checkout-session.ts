// Guest checkout recovery sessions (pre-established, cart-bound, order-bound).
//
// Problem closed (P10-L-08): the per-order guest credential is returned only
// once in the fresh 201. If that response is lost after the server committed,
// a same-key replay returns 200 with no credential — the guest can prove the
// order exists but cannot open it. Reissuing the credential on replay would
// break the keep-same contract and widen the secret surface.
//
// Fix: BEFORE order creation the browser obtains an HttpOnly checkout session
// (24h fixed TTL, no sliding). Only its SHA-256 hash is stored. The session is
// bound to the guest cart at mint time and bound to the created order inside
// the SAME create transaction. A same-key replay (or a confirmation read) can
// therefore authorize the bound order without ever reissuing or exposing the
// 90-day per-order credential. The session grants nothing for any other order,
// creates no customer row, and stores no PII.
//
// Storage rule mirrors guest_order_credentials: raw SQL only, hash-only at
// rest, expiry enforced inside PostgreSQL (`expires_at > now()`), revocation by
// flag (rows are history, never deleted by the app).
import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { hashToken, newOpaqueToken } from "@/lib/auth/tokens";
import {
  GUEST_CHECKOUT_SESSION_HEADER,
  readGuestCheckoutToken,
} from "@/lib/orders/guest-checkout-cookie";

export { GUEST_CHECKOUT_SESSION_HEADER, readGuestCheckoutToken };

/** Guest checkout recovery session lifetime: 24 hours, fixed (no sliding). */
export const GUEST_CHECKOUT_SESSION_TTL_HOURS = 24;

interface SessionRow {
  id: string;
  expires_at: Date;
}

type Tx = Prisma.TransactionClient;

/**
 * Storage hash of the presented checkout token (header first, then cookie), or
 * null when absent. The raw token never leaves the transport layer.
 */
export function presentedGuestCheckoutSessionHash(request: Request): string | null {
  const token = readGuestCheckoutToken(request);
  return token === null ? null : hashToken(token);
}

/**
 * Mint a recovery session bound to one guest cart. Returns the RAW token
 * exactly once (the caller puts it in an HttpOnly cookie and never in a body).
 */
export async function issueGuestCheckoutSession(cartId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = newOpaqueToken();
  const rows = await prisma.$queryRaw<SessionRow[]>`
    INSERT INTO guest_checkout_sessions (token_hash, cart_id, expires_at)
    VALUES (
      ${hashToken(token)}::text,
      ${cartId}::uuid,
      now() + (${GUEST_CHECKOUT_SESSION_TTL_HOURS}::text || ' hours')::interval
    )
    RETURNING id, expires_at`;
  return { token, expiresAt: rows[0].expires_at };
}

/**
 * Bind a live session to the order it just helped create. Runs INSIDE the
 * create transaction, after the order row exists. Returns false when the
 * presented session is unknown/expired/revoked/already bound or belongs to a
 * different cart — the caller decides whether that is fatal.
 */
export async function bindGuestCheckoutSessionToOrder(
  tx: Tx,
  tokenHash: string,
  orderId: string,
  cartId: string,
): Promise<boolean> {
  const n = await tx.$executeRaw`
    UPDATE guest_checkout_sessions
       SET order_id = ${orderId}::uuid
     WHERE token_hash = ${tokenHash}::text
       AND cart_id = ${cartId}::uuid
       AND order_id IS NULL
       AND revoked_at IS NULL
       AND expires_at > now()`;
  return n === 1;
}

/** Structural read check: this session is live AND bound to this exact order. */
export async function isGuestCheckoutSessionBoundToOrder(
  rawToken: string | null | undefined,
  orderId: string,
): Promise<boolean> {
  if (!rawToken || typeof rawToken !== "string" || rawToken.length !== 64) return false;
  const rows = await prisma.$queryRaw<Array<{ one: number }>>`
    SELECT 1 AS one
      FROM guest_checkout_sessions
     WHERE token_hash = ${hashToken(rawToken)}::text
       AND order_id = ${orderId}::uuid
       AND revoked_at IS NULL
       AND expires_at > now()`;
  return rows.length > 0;
}

/**
 * Revoke every live recovery session bound to an order. Called by credential
 * revocation/rotation so the two access paths cannot diverge (rotating the
 * order credential must also kill the recovery path it replaces).
 */
export async function revokeGuestCheckoutSessionsForOrder(tx: Tx, orderId: string): Promise<number> {
  return tx.$executeRaw`
    UPDATE guest_checkout_sessions SET revoked_at = now()
     WHERE order_id = ${orderId}::uuid AND revoked_at IS NULL`;
}
