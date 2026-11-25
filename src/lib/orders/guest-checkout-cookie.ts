// Guest checkout recovery-session cookie naming policy (pure, no DB).
//
// The raw session token is a bearer secret and lives ONLY in an HttpOnly
// cookie (or, for non-browser same-origin clients, the dedicated header).
// Production keeps the strongest `__Host-` prefix; a real local HTTP process
// uses a non-prefixed name because browsers reject `__Host-` without Secure.
// Reads recognise BOTH names. This cookie is deliberately NOT order-scoped:
// one browser holds the latest checkout session, and the database validates
// it against the requested order id (a session bound to order A can never
// authorize order B).
export const GUEST_CHECKOUT_COOKIE_PROD = "__Host-guest-checkout";
export const GUEST_CHECKOUT_COOKIE_DEV = "guest-checkout";
export const GUEST_CHECKOUT_COOKIE_NAMES = [
  GUEST_CHECKOUT_COOKIE_PROD,
  GUEST_CHECKOUT_COOKIE_DEV,
] as const;

/** Non-browser transport header (never a URL parameter, never a log field). */
export const GUEST_CHECKOUT_SESSION_HEADER = "x-guest-checkout-session";

export function guestCheckoutCookieName(): string {
  return process.env.NODE_ENV === "production" ? GUEST_CHECKOUT_COOKIE_PROD : GUEST_CHECKOUT_COOKIE_DEV;
}

export function isGuestCheckoutCookieName(name: string): boolean {
  return (GUEST_CHECKOUT_COOKIE_NAMES as readonly string[]).includes(name);
}

/** Read the presented checkout-session token: header first, then cookie. */
export function readGuestCheckoutToken(request: Request): string | null {
  const header = request.headers.get(GUEST_CHECKOUT_SESSION_HEADER);
  if (header && header.trim() !== "") return header.trim();
  const cookieHeader = request.headers.get("cookie") ?? "";
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    if (!isGuestCheckoutCookieName(name)) continue;
    const value = part.slice(idx + 1).trim();
    if (value !== "") return value;
  }
  return null;
}
