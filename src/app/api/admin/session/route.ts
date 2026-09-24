// JSON login endpoint (thin transport over the single authenticateAdmin core).
// Same guarantees as the Server-Action form flow: Zod input, generic errors,
// rate-limit + lockout, audit, HttpOnly session cookie. Used by API clients
// and by the automated HTTP test suites.
import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdmin } from "@/lib/auth/login";
import { setSessionCookie } from "@/lib/auth/session";
import { getCurrentAdmin } from "@/lib/auth/rbac";
import { revokeSession, readSessionCookie, clearSessionCookie } from "@/lib/auth/session";
import { writeAuthAudit } from "@/lib/auth/audit";

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
        return NextResponse.json({ ok: false }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ ok: false }, { status: 403 });
    }
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "طلب غير صالح." }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    // Shape errors only (never credential-specific).
    return NextResponse.json({ ok: false, error: "طلب غير صالح." }, { status: 400 });
  }
  const ctx = requestContext(request);
  const result = await authenticateAdmin(parsed.data.email, parsed.data.password, ctx);
  if (result.ok === false) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 401 });
  }
  await setSessionCookie(result.token);
  return NextResponse.json({
    ok: true,
    admin: { name: result.admin.name, email: result.admin.email },
  });
}

export async function GET() {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  return NextResponse.json({
    ok: true,
    admin: { name: admin.user.name, email: admin.user.email },
    roles: admin.roles,
    permissions: admin.permissions,
  });
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
  return NextResponse.json({ ok: true });
}
