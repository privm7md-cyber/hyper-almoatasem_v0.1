// BA-5 cart owner resolution (shared by store cart routes).
//
// Exactly one identity per request (mirrors the DB XOR CHECK): the guest
// bearer token via the `x-guest-token` header, or a customerId from
// query/body. Returns null when the request carries zero or both sides —
// callers answer 400. Malformed tokens/UUIDs also answer 400 here (never
// silently treated as the other side).
import { uuidSchema } from "../api/validation";
import { hashGuestToken, isGuestTokenShape } from "./session";
import type { CartOwner } from "./queries";

export const GUEST_TOKEN_HEADER = "x-guest-token";

export function resolveOwner(request: Request, customerId: string | null | undefined): CartOwner | null {
  const rawToken = request.headers.get(GUEST_TOKEN_HEADER);
  const token = rawToken && rawToken.trim() !== "" ? rawToken.trim() : null;
  const customer = customerId && customerId.trim() !== "" ? customerId.trim() : null;
  if ((token == null) === (customer == null)) return null;
  if (token !== null) {
    if (!isGuestTokenShape(token)) return null;
    return { kind: "guest", sessionHash: hashGuestToken(token) };
  }
  if (!uuidSchema.safeParse(customer).success) return null;
  return { kind: "customer", customerId: customer as string };
}
