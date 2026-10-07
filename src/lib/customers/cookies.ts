// Customer session transport readers (pure, no DB, no env).
//
// The session token travels in the HttpOnly cookie (primary) or the
// x-customer-token header (same token, non-browser same-origin clients).
// Kept import-light on purpose: cart/owner.ts resolves owners in
// plain-node unit tests, so this module must never pull the DB stack.
export const CUSTOMER_SESSION_COOKIE = "__Host-customer-session";
export const CUSTOMER_TOKEN_HEADER = "x-customer-token";

/** Extract the presented token (cookie primary, header fallback). */
export function readCustomerToken(request: Request): string | null {
  const header = request.headers.get(CUSTOMER_TOKEN_HEADER);
  if (header && header.trim() !== "") return header.trim();
  const cookieHeader = request.headers.get("cookie") ?? "";
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === CUSTOMER_SESSION_COOKIE) {
      const value = part.slice(idx + 1).trim();
      if (value !== "") return decodeURIComponent(value);
    }
  }
  return null;
}
