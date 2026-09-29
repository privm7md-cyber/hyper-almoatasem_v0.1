// Storefront cart: create-or-resolve the ACTIVE cart for one owner.
// POST body { customerId? } + `x-guest-token` header — exactly one side
// (ownership XOR). Existing ACTIVE cart → 200; created → 201. Guest carts
// mint a bearer token returned ONCE (stored hashed, never again).
// No inventory touched (draft only); no customer auth exists in scope.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { created, fail, ok } from "@/lib/api/respond";
import { getCartFull } from "@/lib/cart/queries";
import { createGuestCart, getOrCreateCart, requireActiveCart } from "@/lib/cart/writes";
import { isGuestTokenShape } from "@/lib/cart/session";
import { GUEST_TOKEN_HEADER, resolveOwner } from "@/lib/cart/owner";
import { toCart } from "@/lib/cart/serialize";
import { uuidSchema } from "@/lib/api/validation";

export async function POST(request: Request) {
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    const r = fail(new ApiError("VALIDATION", "Invalid request body."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const customerId =
    body && typeof body === "object" && "customerId" in body
      ? (body as { customerId?: unknown }).customerId
      : undefined;
  const rawToken = request.headers.get(GUEST_TOKEN_HEADER);
  const token = rawToken && rawToken.trim() !== "" ? rawToken.trim() : null;
  const customer = typeof customerId === "string" && customerId.trim() !== "" ? customerId.trim() : null;
  try {
    // Fresh guest: neither side — the server mints the bearer token.
    if (token === null && customer === null) {
      if (customerId !== undefined && customerId !== null) {
        const r = fail(new ApiError("VALIDATION", "Invalid customer id."));
        return NextResponse.json(r.body, { status: r.status });
      }
      const out = await createGuestCart();
      const full = await getCartFull(out.cartId);
      if (!full) {
        const r = fail(new ApiError("NOT_FOUND", "Active cart not found."));
        return NextResponse.json(r.body, { status: r.status });
      }
      const r = created({ cart: toCart(full), guestToken: out.guestToken });
      return NextResponse.json(r.body, { status: r.status });
    }
    if (token !== null && customer !== null) {
      const r = fail(new ApiError("VALIDATION", "Exactly one of customerId / guest token is required."));
      return NextResponse.json(r.body, { status: r.status });
    }
    // Presented token: resolve only (servers mint; clients never choose).
    if (token !== null) {
      if (!isGuestTokenShape(token)) {
        const r = fail(new ApiError("VALIDATION", "Invalid guest token."));
        return NextResponse.json(r.body, { status: r.status });
      }
      const owner = resolveOwner(request, null);
      if (!owner) {
        const r = fail(new ApiError("VALIDATION", "Invalid guest token."));
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
    }
    if (!uuidSchema.safeParse(customer).success) {
      const r = fail(new ApiError("VALIDATION", "Invalid customer id."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const out = await getOrCreateCart({ kind: "customer", customerId: customer as string });
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
  const customerId = new URL(request.url).searchParams.get("customerId");
  const owner = resolveOwner(request, customerId);
  if (!owner) {
    const r = fail(new ApiError("VALIDATION", "Exactly one of customerId / guest token is required."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
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
