// Storefront cart merge: bind a guest cart to the session customer
// (PHASE 2 — the merge target is server-derived from the verified session,
// never a client-supplied customerId). Guest ownership is proven by the
// bearer `x-guest-token`; a customer session must also be presented.
// Reassign (no customer ACTIVE cart) or sum + live reprice with dead-line
// drops (guest → MERGED), one tx, ASC locks. Unknown token → 404;
// consumed/non-guest cart → 409.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { cartMergeSchema } from "@/lib/cart/validation";
import { GUEST_TOKEN_HEADER } from "@/lib/cart/owner";
import { isGuestTokenShape } from "@/lib/cart/session";
import { getCartFull } from "@/lib/cart/queries";
import { mergeGuestCartToCustomer } from "@/lib/cart/writes";
import { requireCustomer } from "@/lib/customers/session";
import { toCart } from "@/lib/cart/serialize";

export async function POST(request: Request) {
  const rawToken = request.headers.get(GUEST_TOKEN_HEADER);
  const guestToken = rawToken && rawToken.trim() !== "" ? rawToken.trim() : null;
  if (!guestToken || !isGuestTokenShape(guestToken)) {
    const r = fail(new ApiError("VALIDATION", "A valid guest token is required."));
    return NextResponse.json(r.body, { status: r.status });
  }
  let body: unknown = {};
  try {
    const text = await request.text();
    body = text.trim() === "" ? {} : JSON.parse(text);
  } catch {
    const r = fail(new ApiError("VALIDATION", "Invalid request body."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const parsed = cartMergeSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid merge request."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const me = await requireCustomer(request);
    const out = await mergeGuestCartToCustomer(guestToken, me.customerId);
    const full = await getCartFull(out.cartId);
    if (!full) {
      const r = fail(new ApiError("NOT_FOUND", "Active cart not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = ok({ cart: toCart(full), merge: out.report });
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
