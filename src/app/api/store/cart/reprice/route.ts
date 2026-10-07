// Storefront cart reprice (BA-C persisted reprice): refresh every line's
// price snapshot to the LIVE variant price + drop dead variants (reported),
// one tx under the cart lock. Quantities untouched; no inventory, no
// promotions, no coupon state (estimate/checkout own those). Owner via
// header token XOR session (PHASE 2). Expired or consumed carts answer
// 404 (never resurrected here).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { resolveStoreOwner } from "@/lib/cart/owner";
import { getCartFull } from "@/lib/cart/queries";
import { repriceCart } from "@/lib/cart/writes";
import { toCart } from "@/lib/cart/serialize";
import { cartRepriceSchema } from "@/lib/cart/validation";

export async function POST(request: Request) {
  let body: unknown = {};
  try {
    const text = await request.text();
    body = text.trim() === "" ? {} : JSON.parse(text);
  } catch {
    const r = fail(new ApiError("VALIDATION", "Invalid request body."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const parsed = cartRepriceSchema.safeParse(body ?? {});
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid reprice request."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const owner = await resolveStoreOwner(request);
    if (!owner) {
      const r = fail(new ApiError("VALIDATION", "Exactly one of guest token / customer session is required."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const out = await repriceCart(owner);
    const full = await getCartFull(out.cartId);
    if (!full) {
      const r = fail(new ApiError("NOT_FOUND", "Active cart not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = ok({ cart: toCart(full), reprice: { repriced: out.repriced, dropped: out.dropped } });
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
