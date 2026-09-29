// Storefront orders: create (POST) + own-order list (GET).
// POST body { customerId, addressId, idempotencyKey }; cart resolved from
// the `x-guest-token` header (guest cart) or the customer's ACTIVE cart.
// Creation is one tx (reserve + snapshots + history + CHECKED_OUT); replays
// answer 200 with meta.replay, fresh orders 201. No OTP/login invented.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { created, fail, ok } from "@/lib/api/respond";
import { orderCreateSchema, orderListQuerySchema } from "@/lib/orders/validation";
import { getOrderFull, listCustomerOrders } from "@/lib/orders/queries";
import { createOrder } from "@/lib/orders/writes";
import { toOrder, toOrderListItem } from "@/lib/orders/serialize";
import { GUEST_TOKEN_HEADER } from "@/lib/cart/owner";
import { hashGuestToken, isGuestTokenShape } from "@/lib/cart/session";
import type { CartOwner } from "@/lib/cart/queries";

export async function POST(request: Request) {
  const rawToken = request.headers.get(GUEST_TOKEN_HEADER);
  const token = rawToken && rawToken.trim() !== "" ? rawToken.trim() : null;
  if (token !== null && !isGuestTokenShape(token)) {
    const r = fail(new ApiError("VALIDATION", "Invalid guest token."));
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
  const owner: CartOwner =
    token !== null
      ? { kind: "guest", sessionHash: hashGuestToken(token) }
      : { kind: "customer", customerId: parsed.data.customerId };
  try {
    const out = await createOrder({
      owner,
      customerId: parsed.data.customerId,
      addressId: parsed.data.addressId,
      idempotencyKey: parsed.data.idempotencyKey,
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
