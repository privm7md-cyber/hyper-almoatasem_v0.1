"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { authenticateAdmin, GENERIC_LOGIN_ERROR } from "@/lib/auth/login";
import {
  clearSessionCookie,
  revokeSession,
  readSessionCookie,
  setSessionCookie,
} from "@/lib/auth/session";
import { writeAuthAudit } from "@/lib/auth/audit";
import {
  buildRequestContext,
  isHttpsRequest,
  isLocalOrigin,
  verifySameOrigin,
} from "@/lib/api/request-context";
import { sessionCookieName, sessionCookieSecure } from "@/lib/auth/session-cookie";
import { assertAdminPreviewWritesAllowed } from "@/lib/auth/admin-read-only-preview";

const LoginSchema = z.object({
  email: z.string().min(1).max(160),
  password: z.string().min(1).max(128),
});

export interface LoginActionState {
  error?: string;
}

/** Explicit same-origin check on top of Next's built-in action protections. */
async function assertSameOrigin(): Promise<boolean> {
  const h = await headers();
  return verifySameOrigin(h);
}

/**
 * The request context for the audit trail + the session row.
 * `ip` and `bucketIp` are the SAME trusted identity (see `./client-ip`): a
 * rate-limit bucket keyed by a client-chosen address could be rotated to
 * bypass the limit, so both use the platform-written address only.
 */
async function requestContext(): Promise<{
  ip: string | null;
  userAgent: string | null;
  bucketIp: string | null;
}> {
  const h = await headers();
  const ctx = buildRequestContext(h);
  return { ip: ctx.ip, userAgent: ctx.userAgent, bucketIp: ctx.ip };
}

/**
 * Refuse a login the BROWSER could not keep: a `Secure` cookie is dropped
 * over plain HTTP, so the session would silently vanish (Phase-10
 * remediation, G07). Production keeps the `__Host-` cookie with `Secure`; a
 * local development process uses the separate dev cookie, so this branch is
 * only reached in a misconfigured environment — and it says so.
 *
 * A browser "potentially trustworthy" origin (localhost / 127.0.0.1 / ::1)
 * DOES accept `Secure` cookies over plain HTTP, so it is not refused.
 */
async function cookieWouldBeDropped(): Promise<boolean> {
  const name = sessionCookieName();
  if (!sessionCookieSecure(name)) return false;
  const h = await headers();
  if (isLocalOrigin(h.get("host"))) return false;
  return !isHttpsRequest(h);
}

export async function loginAction(
  _prev: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  assertAdminPreviewWritesAllowed();
  if (!(await assertSameOrigin())) {
    return { error: GENERIC_LOGIN_ERROR };
  }
  const parsed = LoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: GENERIC_LOGIN_ERROR };
  if (await cookieWouldBeDropped()) {
    return {
      error: "تسجيل الدخول يتطلب HTTPS في هذه البيئة (كوكي الجلسة آمن فقط عبر HTTPS).",
    };
  }
  const ctx = await requestContext();
  const result = await authenticateAdmin(parsed.data.email, parsed.data.password, ctx);
  if (result.ok === false) return { error: result.error };
  await setSessionCookie(result.token);
  redirect("/admin");
}

export async function logoutAction(): Promise<void> {
  assertAdminPreviewWritesAllowed();
  if (!(await assertSameOrigin())) {
    redirect("/admin/login");
  }
  const ctx = await requestContext();
  const rawToken = await readSessionCookie();
  if (rawToken) {
    const { hashToken } = await import("@/lib/auth/tokens");
    const { prisma } = await import("@/lib/db");
    const row = (await prisma.$queryRaw<{ user_id: string }[]>`
      SELECT user_id FROM admin_sessions
       WHERE token_hash = ${hashToken(rawToken)}::text AND revoked_at IS NULL
    `) as unknown as { user_id: string }[];
    await revokeSession(rawToken);
    await clearSessionCookie();
    await writeAuthAudit({
      action: "auth.logout",
      userId: row[0]?.user_id ?? null,
      entityType: "users",
      entityId: row[0]?.user_id ?? null,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    }).catch(() => {});
  } else {
    await clearSessionCookie();
  }
  redirect("/admin/login");
}
