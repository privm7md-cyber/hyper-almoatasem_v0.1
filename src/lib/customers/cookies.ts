// Customer session transport readers (pure, no DB, no env).
//
// The session token travels in the HttpOnly cookie (primary) or the
// x-customer-token header (same token, non-browser same-origin clients).
// Kept import-light on purpose: cart/owner.ts resolves owners in
// plain-node unit tests, so this module must never pull the DB stack.
//
// Phase-12: the cookie NAME is environment-dependent (production keeps the
// `__Host-` prefix and `Secure`; a real local development process uses a
// separate non-prefixed name, because browsers reject a `__Host-` cookie
// without `Secure`). The reader accepts BOTH names so a session established
// in one mode is still readable in the other; the writer only ever issues
// the name the current environment expects.
import {
  DEV_CUSTOMER_SESSION_COOKIE_NAME,
  PROD_CUSTOMER_SESSION_COOKIE_NAME,
  customerSessionCookieName,
} from "@/lib/auth/session-cookie";

export const CUSTOMER_SESSION_COOKIE = PROD_CUSTOMER_SESSION_COOKIE_NAME;
export const CUSTOMER_TOKEN_HEADER = "x-customer-token";

/** The cookie name this process issues for a customer session. */
export { customerSessionCookieName };

/** Every cookie name a customer session may arrive under. */
export const CUSTOMER_SESSION_COOKIE_NAMES = [
  PROD_CUSTOMER_SESSION_COOKIE_NAME,
  DEV_CUSTOMER_SESSION_COOKIE_NAME,
] as const;

/** Extract the presented token (cookie primary, header fallback). */
export function readCustomerToken(request: Request): string | null {
  const header = request.headers.get(CUSTOMER_TOKEN_HEADER);
  if (header && header.trim() !== "") return header.trim();
  const cookieHeader = request.headers.get("cookie") ?? "";
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    if (!CUSTOMER_SESSION_COOKIE_NAMES.includes(name as (typeof CUSTOMER_SESSION_COOKIE_NAMES)[number])) {
      continue;
    }
    const value = part.slice(idx + 1).trim();
    if (value !== "") return decodeURIComponent(value);
  }
  return null;
}
