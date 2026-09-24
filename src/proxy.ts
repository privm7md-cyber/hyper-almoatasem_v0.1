// Optimistic UX/navigation guard ONLY — never authorization.
// This proxy performs zero database access and zero crypto: it only checks
// whether the session cookie is PRESENT and redirects accordingly. Every real
// security decision happens server-side (layouts, Server Actions, handlers).
// Convention per Next.js 16: proxy.ts at the same level as app/.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Mirrors SESSION_COOKIE_NAME from src/lib/auth/session.ts (duplicated
// deliberately: proxy must stay dependency-free — no DB, no crypto, no Prisma).
const SESSION_COOKIE_NAME = "__Host-admin-session";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSessionCookie = Boolean(request.cookies.get(SESSION_COOKIE_NAME)?.value);

  if (pathname === "/admin/login" || pathname.startsWith("/admin/login/")) {
    if (hasSessionCookie) {
      return NextResponse.redirect(new URL("/admin", request.url));
    }
    return NextResponse.next();
  }

  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    if (!hasSessionCookie) {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
