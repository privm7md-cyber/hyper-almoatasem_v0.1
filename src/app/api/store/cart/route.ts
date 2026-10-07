// Storefront cart: create-or-resolve the ACTIVE cart for one owner.
// PHASE 2 identity: guest `x-guest-token` header XOR server-verified
// customer session — never a client-supplied customerId. Fresh request
// (neither side) mints a guest cart: bearer token returned ONCE (stored
// hashed, never again). Existing ACTIVE cart → 200; created → 201.
// No inventory touched (draft only).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { created, fail, ok } from "@/lib/api/respond";
import { getCartFull } from "@/lib/cart/queries";
import { createGuestCart, getOrCreateCart, requireActiveCart } from "@/lib/cart/writes";
import { resolveStoreOwner } from "@/lib/cart/owner";
import { toCart } from "@/lib/cart/serialize";

export async function POST(request: Request) {
  try {
    const owner = await resolveStoreOwner(request);
    // Fresh guest: neither side — the server mints the bearer token.
    if (!owner) {
      const out = await createGuestCart();
      const full = await getCartFull(out.cartId);
      if (!full) {
        const r = fail(new ApiError("NOT_FOUND", "Active cart not found."));
        return NextResponse.json(r.body, { status: r.status });
      }
      const r = created({ cart: toCart(full), guestToken: out.guestToken });
      return NextResponse.json(r.body, { status: r.status });
    }
    if (owner.kind === "guest") {
      const cartId = await requireActiveCart(owner);
      const full = await getCartFull(cartId);
      if (!full) {
        const r = fail(new ApiError("NOT_FOUND", "Active cart not found."));
        return NextResponse.json(r.body, { status: r.status });
      }
      const r = ok({ cart: toCart(full) });
      return NextResponse.json(r.body, { status: r.status });
    }
    const out = await getOrCreateCart({ kind: "customer", customerId: owner.customerId });
    const full = await getCartFull(out.cartId);
    if (!full) {
      const r = fail(new ApiError("NOT_FOUND", "Active cart not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = out.created ? created({ cart: toCart(full) }) : ok({ cart: toCart(full) });
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}

export async function GET(request: Request) {
  try {
    const owner = await resolveStoreOwner(request);
    if (!owner) {
      const r = fail(new ApiError("VALIDATION", "Exactly one of guest token / customer session is required."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const cartId = await requireActiveCart(owner);
    const full = await getCartFull(cartId);
    if (!full) {
      const r = fail(new ApiError("NOT_FOUND", "Active cart not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = ok({ cart: toCart(full) });
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
