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

/** Atomically record one attempt; returns whether the bucket is still open. */
export async function checkAndRecordRateLimit(
  bucketKey: string,
  limit: number,
  windowMinutes: number = RATE_WINDOW_MINUTES,
): Promise<RateDecision> {
  // Fixed windows aligned to 15-minute boundaries (serverless-consistent).
  const bumped = (await prisma.$queryRaw<{ attempts: number }[]>`
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
  const attempts = Number(bumped[0]?.attempts ?? limit + 1);
  // Opportunistic TTL cleanup (expired windows only; never touches live rows).
  await prisma.$executeRaw`
    DELETE FROM admin_auth_rate_limits
     WHERE window_start < now() - (${windowMinutes}::text || ' minutes')::interval
  `.catch(() => {});
  return { allowed: attempts <= limit, attempts };
}
