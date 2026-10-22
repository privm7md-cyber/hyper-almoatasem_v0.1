// Optimistic UX/navigation guard ONLY — never authorization.
// This proxy performs zero database access and zero crypto: it only checks
// whether the session cookie is PRESENT and redirects accordingly. Every real
// security decision happens server-side (layouts, Server Actions, handlers).
// Convention per Next.js 16: proxy.ts at the same level as app/.
//
// Cookie policy (Phase-10 remediation, G07): the production cookie is
// `__Host-admin-session` (Secure + Path=/ + no Domain). A real local
// development process uses the separate `hyper-admin-session-dev` cookie,
// because browsers reject a `__Host-` cookie that is not `Secure` and the
// local dev server speaks plain HTTP. The SAME policy module decides the name
// on both sides of this boundary, so the cookie written by the app is the
// cookie this guard looks for. Next.js 16 runs the proxy on the Node.js
// runtime, so `process.env` is read at request time (not inlined at build).
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { sessionCookieName } from "@/lib/auth/session-cookie";

export function proxy(request: NextRequest) {
  // Next.js 16: `request.url` is the full URL STRING; the parsed path lives on
  // `request.nextUrl` (destructuring `request.url` yields `undefined` and makes
  // every /admin/* request crash in this guard).
  const { pathname } = request.nextUrl;
  // Exactly the cookie the server reads (`readSessionCookie`) — the same
  // policy module, the same process, the same environment. Checking any other
  // name here would let the guard pass a request the server will refuse and
  // bounce (a redirect loop), so this list stays deliberately narrow.
  const hasSessionCookie = Boolean(request.cookies.get(sessionCookieName())?.value);

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
