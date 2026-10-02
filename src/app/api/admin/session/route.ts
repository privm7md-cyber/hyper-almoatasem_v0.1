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

const BodySchema = z.object({
  email: z.string().min(1).max(160),
  password: z.string().min(1).max(128),
});

function requestContext(request: Request): { ip: string | null; userAgent: string | null } {
  const forwarded = request.headers.get("x-forwarded-for");
  return {
    ip: forwarded ? forwarded.split(",")[0].trim() : null,
    userAgent: request.headers.get("user-agent"),
  };
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

export async function DELETE() {
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
    const h = requestContext(new Request("http://localhost/"));
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
