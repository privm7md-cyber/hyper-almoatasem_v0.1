// Admin session cookie policy (PURE — no server-only, no DB, no crypto).
//
// Why this module exists (Phase-10 remediation, G07):
// the production session cookie is named `__Host-admin-session`. Browsers
// enforce the `__Host-` prefix rules: the cookie MUST carry `Secure`, MUST
// use `Path=/` and MUST NOT carry a `Domain` attribute — a `__Host-` cookie
// without `Secure` is REJECTED by the browser and never stored. The old code
// set `secure: process.env.NODE_ENV === "production"`, so in any
// non-production process the cookie was `__Host-` + not-Secure: the login
// action succeeded, the browser silently dropped the cookie, and the user was
// bounced back to the login screen with no error.
//
// The fix keeps production untouched and gives local development its own
// cookie:
//   production      -> `__Host-admin-session`  (Secure ALWAYS, Path=/, no Domain)
//   local dev (http)-> `hyper-admin-session-dev` (no prefix, no Secure, Path=/)
// The dev cookie is only ever issued by a REAL local development process, and
// it can never be issued in production (see `isDevSessionCookieAllowed`).
//
// Invariant enforced here (structurally, not by convention):
//   a cookie whose name starts with `__Host-` is ALWAYS `Secure`.
// `sessionCookieSecure()` is the single place that decides it.
//
// The proxy (`src/proxy.ts`) imports this module too: Next.js 16 runs the
// proxy on the Node.js runtime, so both sides compute the SAME cookie name
// from the SAME environment. The proxy is an optimistic UX guard only — it
// never authorizes anything (see the file header).

/** Production session cookie (frozen name — never renamed). */
export const PROD_SESSION_COOKIE_NAME = "__Host-admin-session";

/** Local-development-only session cookie (no `__Host-` prefix, never in production). */
export const DEV_SESSION_COOKIE_NAME = "hyper-admin-session-dev";

/**
 * The production dataset name. A local process pointed at THIS database is
 * NOT a safe place to weaken cookie attributes, even over plain HTTP: the
 * dev-cookie path is refused for it (see `isDevSessionCookieAllowed`).
 */
export const PRODUCTION_DATABASE_NAME = "hyper_almoatasem";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export interface CookiePolicyEnv {
  NODE_ENV?: string | undefined;
  DATABASE_URL?: string | undefined;
  VERCEL?: string | undefined;
}

/** Parse a database URL without throwing (never logs the URL). */
function parseDatabaseUrl(url: string | undefined): URL | null {
  if (!url) return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** True when the effective database lives on the developer's own machine. */
export function isLocalDatabaseTarget(url: string | undefined): boolean {
  const parsed = parseDatabaseUrl(url);
  if (!parsed) return false;
  return LOCAL_HOSTS.has(parsed.hostname.toLowerCase());
}

/** True when the effective database is the production dataset. */
export function isProductionDatabaseTarget(url: string | undefined): boolean {
  const parsed = parseDatabaseUrl(url);
  if (!parsed) return false;
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  return name === PRODUCTION_DATABASE_NAME;
}

/**
 * The dev-cookie path is allowed ONLY for a real local development process:
 *   1. not a production build, AND
 *   2. the effective database is on the local machine, AND
 *   3. that database is NOT the production dataset.
 *
 * A preview/staging process that reaches a shared database therefore keeps the
 * production cookie name (and its `Secure` flag) — the dev path is never an
 * open fallback.
 *
 * (Plain predicate — NOT a React hook: it is called from the proxy and from
 * server code, so a `use*` name would violate the rules of hooks.)
 */
export function isDevSessionCookieAllowed(env: CookiePolicyEnv = process.env): boolean {
  if (env.NODE_ENV === "production") return false;
  if (!isLocalDatabaseTarget(env.DATABASE_URL)) return false;
  if (isProductionDatabaseTarget(env.DATABASE_URL)) return false;
  return true;
}

/** The cookie name this process must set, read and clear. */
export function sessionCookieName(env: CookiePolicyEnv = process.env): string {
  return isDevSessionCookieAllowed(env) ? DEV_SESSION_COOKIE_NAME : PROD_SESSION_COOKIE_NAME;
}

/**
 * `Secure` is MANDATORY for any `__Host-` prefixed cookie (browsers reject
 * the cookie otherwise). The dev cookie carries no prefix, so it may travel
 * over plain HTTP inside the developer's machine.
 */
export function sessionCookieSecure(name: string = sessionCookieName()): boolean {
  return name.startsWith("__Host-");
}

/** Cookie attributes shared by set and delete, so a delete always matches. */
export function sessionCookieOptions(name: string): {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
} {
  return {
    httpOnly: true,
    secure: sessionCookieSecure(name),
    sameSite: "lax",
    path: "/",
  };
}
