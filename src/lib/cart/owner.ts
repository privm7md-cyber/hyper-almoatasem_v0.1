// BA-5 cart owner resolution (shared by store cart routes).
//
// PHASE 2 identity: exactly one side per request — the guest bearer token
// via the `x-guest-token` header, or the server-verified customer session
// (cookie `__Host-customer-session` / `x-customer-token` header). A
// client-supplied customerId is NEVER an authority (unknown strict fields
// are rejected by the route schemas). Returns null when the request
// carries neither side — callers mint (POST cart) or answer 400.
// Malformed tokens/sessions answer 400/401 here (never silently treated
// as the other side).
import { ApiError } from "../api/errors";
import { readCustomerToken } from "../customers/cookies";
import { hashGuestToken, isGuestTokenShape } from "./session";
import type { CartOwner } from "./queries";

export const GUEST_TOKEN_HEADER = "x-guest-token";

/**
 * Server-verified owner resolution (PHASE 2 — the only authority for new
 * code): guest token XOR verified customer session. Both sides → 400;
 * malformed guest token → 400; invalid session → 401 (via requireCustomer).
 */
export async function resolveStoreOwner(request: Request): Promise<CartOwner | null> {
  const rawToken = request.headers.get(GUEST_TOKEN_HEADER);
  const token = rawToken && rawToken.trim() !== "" ? rawToken.trim() : null;
  const sessionToken = readCustomerToken(request);
  if (token !== null && sessionToken !== null) {
    throw new ApiError("VALIDATION", "Exactly one of guest token / customer session is required.");
  }
  if (sessionToken !== null) {
    // Dynamic import: keeps this module (and its unit tests) free of the
    // DB stack — session verification loads only when actually used.
    const { requireCustomer } = await import("../customers/session");
    const me = await requireCustomer(request);
    return { kind: "customer", customerId: me.customerId };
  }
  if (token !== null) {
    if (!isGuestTokenShape(token)) {
      throw new ApiError("VALIDATION", "Invalid guest token.");
    }
    return { kind: "guest", sessionHash: hashGuestToken(token) };
  }
  return null;
}
