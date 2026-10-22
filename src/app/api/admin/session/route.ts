// JSON login endpoint (thin transport over the single authenticateAdmin core).
// Same guarantees as the Server-Action form flow: Zod input, generic errors,
// rate-limit + lockout, audit, HttpOnly session cookie. Used by API clients
// and by the automated HTTP test suites.
// BA-A canonical envelopes: success { data, meta } (login creates a session
// → 201), failures use the shared error envelope (never { ok: false }).
import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdmin } from "@/lib/auth/login";
import { setSessionCookie } from "@/lib/auth/session";
import { getCurrentAdmin } from "@/lib/auth/rbac";
import { revokeSession, readSessionCookie, clearSessionCookie } from "@/lib/auth/session";
import { writeAuthAudit } from "@/lib/auth/audit";
import { ApiError } from "@/lib/api/errors";
import { created, fail, ok } from "@/lib/api/respond";
import {
  buildRequestContext,
  extractForwardedIp,
  isHttpsRequest,
  isLocalOrigin,
  isTrustedProxyContext,
} from "@/lib/api/request-context";
import { sessionCookieName, sessionCookieSecure } from "@/lib/auth/session-cookie";

const BodySchema = z.object({
  email: z.string().min(1).max(160),
  password: z.string().min(1).max(128),
});

/**
 * The request context for the audit trail + the session row.
 * `ip` is the TRUSTED client IP (null unless a trusted proxy is declared);
 * `bucketIp` keeps the rate-limit buckets keyed exactly as before.
 */
function requestContext(request: Request): {
  ip: string | null;
  userAgent: string | null;
  bucketIp: string | null;
} {
  const trusted = isTrustedProxyContext();
  const ctx = buildRequestContext(request.headers, trusted);
  return { ip: ctx.ip, userAgent: ctx.userAgent, bucketIp: extractForwardedIp(request.headers) };
}

/**
 * Refuse a login that the BROWSER could not keep: a `Secure` cookie is
 * dropped over plain HTTP, so the session would silently vanish. This makes
 * the failure explicit instead of a silent bounce (Phase-10 remediation, G07).
 *
 * A browser "potentially trustworthy" origin (localhost / 127.0.0.1 / ::1)
 * DOES accept `Secure` cookies over plain HTTP, so it is not a dropped-cookie
 * case and must not be refused.
 */
function cookieWouldBeDropped(request: Request): boolean {
  const name = sessionCookieName();
  if (!sessionCookieSecure(name)) return false;
  const url = new URL(request.url);
  if (isLocalOrigin(url.hostname)) return false;
  return !isHttpsRequest(request.headers, url.protocol);
}

export async function POST(request: Request) {
  // Explicit same-origin enforcement for credential submission.
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin) {
    try {
      if (new URL(origin).host !== host) {
        const r = fail(new ApiError("FORBIDDEN", "Forbidden.", null));
        return NextResponse.json(r.body, { status: r.status });
      }
    } catch {
      const r = fail(new ApiError("FORBIDDEN", "Forbidden.", null));
      return NextResponse.json(r.body, { status: r.status });
    }
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const r = fail(new ApiError("VALIDATION", "طلب غير صالح.", null));
    return NextResponse.json(r.body, { status: r.status });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    // Shape errors only (never credential-specific).
    const r = fail(new ApiError("VALIDATION", "طلب غير صالح.", null));
    return NextResponse.json(r.body, { status: r.status });
  }
  const ctx = requestContext(request);
  if (cookieWouldBeDropped(request)) {
    const r = fail(
      new ApiError(
        "VALIDATION",
        "تسجيل الدخول يتطلب HTTPS في هذه البيئة (كوكي الجلسة آمن فقط عبر HTTPS).",
        null,
      ),
    );
    return NextResponse.json(r.body, { status: r.status });
  }
  const result = await authenticateAdmin(parsed.data.email, parsed.data.password, ctx);
  if (result.ok === false) {
    const r = fail(new ApiError("UNAUTHENTICATED", result.error, null));
    return NextResponse.json(r.body, { status: r.status });
  }
  await setSessionCookie(result.token);
  const r = created({ admin: { name: result.admin.name, email: result.admin.email } });
  return NextResponse.json(r.body, { status: r.status });
}

export async function GET() {
  const admin = await getCurrentAdmin();
  if (!admin) {
    const r = fail(new ApiError("UNAUTHENTICATED", "Authentication required.", null));
    return NextResponse.json(r.body, { status: r.status });
  }
  const r = ok({
    admin: { name: admin.user.name, email: admin.user.email },
    roles: admin.roles,
    permissions: admin.permissions,
  });
  return NextResponse.json(r.body, { status: r.status });
}

export async function DELETE(request: Request) {
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
    const h = requestContext(request);
    await writeAuthAudit({
      action: "auth.logout",
      userId: row[0]?.user_id ?? null,
      entityType: "users",
      entityId: row[0]?.user_id ?? null,
      ip: h.ip,
      userAgent: h.userAgent,
    }).catch(() => {});
  } else {
    await clearSessionCookie();
  }
  const r = ok({ revoked: true });
  return NextResponse.json(r.body, { status: r.status });
}
