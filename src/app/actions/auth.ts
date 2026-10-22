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
  extractForwardedIp,
  isHttpsRequest,
  isLocalOrigin,
  isTrustedProxyContext,
} from "@/lib/api/request-context";
import { sessionCookieName, sessionCookieSecure } from "@/lib/auth/session-cookie";

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
  const host = h.get("host");
  const origin = h.get("origin");
  if (!origin) return true; // non-browser callers send no Origin; auth still enforced
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * The request context for the audit trail + the session row.
 * `ip` is the TRUSTED client IP (null unless a trusted proxy is declared);
 * `bucketIp` keeps the rate-limit buckets keyed exactly as before.
 */
async function requestContext(): Promise<{
  ip: string | null;
  userAgent: string | null;
  bucketIp: string | null;
}> {
  const h = await headers();
  const ctx = buildRequestContext(h, isTrustedProxyContext());
  return { ip: ctx.ip, userAgent: ctx.userAgent, bucketIp: extractForwardedIp(h) };
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
