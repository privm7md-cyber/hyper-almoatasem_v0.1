// Shared admin session-cookie helper for the API suites (scratch-only).
//
// The session cookie NAME depends on the environment (Phase-10 remediation,
// G07):
//   production       -> `__Host-admin-session`  (Secure + Path=/ + no Domain)
//   local development-> `hyper-admin-session-dev` (no prefix, plain HTTP)
// The suites must therefore never hardcode the name: they read the name the
// server actually issued and send the cookie back under the SAME name (the
// server reads exactly one name — see src/lib/auth/session-cookie.ts).
import { PROD_COOKIE_NAME, DEV_SESSION_COOKIE_NAME } from "./_cookie-names.mjs";

const SESSION_COOKIE_PATTERN = new RegExp(
  `(${PROD_COOKIE_NAME}|${DEV_SESSION_COOKIE_NAME})=([^;]+)`,
);

/**
 * Extract the session cookie from a Set-Cookie header.
 * Returns { name, value, header } or null.
 */
export function extractSessionCookie(setCookieHeader) {
  const m = SESSION_COOKIE_PATTERN.exec(setCookieHeader || "");
  if (!m) return null;
  return { name: m[1], value: m[2], header: `${m[1]}=${m[2]}` };
}
