import "server-only";
// DB-backed login rate limiting (serverless-safe).
// Buckets are opaque strings ("login:ip:<ip>" / "login:acct:<email>") with a
// fixed window; a single INSERT ... ON CONFLICT DO UPDATE statement bumps the
// counter atomically, so concurrent requests cannot lose increments. Expired
// windows are pruned opportunistically (best-effort, same call). No in-memory
// Maps: state lives in PostgreSQL, so every instance/serverless invocation
// shares one consistent view. No Redis, no new services.
import { prisma } from "@/lib/db";

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

type RateLimitTable = "admin_auth_rate_limits" | "customer_auth_rate_limits";

/** Atomically record one attempt; returns whether the bucket is still open.
 * Table is restricted to the two login bucket tables (never interpolated
 * from caller input — static allowlist only). */
export async function checkAndRecordRateLimit(
  bucketKey: string,
  limit: number,
  windowMinutes: number = RATE_WINDOW_MINUTES,
  table: RateLimitTable = "admin_auth_rate_limits",
): Promise<RateDecision> {
  // Fixed windows aligned to 15-minute boundaries (serverless-consistent).
  // Two static statements (one per allowlisted table) — the table name is
  // never interpolated from input.
  const bumped =
    table === "customer_auth_rate_limits"
      ? ((await prisma.$queryRaw<{ attempts: number }[]>`
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
  `) as unknown as { attempts: number }[])
      : ((await prisma.$queryRaw<{ attempts: number }[]>`
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
  `) as unknown as { attempts: number }[]);
  const attempts = Number(bumped[0]?.attempts ?? limit + 1);
  // Opportunistic TTL cleanup (expired windows only; never touches live rows).
  if (table === "customer_auth_rate_limits") {
    await prisma.$executeRaw`
      DELETE FROM customer_auth_rate_limits
       WHERE window_start < now() - (${windowMinutes}::text || ' minutes')::interval
    `.catch(() => {});
  } else {
    await prisma.$executeRaw`
      DELETE FROM admin_auth_rate_limits
       WHERE window_start < now() - (${windowMinutes}::text || ' minutes')::interval
    `.catch(() => {});
  }
  return { allowed: attempts <= limit, attempts };
}
