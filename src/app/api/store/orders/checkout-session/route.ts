// Guest checkout recovery-session mint (residual Phase-10 closure, P10-L-08).
//
// The browser calls this BEFORE placing an order. The server mints a 24h
// fixed-TTL opaque token, stores ONLY its SHA-256 hash bound to the guest's
// ACTIVE cart, and returns the raw token exclusively as an HttpOnly
// `Set-Cookie` header — never in a JSON body, never in a URL, never logged.
// If the fresh 201 (per-order credential) is later lost, the cookie still
// proves access to the order the create transaction bound it to.
//
// Guest only: registered customers recover through their session. No customer
// row, no PII, no order creation here. Rate-limited on its own bucket so a
// page load can never consume the order-creation budget.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { clientIpBucketKey } from "@/lib/api/client-ip";
import { assertSameOriginOrThrow } from "@/lib/api/request-context";
import { resolveStoreOwner } from "@/lib/cart/owner";
import { prisma } from "@/lib/db";
import {
  GUEST_CHECKOUT_SESSION_BUCKET_LIMIT,
  checkAndRecordRateLimit,
  guestCheckoutSessionBucket,
} from "@/lib/auth/rate-limit";
import {
  GUEST_CHECKOUT_SESSION_TTL_HOURS,
  issueGuestCheckoutSession,
} from "@/lib/orders/guest-checkout-session";
import { guestCheckoutCookieName } from "@/lib/orders/guest-checkout-cookie";

const GUEST_CHECKOUT_SESSION_TTL_SECONDS = GUEST_CHECKOUT_SESSION_TTL_HOURS * 3600;

export async function POST(request: Request) {
  try {
    assertSameOriginOrThrow(request);
    const owner = await resolveStoreOwner(request);
    if (!owner) {
      const r = fail(new ApiError("UNAUTHENTICATED", "Authentication is required."));
      return NextResponse.json(r.body, { status: r.status });
    }
    if (owner.kind !== "guest") {
      const r = fail(
        new ApiError("VALIDATION", "Guest checkout session is only available for guest carts."),
      );
      return NextResponse.json(r.body, { status: r.status });
    }
    const gate = await checkAndRecordRateLimit(
      guestCheckoutSessionBucket(clientIpBucketKey(request.headers)),
      GUEST_CHECKOUT_SESSION_BUCKET_LIMIT,
      undefined,
      "guest_order_rate_limits",
    );
    if (!gate.allowed) {
      const r = fail(new ApiError("RATE_LIMITED", "Too many requests.", null, true));
      return NextResponse.json(r.body, { status: r.status });
    }
    const cart = await prisma.cart.findFirst({
      where: { sessionId: owner.sessionHash, status: "ACTIVE" },
      select: { id: true },
      orderBy: [{ createdAt: "desc" as const }],
    });
    if (!cart) {
      const r = fail(new ApiError("NOT_FOUND", "Active cart not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const session = await issueGuestCheckoutSession(cart.id);
    const r = ok({ expiresAt: session.expiresAt.toISOString(), ttlHours: GUEST_CHECKOUT_SESSION_TTL_HOURS });
    const response = NextResponse.json(r.body, { status: r.status });
    const cookieName = guestCheckoutCookieName();
    response.cookies.set(cookieName, session.token, {
      httpOnly: true,
      secure: cookieName.startsWith("__Host-"),
      sameSite: "lax",
      path: "/",
      maxAge: GUEST_CHECKOUT_SESSION_TTL_SECONDS,
    });
    return response;
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
