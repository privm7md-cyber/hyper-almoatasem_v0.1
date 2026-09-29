// Storefront cart lines: add (POST, re-add aggregates at live price) and
// clear-all (DELETE on the collection). Owner via `x-guest-token` header
// or body/query customerId — exactly one side. Draft only: no inventory,
// no checkout. Mutations answer 200 with the full cart.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { cartItemAddSchema } from "@/lib/cart/validation";
import { resolveOwner } from "@/lib/cart/owner";
import { addLine, clearCart } from "@/lib/cart/writes";
import { toCart } from "@/lib/cart/serialize";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const r = fail(new ApiError("VALIDATION", "Invalid request body."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const parsed = cartItemAddSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid cart item."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const owner = resolveOwner(request, parsed.data.customerId ?? null);
  if (!owner) {
    const r = fail(new ApiError("VALIDATION", "Exactly one of customerId / guest token is required."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const full = await addLine(owner, parsed.data.productVariantId, parsed.data.quantity);
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

export async function DELETE(request: Request) {
  const customerId = new URL(request.url).searchParams.get("customerId");
  const owner = resolveOwner(request, customerId);
  if (!owner) {
    const r = fail(new ApiError("VALIDATION", "Exactly one of customerId / guest token is required."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const full = await clearCart(owner);
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
