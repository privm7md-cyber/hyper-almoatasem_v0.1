// Storefront authenticated password change (PHASE 2.5).
// PATCH body { currentPassword, newPassword }: verifies the current
// credential (wrong → generic 401), enforces policy on the new one,
// rehashes, and revokes EVERY session including the current one —
// the client re-authenticates afterwards. Never exposes hashes.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { resolveClientIp } from "@/lib/api/client-ip";
import { assertSameOriginOrThrow } from "@/lib/api/request-context";
import { fail, ok } from "@/lib/api/respond";
import {
  CUSTOMER_PASSWORD_ACCOUNT_LIMIT,
  CUSTOMER_PASSWORD_IP_LIMIT,
  checkAndRecordRateLimit,
  customerPasswordAccountBucket,
  customerPasswordIpBucket,
} from "@/lib/auth/rate-limit";
import { customerPasswordChangeSchema } from "@/lib/customers/validation";
import { changeCustomerPassword } from "@/lib/customers/auth";
import { customerSessionCookieName, requireCustomer } from "@/lib/customers/session";

function clearSessionCookieHeader(): string {
  const name = customerSessionCookieName();
  const secure = name.startsWith("__Host-");
  return `${name}=expired; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

export async function PATCH(request: Request) {
  try {
    assertSameOriginOrThrow(request);
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const r = fail(new ApiError("VALIDATION", "Invalid request body."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const parsed = customerPasswordChangeSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid password change request."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const me = await requireCustomer(request);
    const ip = resolveClientIp(request.headers).ip;
    const [ipGate, acctGate] = await Promise.all([
      checkAndRecordRateLimit(
        customerPasswordIpBucket(ip, me.customerId),
        CUSTOMER_PASSWORD_IP_LIMIT,
        undefined,
        "customer_auth_rate_limits",
      ),
      checkAndRecordRateLimit(
        customerPasswordAccountBucket(me.customerId),
        CUSTOMER_PASSWORD_ACCOUNT_LIMIT,
        undefined,
        "customer_auth_rate_limits",
      ),
    ]);
    if (!ipGate.allowed || !acctGate.allowed) {
      const r = fail(new ApiError("RATE_LIMITED", "Too many requests.", null, true));
      return NextResponse.json(r.body, { status: r.status });
    }
    let changed = false;
    try {
      changed = await changeCustomerPassword(me.customerId, parsed.data.currentPassword, parsed.data.newPassword);
    } catch {
      const r = fail(new ApiError("VALIDATION", "Invalid password change request."));
      return NextResponse.json(r.body, { status: r.status });
    }
    if (!changed) {
      const r = fail(new ApiError("UNAUTHENTICATED", "Authentication is required.", null, false));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = ok({ passwordChanged: true });
    const res = NextResponse.json(r.body, { status: r.status });
    res.headers.set("Set-Cookie", clearSessionCookieHeader());
    return res;
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
