// BG-Guest-Order credential domain (per-order guest access).
//
// True account-less guest orders (orders.customer_id IS NULL) are owned by
// possession of a per-order opaque bearer token — never by order number,
// phone, or name alone (SI-01/SI-02). One credential per order (SI-03);
// SHA-256 hash-only at rest, raw returned once at issuance (SI-04); header
// transport, never URL (SI-10 + log auto-redaction: every field name below
// contains "token"); fixed 90-day TTL, no sliding (BGGO-D002/D009 LOCKED);
// keep-same on idempotent replay (BGGO-D011); revocation by flag (BGGO-D013).
// Storage rule: guest_order_credentials is accessed ONLY through raw SQL in
// this module (mirrors the customer_sessions posture). Reads/writes below
// are all parameterized raw SQL; expiry is gated INSIDE the database
// (single clock source — no JS comparison of decoded TIMESTAMPTZ).
import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError, conflict } from "@/lib/api/errors";
import { hashToken, newOpaqueToken } from "@/lib/auth/tokens";
import {
  GUEST_ORDER_READ_BUCKET_LIMIT,
  checkAndRecordRateLimit,
  guestOrderReadBucket,
} from "@/lib/auth/rate-limit";
import { getOrderFull } from "@/lib/orders/queries";

/** Guest order credential transport header (sole carrier — never URL). */
export const GUEST_ORDER_TOKEN_HEADER = "x-guest-order-token";

/** Guest credential lifetime: 90 days, fixed (no sliding extension). */
export const GUEST_ORDER_CREDENTIAL_TTL_DAYS = 90;

/** Read the presented guest order token (raw header value or null). */
export function readGuestOrderToken(request: Request): string | null {
  const raw = request.headers.get(GUEST_ORDER_TOKEN_HEADER);
  if (!raw) return null;
  const token = raw.trim();
  return token === "" ? null : token;
}

export interface GuestCredentialRecord {
  id: string;
  orderId: string;
  expiresAt: Date;
}

interface GuestCredentialRow {
  id: string;
  order_id: string;
  expires_at: Date;
  revoked_at: Date | null;
}

type Tx = Prisma.TransactionClient;

/**
 * Issue the credential for a guest order (creation path, same tx as the
 * order). Returns the RAW token exactly once — the caller returns it in the
 * creation response body and never persists it. Only the hash is stored.
 */
export async function issueGuestOrderCredential(
  tx: Tx,
  orderId: string,
): Promise<{ token: string; record: GuestCredentialRecord }> {
  const token = newOpaqueToken();
  const rows = await tx.$queryRaw<GuestCredentialRow[]>`
    INSERT INTO guest_order_credentials (order_id, token_hash, expires_at)
    VALUES (
      ${orderId}::uuid,
      ${hashToken(token)}::text,
      now() + (${GUEST_ORDER_CREDENTIAL_TTL_DAYS}::text || ' days')::interval
    )
    RETURNING id, order_id, expires_at, revoked_at
  `;
  const row = rows[0];
  return {
    token,
    record: { id: row.id, orderId: row.order_id, expiresAt: row.expires_at },
  };
}

export type GuestCredentialVerdict =
  | { status: "valid"; credentialId: string; orderId: string }
  | { status: "expired" }
  | { status: "invalid" };

/**
 * Validate a presented token FOR ONE order (order binding is structural:
 * the lookup constrains (token_hash, order_id) together, so a credential
 * for order A can never authorize order B). All invalid states collapse
 * except expiry, which callers surface as 410 Gone (BGGO-D010).
 */
export async function validateGuestOrderToken(
  rawToken: string | undefined | null,
  orderId: string,
): Promise<GuestCredentialVerdict> {
  if (!rawToken || typeof rawToken !== "string" || rawToken.length !== 64) {
    return { status: "invalid" };
  }
  const tokenHash = hashToken(rawToken);
  const live = await prisma.$queryRaw<GuestCredentialRow[]>`
    SELECT id, order_id, expires_at, revoked_at
      FROM guest_order_credentials
     WHERE token_hash = ${tokenHash}::text
       AND order_id = ${orderId}::uuid
       AND revoked_at IS NULL
       AND expires_at > now()
  `;
  if (live.length > 0) {
    return { status: "valid", credentialId: live[0].id, orderId: live[0].order_id };
  }
  const spent = await prisma.$queryRaw<GuestCredentialRow[]>`
    SELECT id, order_id, expires_at, revoked_at
      FROM guest_order_credentials
     WHERE token_hash = ${tokenHash}::text
       AND order_id = ${orderId}::uuid
       AND revoked_at IS NULL
  `;
  if (spent.length > 0) return { status: "expired" };
  return { status: "invalid" };
}

/**
 * Revoke an order's live credential (idempotent; staff/support path).
 * Runs in the caller's tx so revocation + audit commit atomically.
 */
export async function revokeGuestOrderCredential(tx: Tx, orderId: string): Promise<boolean> {
  const n = await tx.$executeRaw`
    UPDATE guest_order_credentials SET revoked_at = now()
     WHERE order_id = ${orderId}::uuid AND revoked_at IS NULL
  `;
  return n >= 1;
}

/**
 * Rotate an order's credential (recovery path): revoke live rows + issue a
 * fresh token in one tx. Returns the new RAW token once. Old tokens die
 * atomically with issuance — no window holds two live credentials.
 */
export async function rotateGuestOrderCredential(
  tx: Tx,
  orderId: string,
): Promise<{ token: string; record: GuestCredentialRecord }> {
  try {
    await tx.$executeRaw`
      UPDATE guest_order_credentials SET revoked_at = now()
       WHERE order_id = ${orderId}::uuid AND revoked_at IS NULL
    `;
    return await issueGuestOrderCredential(tx, orderId);
  } catch (error) {
    // Concurrent rotations serialize on the partial live-UQ: the loser sees
    // 23505 and answers 409 (re-read), never a poisoned 500.
    const code = (
      error as {
        code?: unknown;
        meta?: { driverAdapterError?: { cause?: { code?: unknown; originalCode?: unknown } } };
      }
    ).meta?.driverAdapterError?.cause;
    const pgCode = (code as { code?: unknown; originalCode?: unknown } | undefined)?.code ??
      (code as { originalCode?: unknown } | undefined)?.originalCode;
    if (pgCode === "23505") {
      throw conflict("Concurrent rotation; re-read and retry.", null);
    }
    throw error;
  }
}

export type OrderAccess =
  | { kind: "customer"; customerId: string }
  | { kind: "guest"; credentialId: string };

export type OrderAccessVerdict =
  | { status: "granted"; access: OrderAccess }
  | { status: "expired" }
  | { status: "denied" };

/**
 * Resolve storefront access to ONE order: session ownership first
 * (registered path, unchanged semantics via the caller's customer check),
 * else the guest credential bound to this order id. Callers combine this
 * with their ownership query: customer → getCustomerOrder(id, customerId);
 * guest → order must additionally be a guest order (customer_id IS NULL).
 */
export async function resolveGuestOrderAccess(
  request: Request,
  orderId: string,
): Promise<OrderAccessVerdict> {
  const token = readGuestOrderToken(request);
  if (token === null) return { status: "denied" };
  const verdict = await validateGuestOrderToken(token, orderId);
  if (verdict.status === "valid") {
    return { status: "granted", access: { kind: "guest", credentialId: verdict.credentialId } };
  }
  if (verdict.status === "expired") return { status: "expired" };
  return { status: "denied" };
}

function requestIp(request: Request): string | null {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

/**
 * Shared guest-order gate for storefront routes (BGGO-D009/D010): read
 * bucket first (fail-closed 429), then credential validation bound to the
 * path order id (401 invalid/revoked, 410 expired), then the order row with
 * the guest separation check (credentials exist only for customer_id NULL
 * orders — anything else reads 404, never leaked). Throws; never returns
 * null. Callers run this only when no valid customer session owns the order.
 */
export async function requireGuestOrder(request: Request, orderId: string) {
  const gate = await checkAndRecordRateLimit(
    guestOrderReadBucket(requestIp(request)),
    GUEST_ORDER_READ_BUCKET_LIMIT,
    undefined,
    "guest_order_rate_limits",
  );
  if (!gate.allowed) {
    throw new ApiError("RATE_LIMITED", "Too many requests.", null, true);
  }
  const access = await resolveGuestOrderAccess(request, orderId);
  if (access.status === "expired") {
    throw new ApiError("GONE", "Guest order access has expired.", null);
  }
  if (access.status !== "granted") {
    throw new ApiError("UNAUTHENTICATED", "Authentication is required.", null, false);
  }
  const full = await getOrderFull(orderId);
  if (!full || full.customerId !== null) {
    throw new ApiError("NOT_FOUND", "Order not found.", null);
  }
  return full;
}
