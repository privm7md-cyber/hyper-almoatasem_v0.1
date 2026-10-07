// PHASE 2.5 customer credential authentication (phone + password).
//
// Mirrors the admin login core (src/lib/auth/login.ts) with customer
// semantics: rate-limit → lookup → ALWAYS verify a hash (real or dummy,
// timing-equivalent) → uniform generic outcome → atomic fail-bump
// (+lockout) or atomic success (reset + server-side session).
// Failure policy: fail CLOSED. Differences from admin auth, all deliberate:
// - identity key is the canonical phone (frozen R8 ladder), not email;
// - sessions live in customer_sessions (revocable server-side);
// - rate buckets live in customer_auth_rate_limits (isolation: admin and
//   customer accounting never mix);
// - NO audit rows: audit_logs.user_id references users(id) and ADMIN actor
//   rows require admin actors — customer self-service stays unaudited per
//   the frozen rule (brute-force visibility comes from buckets + lockout).
// Passwords never log, never persist except as Argon2id hashes (reused
// checkPasswordPolicy/hashPassword/verifyPassword/verifyDummyPassword).
import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  checkPasswordPolicy,
  hashPassword,
  verifyDummyPassword,
  verifyPassword,
} from "@/lib/auth/password";
import { hashToken, newOpaqueToken } from "@/lib/auth/tokens";
import {
  ACCOUNT_BUCKET_LIMIT,
  IP_BUCKET_LIMIT,
  checkAndRecordRateLimit,
  customerAccountBucket,
  customerIpBucket,
} from "@/lib/auth/rate-limit";
import { normalizeIdentityPhone } from "@/lib/customers/phone";
import { newUuidV7 } from "@/lib/customers/writes";

export const GENERIC_CUSTOMER_AUTH_ERROR = "رقم الهاتف أو كلمة المرور غير صحيحة.";
export const CUSTOMER_MAX_FAILED_ATTEMPTS = 5;
export const CUSTOMER_LOCKOUT_MINUTES = 15;
/** Customer session lifetime: 30 days, fixed (no sliding extension). */
export const CUSTOMER_SESSION_TTL_DAYS = 30;

const LoginInput = z.object({
  phone: z.string().min(1).max(32),
  password: z.string().min(1).max(128),
});

const RegisterInput = z.object({
  phone: z.string().min(1).max(32),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80).nullish(),
  password: z.string().min(1).max(128),
});

export interface CustomerAuthContext {
  ip?: string | null;
  userAgent?: string | null;
}

export interface CustomerAuthSuccess {
  ok: true;
  customer: { id: string; firstName: string; phone: string };
  token: string;
}

export interface CustomerAuthFailure {
  ok: false;
  error: string;
}

/**
 * Self-service registration: phone + password → registered customer +
 * authenticated session. An existing UNREGISTERED (guest) row for the
 * phone is converted in place (sets password + is_registered — the
 * self-service counterpart of upgradeToRegistered); an already-registered
 * phone answers 409 (duplicate registration is an accepted, documented
 * enumeration surface — login itself stays uniform).
 */
export async function registerCustomer(
  raw: { phone: string; firstName: string; lastName?: string | null; password: string },
  ctx: CustomerAuthContext = {},
): Promise<CustomerAuthSuccess | CustomerAuthFailure> {
  const parsed = RegisterInput.safeParse({
    phone: raw.phone,
    firstName: raw.firstName,
    lastName: raw.lastName ?? null,
    password: raw.password,
  });
  if (!parsed.success) {
    return { ok: false, error: "Invalid registration." };
  }
  let canonical: string;
  try {
    canonical = normalizeIdentityPhone(parsed.data.phone);
  } catch {
    return { ok: false, error: "Invalid registration." };
  }
  const policyError = checkPasswordPolicy(parsed.data.password);
  if (policyError) return { ok: false, error: "Invalid registration." };
  const existing = await prisma.customer.findUnique({ where: { phone: canonical } });
  if (existing) {
    if (existing.isRegistered || existing.passwordHash !== null) {
      return { ok: false, error: "An account with this phone already exists." };
    }
    if (!existing.isActive || existing.deletedAt !== null) {
      return { ok: false, error: "Invalid registration." };
    }
    // Guest-row conversion: set credential + registered flag, reset lockout
    // counters, mint a session — one transaction.
    const passwordHash = await hashPassword(parsed.data.password);
    const token = newOpaqueToken();
    const converted = await prisma.$transaction(async (tx) => {
      const row = await tx.customer.update({
        where: { id: existing.id },
        data: {
          passwordHash,
          isRegistered: true,
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });
      await tx.$executeRaw`
        INSERT INTO customer_sessions (customer_id, token_hash, expires_at, created_ip, user_agent)
        VALUES (
          ${existing.id}::uuid,
          ${hashToken(token)}::text,
          now() + (${CUSTOMER_SESSION_TTL_DAYS}::text || ' days')::interval,
          ${ctx.ip ?? null}::inet,
          ${ctx.userAgent ?? null}::text
        )
      `;
      return row;
    });
    return {
      ok: true,
      customer: { id: converted.id, firstName: converted.firstName, phone: converted.phone },
      token,
    };
  }
  const passwordHash = await hashPassword(parsed.data.password);
  const token = newOpaqueToken();
  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.customer.create({
      data: {
        id: newUuidV7(),
        firstName: parsed.data.firstName,
        lastName: parsed.data.lastName ?? null,
        phone: canonical,
        passwordHash,
        isRegistered: true,
      },
    });
    await tx.$executeRaw`
      INSERT INTO customer_sessions (customer_id, token_hash, expires_at, created_ip, user_agent)
      VALUES (
        ${row.id}::uuid,
        ${hashToken(token)}::text,
        now() + (${CUSTOMER_SESSION_TTL_DAYS}::text || ' days')::interval,
        ${ctx.ip ?? null}::inet,
        ${ctx.userAgent ?? null}::text
      )
    `;
    return row;
  });
  return {
    ok: true,
    customer: { id: created.id, firstName: created.firstName, phone: created.phone },
    token,
  };
}

export async function authenticateCustomer(
  rawPhone: string,
  rawPassword: string,
  ctx: CustomerAuthContext = {},
): Promise<CustomerAuthSuccess | CustomerAuthFailure> {
  const fail = (): CustomerAuthFailure => ({ ok: false, error: GENERIC_CUSTOMER_AUTH_ERROR });

  const parsed = LoginInput.safeParse({ phone: rawPhone, password: rawPassword });
  if (!parsed.success) return fail();
  const { phone, password } = parsed.data;
  let canonical: string | null = null;
  try {
    canonical = normalizeIdentityPhone(phone);
  } catch {
    // Unladderable phone: still burn rate budget + dummy work, then fail
    // uniformly (never reveal ladder validity).
  }

  // Rate limits first (cheap reject before any expensive work). The account
  // bucket keys on the canonical phone when available, else the raw input.
  const ipRate = await checkAndRecordRateLimit(
    customerIpBucket(ctx.ip),
    IP_BUCKET_LIMIT,
    undefined,
    "customer_auth_rate_limits",
  );
  const acctRate = await checkAndRecordRateLimit(
    customerAccountBucket(canonical ?? phone.trim()),
    ACCOUNT_BUCKET_LIMIT,
    undefined,
    "customer_auth_rate_limits",
  );
  if (!ipRate.allowed || !acctRate.allowed) return fail();

  const customer =
    canonical === null
      ? null
      : await prisma.customer.findUnique({
          where: { phone: canonical },
          select: { id: true, firstName: true, phone: true, passwordHash: true },
        });

  // Unknown phone (or credential-less row): same work, same outcome.
  if (!customer || !customer.passwordHash) {
    await verifyDummyPassword(password);
    return fail();
  }

  const passwordOk = await verifyPassword(customer.passwordHash, password);
  // Lockout + usability are decided INSIDE the database (single clock
  // source — never compare Prisma-decoded TIMESTAMPTZ in JS on this stack).
  const stateRows = (await prisma.$queryRaw<{ locked: boolean; usable: boolean }[]>`
    SELECT (locked_until IS NOT NULL AND locked_until > now()) AS locked,
           (is_active AND deleted_at IS NULL) AS usable
      FROM customers WHERE id = ${customer.id}::uuid
  `) as unknown as { locked: boolean; usable: boolean }[];
  const locked = stateRows[0]?.locked === true;
  const usable = stateRows[0]?.usable === true;

  if (!passwordOk || locked || !usable) {
    // One atomic statement: bump, lock exactly when crossing the threshold.
    // Concurrent failures cannot lose increments (single UPDATE, row lock).
    await prisma.$queryRaw`
      UPDATE customers
         SET failed_login_attempts = failed_login_attempts + 1,
             locked_until = CASE
               WHEN failed_login_attempts + 1 >= ${CUSTOMER_MAX_FAILED_ATTEMPTS}
               THEN now() + (${CUSTOMER_LOCKOUT_MINUTES}::text || ' minutes')::interval
               ELSE locked_until
             END
       WHERE id = ${customer.id}::uuid
    `;
    return fail();
  }

  // Success: reset + session commit atomically.
  let token = "";
  await prisma.$transaction(async (tx) => {
    await tx.customer.update({
      where: { id: customer.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
    const rawToken = newOpaqueToken();
    await tx.$executeRaw`
      INSERT INTO customer_sessions (customer_id, token_hash, expires_at, created_ip, user_agent)
      VALUES (
        ${customer.id}::uuid,
        ${hashToken(rawToken)}::text,
        now() + (${CUSTOMER_SESSION_TTL_DAYS}::text || ' days')::interval,
        ${ctx.ip ?? null}::inet,
        ${ctx.userAgent ?? null}::text
      )
    `;
    token = rawToken;
  });

  return {
    ok: true,
    customer: { id: customer.id, firstName: customer.firstName, phone: customer.phone },
    token,
  };
}

/**
 * Authenticated password change: verify current → policy → rehash →
 * update + revoke EVERY session (including the current one — the client
 * re-authenticates afterwards). Returns false for a wrong current
 * password (caller answers generic 401).
 */
export async function changeCustomerPassword(
  customerId: string,
  currentPassword: string,
  newPassword: string,
): Promise<boolean> {
  const row = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { passwordHash: true },
  });
  if (!row?.passwordHash) return false;
  if (!(await verifyPassword(row.passwordHash, currentPassword))) return false;
  const policyError = checkPasswordPolicy(newPassword);
  if (policyError) throw new Error(policyError);
  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction(async (tx) => {
    await tx.customer.update({
      where: { id: customerId },
      data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
    });
    await tx.$executeRaw`
      UPDATE customer_sessions SET revoked_at = now()
       WHERE customer_id = ${customerId}::uuid AND revoked_at IS NULL
    `;
  });
  return true;
}
