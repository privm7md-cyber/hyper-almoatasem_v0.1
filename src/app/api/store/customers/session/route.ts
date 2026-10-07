// Storefront customer session (PHASE 2.5 authentication).
//
// POST: LOGIN with { phone, password } → credential verification
// (Argon2id, dummy-timing uniform, lockout, rate limits) → server-side
// opaque session. Phone alone NEVER yields a session (the Phase-2
// bootstrap is gone — see register for new accounts).
// Generic 401 on every failure (never distinguishes unknown phone, wrong
// password, inactive, or locked). Sets the HttpOnly session cookie AND
// returns the token (non-browser same-origin clients use x-customer-token).
// GET: current session customer (200 + customer) or 401.
// DELETE: logout — revokes the server-side session, then clears the
// cookie. The same token never validates again.
// Never Admin RBAC, never admin tables, never password hashes in output.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { customerLoginSchema } from "@/lib/customers/validation";
import { authenticateCustomer } from "@/lib/customers/auth";
import {
  CUSTOMER_SESSION_COOKIE,
  CUSTOMER_SESSION_TTL_SECONDS,
  readCustomerToken,
  requireCustomer,
  revokeCustomerSession,
  sessionExpiryIso,
} from "@/lib/customers/session";
import { getCustomer } from "@/lib/customers/queries";
import { toAddress, toCustomer } from "@/lib/customers/serialize";

const isProd = process.env.NODE_ENV === "production";

function cookieAttrs(maxAge: number): string {
  return `${CUSTOMER_SESSION_COOKIE}=__VALUE__; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isProd ? "; Secure" : ""}`;
}

function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first && first !== "" ? first : null;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const r = fail(new ApiError("VALIDATION", "Invalid request body."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const parsed = customerLoginSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid login request."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const out = await authenticateCustomer(parsed.data.phone, parsed.data.password, {
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  });
  if (!out.ok) {
    const r = fail(new ApiError("UNAUTHENTICATED", "Authentication is required.", null, false));
    return NextResponse.json(r.body, { status: r.status });
  }
  const customerRow = await getCustomer(out.customer.id);
  if (!customerRow) {
    const r = fail(new ApiError("UNAUTHENTICATED", "Authentication is required.", null, false));
    return NextResponse.json(r.body, { status: r.status });
  }
  const r = ok({ customer: toCustomer(customerRow), customerToken: out.token, expiresAt: sessionExpiryIso() });
  const res = NextResponse.json(r.body, { status: r.status });
  res.headers.set("Set-Cookie", cookieAttrs(CUSTOMER_SESSION_TTL_SECONDS).replace("__VALUE__", encodeURIComponent(out.token)));
  return res;
}

export async function GET(request: Request) {
  try {
    const me = await requireCustomer(request);
    const row = await getCustomer(me.customerId);
    if (!row) throw new ApiError("UNAUTHENTICATED", "Authentication is required.", null, false);
    const r = ok({ customer: toCustomer(row), addresses: row.addresses.map(toAddress) });
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}

export async function DELETE(request: Request) {
  const token = readCustomerToken(request);
  if (token) await revokeCustomerSession(token);
  const res = NextResponse.json(ok({ loggedOut: true }).body, { status: 200 });
  res.headers.set("Set-Cookie", cookieAttrs(0).replace("__VALUE__", "expired"));
  return res;
}
