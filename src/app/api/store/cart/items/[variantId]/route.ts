// Storefront single cart line: set quantity (PATCH) / remove (DELETE).
// Quantity 0 is rejected (frozen quantity > 0) — removal is DELETE only.
// Owner via header token XOR session (PHASE 2). Missing line → 404.
// Mutations answer 200 with the full cart.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { uuidSchema } from "@/lib/api/validation";
import { cartItemSetSchema } from "@/lib/cart/validation";
import { resolveStoreOwner } from "@/lib/cart/owner";
import { removeLine, setLineQuantity } from "@/lib/cart/writes";
import { toCart } from "@/lib/cart/serialize";

export async function PATCH(request: Request, context: { params: Promise<{ variantId: string }> }) {
  const { variantId } = await context.params;
  if (!uuidSchema.safeParse(variantId).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid variant id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const r = fail(new ApiError("VALIDATION", "Invalid request body."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const parsed = cartItemSetSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid quantity."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const owner = await resolveStoreOwner(request);
    if (!owner) {
      const r = fail(new ApiError("VALIDATION", "Exactly one of guest token / customer session is required."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const full = await setLineQuantity(owner, variantId, parsed.data.quantity);
    if (!full) {
      const r = fail(new ApiError("NOT_FOUND", "Cart line not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = ok({ cart: toCart(full) });
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ variantId: string }> }) {
  const { variantId } = await context.params;
  if (!uuidSchema.safeParse(variantId).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid variant id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const owner = await resolveStoreOwner(request);
    if (!owner) {
      const r = fail(new ApiError("VALIDATION", "Exactly one of guest token / customer session is required."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const full = await removeLine(owner, variantId);
    if (!full) {
      const r = fail(new ApiError("NOT_FOUND", "Cart line not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = ok({ cart: toCart(full) });
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
