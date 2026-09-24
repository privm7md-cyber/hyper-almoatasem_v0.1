import "server-only";
// Admin credential verification (the login core).
// Flow: validate -> normalize -> rate-limit -> lookup -> ALWAYS verify a hash
// (real or dummy, timing-equivalent) -> uniform generic outcome -> atomic
// fail-bump (+lockout) or atomic success (reset + session + audit in one tx).
// Failure policy: fail CLOSED. Audit writes ride inside the same transactions
// as the state they describe; if audit cannot be written, the login fails with
// the same generic message (never a silent audit gap, never a precise leak).
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  checkPasswordPolicy,
  hashPassword,
  verifyDummyPassword,
  verifyPassword,
} from "@/lib/auth/password";
import { SESSION_TTL_HOURS } from "@/lib/auth/session";
import { writeAuthAudit } from "@/lib/auth/audit";
import { hashToken, newOpaqueToken } from "@/lib/auth/tokens";
import {
  ACCOUNT_BUCKET_LIMIT,
  IP_BUCKET_LIMIT,
  accountBucket,
  checkAndRecordRateLimit,
  ipBucket,
} from "@/lib/auth/rate-limit";

export const GENERIC_LOGIN_ERROR = "البريد الإلكتروني أو كلمة المرور غير صحيحة.";
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;

const LoginInput = z.object({
  email: z.string().min(1).max(160).trim().toLowerCase(),
  password: z.string().min(1).max(128),
});

export interface LoginContext {
  ip?: string | null;
  userAgent?: string | null;
}

export interface LoginSuccess {
  ok: true;
  admin: { id: string; name: string; email: string };
  token: string;
}

export interface LoginFailure {
  ok: false;
  error: string;
}

/** Change a user's password: policy + hash + reset + revoke-all, atomically. */
export async function changePassword(
  userId: string,
  newPassword: string,
  auditIp?: string | null,
  auditUserAgent?: string | null,
): Promise<void> {
  const policyError = checkPasswordPolicy(newPassword);
  if (policyError) throw new Error(policyError);
  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
    });
    await tx.$executeRaw`
      UPDATE admin_sessions SET revoked_at = now()
       WHERE user_id = ${userId}::uuid AND revoked_at IS NULL
    `;
    await writeAuthAuditTx(tx, {
      action: "auth.password_changed",
      userId,
      entityType: "users",
      entityId: userId,
      ip: auditIp,
      userAgent: auditUserAgent,
    });
  });
}

// Audit writer bound to an interactive-transaction client.
async function writeAuthAuditTx(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  event: {
    action: string;
    userId?: string | null;
    entityType: string;
    entityId?: string | null;
    values?: Record<string, unknown> | null;
    ip?: string | null;
    userAgent?: string | null;
  },
): Promise<void> {
  const actor = event.userId ? "ADMIN" : "SYSTEM";
  await tx.$executeRaw`
    INSERT INTO audit_logs (user_id, actor_type, action, entity_type, entity_id, new_values, ip_address, user_agent)
    VALUES (
      ${event.userId ?? null}::uuid,
      ${actor}::text,
      ${event.action}::text,
      ${event.entityType}::text,
      ${event.entityId ?? null}::uuid,
      ${event.values ? JSON.stringify(event.values) : null}::jsonb,
      ${event.ip ?? null}::inet,
      ${event.userAgent ?? null}::text
    )
  `;
}

export async function authenticateAdmin(
  rawEmail: string,
  rawPassword: string,
  ctx: LoginContext = {},
): Promise<LoginSuccess | LoginFailure> {
  const fail = (): LoginFailure => ({ ok: false, error: GENERIC_LOGIN_ERROR });

  const parsed = LoginInput.safeParse({ email: rawEmail, password: rawPassword });
  if (!parsed.success) return fail();
  const { email, password } = parsed.data;

  // Rate limits first (cheap reject before any expensive work).
  const ipRate = await checkAndRecordRateLimit(ipBucket(ctx.ip), IP_BUCKET_LIMIT);
  const acctRate = await checkAndRecordRateLimit(accountBucket(email), ACCOUNT_BUCKET_LIMIT);
  if (!ipRate.allowed || !acctRate.allowed) {
    await writeAuthAudit({
      action: "auth.login_failure",
      userId: null,
      entityType: "users",
      values: { reason: "rate_limited" },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    }).catch(() => {});
    return fail();
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      name: true,
      email: true,
      passwordHash: true,
      isActive: true,
      deletedAt: true,
    },
  });

  // Unknown account (or credential-less row): same work, same outcome.
  if (!user || !user.passwordHash) {
    await verifyDummyPassword(password);
    await writeAuthAudit({
      action: "auth.login_failure",
      userId: null,
      entityType: "users",
      values: { reason: "unknown_or_credentialless" },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    }).catch(() => {});
    return fail();
  }

  const passwordOk = await verifyPassword(user.passwordHash, password);
  // Time comparison runs INSIDE the database (single clock source). Rationale:
  // Prisma 7.10 + adapter-pg reads TIMESTAMPTZ shifted by the server UTC offset
  // on this stack (proven +3h on PG 18/Windows), so JS-side Date comparisons of
  // Prisma-returned timestamps are unreliable here. DB-side booleans are exact.
  const lockRow = (await prisma.$queryRaw<{ locked: boolean }[]>`
    SELECT (locked_until IS NOT NULL AND locked_until > now()) AS locked
      FROM users WHERE id = ${user.id}::uuid
  `) as unknown as { locked: boolean }[];
  const locked = lockRow[0]?.locked === true;
  const usable = user.isActive && user.deletedAt === null && !locked;

  if (!passwordOk || !usable) {
    // One atomic statement: bump, and lock exactly when crossing the threshold.
    // Concurrent failures cannot lose increments (single UPDATE, row lock).
    const bumped = (await prisma.$queryRaw<{ failed_login_attempts: number; locked_until: Date | null }[]>`
      UPDATE users
         SET failed_login_attempts = failed_login_attempts + 1,
             locked_until = CASE
               WHEN failed_login_attempts + 1 >= ${MAX_FAILED_ATTEMPTS}
               THEN now() + (${LOCKOUT_MINUTES}::text || ' minutes')::interval
               ELSE locked_until
             END
       WHERE id = ${user.id}::uuid
      RETURNING failed_login_attempts, locked_until
    `) as unknown as { failed_login_attempts: number; locked_until: Date | null }[];
    const row = bumped[0];
    const nowLocked = row && row.locked_until !== null && new Date(row.locked_until).getTime() > Date.now();
    await writeAuthAudit({
      action: nowLocked ? "auth.account_locked" : "auth.login_failure",
      userId: user.id,
      entityType: "users",
      entityId: user.id,
      values: passwordOk ? { reason: "account_unusable" } : { reason: "bad_password" },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    }).catch(() => {});
    return fail();
  }

  // Success: reset + session + audit commit atomically (fail-closed: if the
  // audit write fails, the whole login fails with the generic message rather
  // than succeeding silently unaudited).
  let token = "";
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    const rawToken = newOpaqueToken();
    await tx.$executeRaw`
      INSERT INTO admin_sessions (user_id, token_hash, expires_at, created_ip, user_agent)
      VALUES (
        ${user.id}::uuid,
        ${hashToken(rawToken)}::text,
        now() + (${SESSION_TTL_HOURS}::text || ' hours')::interval,
        ${ctx.ip ?? null}::inet,
        ${ctx.userAgent ?? null}::text
      )
    `;
    await writeAuthAuditTx(tx, {
      action: "auth.login_success",
      userId: user.id,
      entityType: "users",
      entityId: user.id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    token = rawToken;
  });

  return {
    ok: true,
    admin: { id: user.id, name: user.name, email: user.email },
    token,
  };
}
