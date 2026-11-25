// Guest order credential cookie naming policy.
//
// The order credential is a bearer secret and must live ONLY in an HttpOnly
// cookie. The `__Host-` prefix is the strongest form, but browsers reject any
// `__Host-` cookie that is not Secure + Path=/ + domain-less. Production is
// HTTPS and keeps the prefix; local development is HTTP, so the prefixed name
// would be DROPPED by the browser (the same "cookie never stored" defect the
// customer/admin sessions already fixed with an environment-aware name).
//
// Reads recognize BOTH prefixes so a cookie minted under either policy is
// still excluded from customer-session forwarding and still resolvable.
export const GUEST_ORDER_COOKIE_PREFIX_PROD = "__Host-guest-order-";
export const GUEST_ORDER_COOKIE_PREFIX_DEV = "guest-order-";

/**
 * Lifetime of the guest order credential, in days.
 *
 * It lives here (a plain module) and NOT in the server-action module: a
 * `"use server"` file may export async functions ONLY, so a constant export
 * makes the whole module fail at request time ("A 'use server' file can only
 * export async functions") and every action in it dies with it.
 */
export const GUEST_ORDER_CREDENTIAL_TTL_DAYS = 90;

/** Cookie lifetime of the guest order credential (mirrors the DB TTL). */
export const GUEST_TTL_SECONDS = GUEST_ORDER_CREDENTIAL_TTL_DAYS * 24 * 3600;

export function guestOrderCookieName(orderId: string): string {
  const prefix =
    process.env.NODE_ENV === "production" ? GUEST_ORDER_COOKIE_PREFIX_PROD : GUEST_ORDER_COOKIE_PREFIX_DEV;
  return `${prefix}${orderId.toLowerCase()}`;
}

export function isGuestOrderCookieName(name: string): boolean {
  return name.startsWith(GUEST_ORDER_COOKIE_PREFIX_PROD) || name.startsWith(GUEST_ORDER_COOKIE_PREFIX_DEV);
}
