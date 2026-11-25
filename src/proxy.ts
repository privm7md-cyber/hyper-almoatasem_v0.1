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
import {
  isAdminPreviewLocalHost,
  isAdminReadOnlyPreviewConfigured,
} from "@/lib/auth/admin-read-only-preview";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function isSameOriginMutation(request: NextRequest): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return true;
  const rawOrigin = request.headers.get("origin")?.trim();
  if (!rawOrigin) return true;
  if (rawOrigin.toLowerCase() === "null") return false;
  let originHost: string;
  try {
    const parsed = new URL(rawOrigin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    originHost = parsed.host.toLowerCase();
  } catch {
    return false;
  }
  const trustedProxy = process.env.TRUSTED_PROXY === "1";
  const expectedHost =
    (trustedProxy ? request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() : null) ||
    request.headers.get("host")?.trim() ||
    request.nextUrl.host;
  if (!expectedHost) return false;
  return originHost === expectedHost.toLowerCase();
}

export function proxy(request: NextRequest) {
  // Next.js 16: `request.url` is the full URL STRING; the parsed path lives on
  // `request.nextUrl` (destructuring `request.url` yields `undefined` and makes
  // every /admin/* request crash in this guard).
  const { pathname } = request.nextUrl;

  const isAdminPath = pathname === "/admin" || pathname.startsWith("/admin/") ||
    pathname === "/api/admin" || pathname.startsWith("/api/admin/");
  if (isAdminPath && isAdminReadOnlyPreviewConfigured() &&
      (!isAdminPreviewLocalHost(request.headers.get("host")) ||
       !SAFE_METHODS.has(request.method.toUpperCase()))) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Admin read-only preview.", details: null } },
      { status: 403 },
    );
  }

  // Optimistic only: spoofed prefetch headers may skip this proxy's matcher.
  // Admin handlers, auth helpers and actions enforce preview independently.
  if (pathname.startsWith("/api/")) {
    if (!isSameOriginMutation(request)) {
      return NextResponse.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "Cross-origin mutation is not permitted.",
            details: null,
          },
        },
        { status: 403 },
      );
    }
    return NextResponse.next();
  }

  // Optimistic redirect ONLY for unauthenticated visitors to protected /admin/*
  // pages (excluding /admin/login). Never bounce /admin/login -> /admin in the
  // proxy on cookie presence alone: an expired, revoked, or disabled-user
  // cookie would loop between /admin (DB check -> /admin/login) and the proxy.
  // AdminLoginPage performs the authoritative DB check before redirecting.
  const hasSessionCookie = Boolean(request.cookies.get(sessionCookieName())?.value);
  const isLoginPath = pathname === "/admin/login" || pathname.startsWith("/admin/login/");

  if (!isLoginPath && (pathname === "/admin" || pathname.startsWith("/admin/"))) {
    if (!hasSessionCookie) {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }
  }

  // Next.js 16 strict nonce-based Content Security Policy (Report-Only phase).
  // Nonce is attached to request via `x-nonce` and Next.js App Router attaches it
  // to all internal inline flight bootstrap scripts automatically.
  // NO 'unsafe-inline' used anywhere.
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const cspHeader =
    `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}; style-src 'self' 'nonce-${nonce}'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'; report-uri /api/csp-report;`
      .replace(/\s{2,}/g, " ")
      .trim();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy-Report-Only", cspHeader);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.headers.set("Content-Security-Policy-Report-Only", cspHeader);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
