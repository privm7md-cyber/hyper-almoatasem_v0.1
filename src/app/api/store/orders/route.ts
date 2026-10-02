// Storefront orders: create (POST) + own-order list (GET).
// POST body { customerId, addressId, idempotencyKey? } + optional
// `Idempotency-Key` header (BA-A contract: header wins when both carry the
// same key; both present but different → 400; at least one required).
// Cart resolved from the `x-guest-token` header (guest cart) or the
// customer's ACTIVE cart. Creation is one tx (reserve + snapshots +
// history + CHECKED_OUT); replays answer 200 with meta.replay, fresh
// orders 201. No OTP/login invented.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { created, fail, ok } from "@/lib/api/respond";
import { idempotencyKeySchema } from "@/lib/api/validation";
import { orderCreateSchema, orderListQuerySchema } from "@/lib/orders/validation";
import { getOrderFull, listCustomerOrders } from "@/lib/orders/queries";
import { createOrder } from "@/lib/orders/writes";
import { toOrder, toOrderListItem } from "@/lib/orders/serialize";
import { GUEST_TOKEN_HEADER } from "@/lib/cart/owner";
import { hashGuestToken, isGuestTokenShape } from "@/lib/cart/session";
import type { CartOwner } from "@/lib/cart/queries";

/** Canonical idempotency header name (BA-A contract). */
export const IDEMPOTENCY_KEY_HEADER = "idempotency-key";

export async function POST(request: Request) {
  const rawToken = request.headers.get(GUEST_TOKEN_HEADER);
  const token = rawToken && rawToken.trim() !== "" ? rawToken.trim() : null;
  if (token !== null && !isGuestTokenShape(token)) {
    const r = fail(new ApiError("VALIDATION", "Invalid guest token."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const rawHeaderKey = request.headers.get(IDEMPOTENCY_KEY_HEADER);
  const headerKey = rawHeaderKey && rawHeaderKey.trim() !== "" ? rawHeaderKey.trim() : null;
  if (headerKey !== null && !idempotencyKeySchema.safeParse(headerKey).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid idempotency key."));
    return NextResponse.json(r.body, { status: r.status });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const r = fail(new ApiError("VALIDATION", "Invalid request body."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const parsed = orderCreateSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid order request."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const bodyKey = parsed.data.idempotencyKey ?? null;
  if (headerKey !== null && bodyKey !== null && headerKey !== bodyKey) {
    const r = fail(new ApiError("VALIDATION", "Conflicting idempotency keys."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const idempotencyKey = headerKey ?? bodyKey;
  if (idempotencyKey === null) {
    const r = fail(new ApiError("VALIDATION", "Idempotency key is required."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const owner: CartOwner =
    token !== null
      ? { kind: "guest", sessionHash: hashGuestToken(token) }
      : { kind: "customer", customerId: parsed.data.customerId };
  try {
    const out = await createOrder({
      owner,
      customerId: parsed.data.customerId,
      addressId: parsed.data.addressId,
      idempotencyKey,
      couponCode: parsed.data.couponCode ?? null,
    });
    const full = await getOrderFull(out.orderId);
    if (!full) {
      const r = fail(new ApiError("NOT_FOUND", "Order not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = out.replay ? ok({ order: toOrder(full) }, { replay: true }) : created({ order: toOrder(full) });
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}

export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = orderListQuerySchema.safeParse(params);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid query."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const q = parsed.data;
  const rows = await listCustomerOrders({
    limit: q.limit,
    cursor: q.cursor ?? null,
    customerId: q.customerId,
  });
  const page = rows.length > q.limit ? rows.slice(0, q.limit) : rows;
  const r = ok(
    page.map((o) => toOrderListItem(o, o._count.items)),
    { limit: q.limit, nextCursor: rows.length > q.limit ? page[page.length - 1].id : null },
  );
  return NextResponse.json(r.body, { status: r.status });
}
