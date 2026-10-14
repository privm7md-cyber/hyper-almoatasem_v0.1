import "server-only";
// DB-backed login rate limiting (serverless-safe).
// Buckets are opaque strings ("login:ip:<ip>" / "login:acct:<email>") with a
// fixed window; a single INSERT ... ON CONFLICT DO UPDATE statement bumps the
// counter atomically, so concurrent requests cannot lose increments. Expired
// windows are pruned opportunistically (best-effort, same call). No in-memory
// Maps: state lives in PostgreSQL, so every instance/serverless invocation
// shares one consistent view. No Redis, no new services.
import { prisma } from "@/lib/db";
import { regPhoneBucketKey } from "./reg-phone-bucket";

export const IP_BUCKET_LIMIT = 30;
export const ACCOUNT_BUCKET_LIMIT = 10;
export const RATE_WINDOW_MINUTES = 15;

export interface RateDecision {
  allowed: boolean;
  attempts: number;
}

export function ipBucket(ip: string | null | undefined): string {
  return `login:ip:${ip ?? "unknown"}`;
}

export function accountBucket(email: string): string {
  return `login:acct:${email}`;
}

/** Customer-login buckets (separate accounting from admin — isolation). */
export function customerIpBucket(ip: string | null | undefined): string {
  return `login:cust-ip:${ip ?? "unknown"}`;
}

export function customerAccountBucket(canonicalPhone: string): string {
  return `login:cust-acct:${canonicalPhone}`;
}

/** Customer-registration buckets (G5 hardening): isolated from login buckets
 * so registration attempts neither consume nor poison login counters.
 * Approved initial thresholds: IP 30 + canonical-phone 10 per 15-minute
 * window (mirrors the login cost/abuse profile — each attempt burns an
 * Argon2 hash + a transactional write). The phone bucket key is HMAC-bound
 * via `./reg-phone-bucket` (dedicated secret, no raw phone persisted, no
 * new secret invented silently — see that module for the contract). */
export const REG_REGISTER_IP_LIMIT = 30;
export const REG_REGISTER_PHONE_LIMIT = 10;

export function customerRegIpBucket(ip: string | null | undefined): string {
  return `reg:cust-ip:${ip ?? "unknown"}`;
}

export function customerRegPhoneBucket(canonicalPhone: string): string {
  return regPhoneBucketKey(canonicalPhone);
}

type RateLimitTable =
  | "admin_auth_rate_limits"
  | "customer_auth_rate_limits"
  | "guest_order_rate_limits";

/** Guest-order bucket keys (isolated table — guest accounting never shares
 * admin/customer buckets). BGGO-D009 (LOCKED): creation 10/15min/IP,
 * reads 60/15min/IP. */
export const GUEST_ORDER_CREATE_BUCKET_LIMIT = 10;
export const GUEST_ORDER_READ_BUCKET_LIMIT = 60;

export function guestOrderCreateBucket(ip: string | null | undefined): string {
  return `guest-order:ip:${ip ?? "unknown"}`;
}

export function guestOrderReadBucket(ip: string | null | undefined): string {
  return `guest-order:read-ip:${ip ?? "unknown"}`;
}

/** Atomically record one attempt; returns whether the bucket is still open.
 * Table is restricted to the allowlisted bucket tables (never interpolated
 * from caller input — static statements only). */
export async function checkAndRecordRateLimit(
  bucketKey: string,
  limit: number,
  windowMinutes: number = RATE_WINDOW_MINUTES,
  table: RateLimitTable = "admin_auth_rate_limits",
): Promise<RateDecision> {
  // Fixed windows aligned to 15-minute boundaries (serverless-consistent).
  // One static statement per allowlisted table — the table name is never
  // interpolated from input.
  let bumped: { attempts: number }[];
  if (table === "customer_auth_rate_limits") {
    bumped = (await prisma.$queryRaw<{ attempts: number }[]>`
    INSERT INTO customer_auth_rate_limits (bucket_key, window_start, attempts)
    VALUES (
      ${bucketKey}::text,
      date_trunc('hour', now()) + (floor(date_part('minute', now()) / 15) * interval '15 minutes'),
      1
    )
    ON CONFLICT (bucket_key, window_start)
    DO UPDATE SET attempts = customer_auth_rate_limits.attempts + 1,
                  updated_at = now()
    RETURNING attempts
  `) as unknown as { attempts: number }[];
    await prisma.$executeRaw`
      DELETE FROM customer_auth_rate_limits
       WHERE window_start < now() - (${windowMinutes}::text || ' minutes')::interval
    `.catch(() => {});
  } else if (table === "guest_order_rate_limits") {
    bumped = (await prisma.$queryRaw<{ attempts: number }[]>`
    INSERT INTO guest_order_rate_limits (bucket_key, window_start, attempts)
    VALUES (
      ${bucketKey}::text,
      date_trunc('hour', now()) + (floor(date_part('minute', now()) / 15) * interval '15 minutes'),
      1
    )
    ON CONFLICT (bucket_key, window_start)
    DO UPDATE SET attempts = guest_order_rate_limits.attempts + 1,
                  updated_at = now()
    RETURNING attempts
  `) as unknown as { attempts: number }[];
    await prisma.$executeRaw`
      DELETE FROM guest_order_rate_limits
       WHERE window_start < now() - (${windowMinutes}::text || ' minutes')::interval
    `.catch(() => {});
  } else {
    bumped = (await prisma.$queryRaw<{ attempts: number }[]>`
    INSERT INTO admin_auth_rate_limits (bucket_key, window_start, attempts)
    VALUES (
      ${bucketKey}::text,
      date_trunc('hour', now()) + (floor(date_part('minute', now()) / 15) * interval '15 minutes'),
      1
    )
    ON CONFLICT (bucket_key, window_start)
    DO UPDATE SET attempts = admin_auth_rate_limits.attempts + 1,
                  updated_at = now()
    RETURNING attempts
  `) as unknown as { attempts: number }[];
    // Opportunistic TTL cleanup (expired windows only; never touches live rows).
    await prisma.$executeRaw`
      DELETE FROM admin_auth_rate_limits
       WHERE window_start < now() - (${windowMinutes}::text || ' minutes')::interval
    `.catch(() => {});
  }
  const attempts = Number(bumped[0]?.attempts ?? limit + 1);
  return { allowed: attempts <= limit, attempts };
}
