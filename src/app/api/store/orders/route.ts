// Storefront orders: create (POST) + own-order list (GET).
// Identity is XOR (BG-Guest-Order): the server-verified customer session
// (registered path, owned addressId) XOR the guest cart bearer + inline
// guest address/contact (guest path, snapshots only, no account).
// customerId NEVER travels in body/query. No identity side at all answers
// 401; present-but-wrong-side payloads answer 400 (guest token + addressId,
// or session + guest payload — ambiguous).
// POST body { addressId XOR (guestAddress + guestContact), idempotencyKey? }
// + optional `Idempotency-Key` header (BA-A contract: header wins when both
// carry the same key; both present but different → 400; at least one
// required). Creation is one tx (reserve + snapshots + history +
// CHECKED_OUT + guest credential issuance); replays answer 200 with
// meta.replay (keep-same: no token on replay), fresh guest orders 201 with
// the raw credential returned exactly once. No OTP/login invented.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { created, fail, ok } from "@/lib/api/respond";
import { idempotencyKeySchema } from "@/lib/api/validation";
import { orderCreateSchema, orderListQuerySchema } from "@/lib/orders/validation";
import { getOrderFull, listCustomerOrders } from "@/lib/orders/queries";
import { createOrder } from "@/lib/orders/writes";
import { toOrder, toOrderListItem } from "@/lib/orders/serialize";
import { resolveStoreOwner } from "@/lib/cart/owner";
import { requireCustomer } from "@/lib/customers/session";
import {
  GUEST_ORDER_CREATE_BUCKET_LIMIT,
  checkAndRecordRateLimit,
  guestOrderCreateBucket,
} from "@/lib/auth/rate-limit";

/** Canonical idempotency header name (BA-A contract). */
export const IDEMPOTENCY_KEY_HEADER = "idempotency-key";

export async function POST(request: Request) {
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
  try {
    const owner = await resolveStoreOwner(request);
    if (!owner) {
      // No identity side at all: 401 (matches the documented contract and
      // the pre-guest behavior — absence of credentials is unauthenticated,
      // while a present-but-wrong-side payload is 400 below).
      const r = fail(new ApiError("UNAUTHENTICATED", "Authentication is required.", null, false));
      return NextResponse.json(r.body, { status: r.status });
    }
    const wantsGuest = parsed.data.addressId == null;
    // XOR discipline: each side uses exactly its own payload (BGGO-D015).
    if (owner.kind === "customer" && wantsGuest) {
      const r = fail(new ApiError("VALIDATION", "Authenticated checkout requires addressId."));
      return NextResponse.json(r.body, { status: r.status });
    }
    if (owner.kind === "guest" && !wantsGuest) {
      const r = fail(new ApiError("VALIDATION", "Guest checkout requires guestAddress and guestContact."));
      return NextResponse.json(r.body, { status: r.status });
    }
    if (owner.kind === "guest") {
      // Anonymous creation surface: fail-closed IP bucket first (BGGO-D009).
      const gate = await checkAndRecordRateLimit(
        guestOrderCreateBucket(request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null),
        GUEST_ORDER_CREATE_BUCKET_LIMIT,
        undefined,
        "guest_order_rate_limits",
      );
      if (!gate.allowed) {
        const r = fail(new ApiError("RATE_LIMITED", "Too many requests.", null, true));
        return NextResponse.json(r.body, { status: r.status });
      }
    }
    const out = await createOrder({
      owner,
      customerId: owner.kind === "customer" ? owner.customerId : null,
      addressId: parsed.data.addressId ?? null,
      guest:
        owner.kind === "guest"
          ? {
              contact: {
                firstName: parsed.data.guestContact?.firstName as string,
                lastName: (parsed.data.guestContact?.lastName as string | null | undefined) ?? null,
              },
              address: {
                city: parsed.data.guestAddress?.city as string,
                area: (parsed.data.guestAddress?.area as string | null | undefined) ?? null,
                village: (parsed.data.guestAddress?.village as string | null | undefined) ?? null,
                street: (parsed.data.guestAddress?.street as string | null | undefined) ?? null,
                buildingNumber:
                  (parsed.data.guestAddress?.buildingNumber as string | null | undefined) ?? null,
                landmark: (parsed.data.guestAddress?.landmark as string | null | undefined) ?? null,
                phone: parsed.data.guestAddress?.phone as string,
              },
            }
          : null,
      idempotencyKey,
      couponCode: parsed.data.couponCode ?? null,
    });
    const full = await getOrderFull(out.orderId);
    if (!full) {
      const r = fail(new ApiError("NOT_FOUND", "Order not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    if (out.replay) {
      const r = ok({ order: toOrder(full) }, { replay: true, guestTokenIssued: false });
      return NextResponse.json(r.body, { status: r.status });
    }
    const r =
      out.guestToken !== null
        ? created({ order: toOrder(full), guestOrderToken: out.guestToken })
        : created({ order: toOrder(full) });
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
  try {
    const me = await requireCustomer(request);
    const q = parsed.data;
    const rows = await listCustomerOrders({
      limit: q.limit,
      cursor: q.cursor ?? null,
      customerId: me.customerId,
    });
    const page = rows.length > q.limit ? rows.slice(0, q.limit) : rows;
    const r = ok(
      page.map((o) => toOrderListItem(o, o._count.items)),
      { limit: q.limit, nextCursor: rows.length > q.limit ? page[page.length - 1].id : null },
    );
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
