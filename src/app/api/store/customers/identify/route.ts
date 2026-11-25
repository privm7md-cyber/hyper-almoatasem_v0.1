// Public storefront: guest get-or-create by canonical phone.
// Phone is the frozen identity (global UNIQUE); concurrent callers converge
// onto one customer via the UNIQUE backstop (never duplicates). Existing →
// 200, created → 201. PHASE 2.5: this endpoint is a customer lookup / guest
// bootstrap helper ONLY — it never mints an authenticated session (phone
// alone is not a credential). Authenticated access requires register/login
// with a password. The response carries identity fields only (never
// password_hash by construction).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { created, fail, ok } from "@/lib/api/respond";
import { assertSameOriginOrThrow, extractRateLimitIp } from "@/lib/api/request-context";
import {
  IDENTIFY_IP_LIMIT,
  IDENTIFY_PHONE_LIMIT,
  checkAndRecordRateLimit,
  customerIdentifyIpBucket,
  customerIdentifyPhoneBucket,
} from "@/lib/auth/rate-limit";
import { normalizeIdentityPhone } from "@/lib/customers/phone";
import { identifyInputSchema } from "@/lib/customers/validation";
import { identifyCustomer } from "@/lib/customers/writes";
import { toCustomer } from "@/lib/customers/serialize";

export async function POST(request: Request) {
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
  const parsed = identifyInputSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid customer identity."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    let canonicalPhone = parsed.data.phone.trim();
    try {
      canonicalPhone = normalizeIdentityPhone(parsed.data.phone);
    } catch {
      const r = fail(new ApiError("VALIDATION", "Invalid customer identity."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const clientIp = extractRateLimitIp(request.headers);
    const [ipGate, phoneGate] = await Promise.all([
      checkAndRecordRateLimit(
        customerIdentifyIpBucket(clientIp, canonicalPhone),
        IDENTIFY_IP_LIMIT,
        undefined,
        "customer_auth_rate_limits",
      ),
      checkAndRecordRateLimit(
        customerIdentifyPhoneBucket(canonicalPhone),
        IDENTIFY_PHONE_LIMIT,
        undefined,
        "customer_auth_rate_limits",
      ),
    ]);
    if (!ipGate.allowed || !phoneGate.allowed) {
      const r = fail(new ApiError("RATE_LIMITED", "Too many requests.", null, true));
      return NextResponse.json(r.body, { status: r.status });
    }

    const out = await identifyCustomer({
      phoneRaw: parsed.data.phone,
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName ?? null,
    });
    const dto = toCustomer(out.customer);
    // BUG-04 remediation: never disclose stored PII (firstName, lastName, email)
    // of an existing customer to an unauthenticated caller who only knows a phone number.
    const safeDto = out.created
      ? dto
      : {
          ...dto,
          firstName: parsed.data.firstName,
          lastName: parsed.data.lastName ?? null,
          email: null,
        };
    const r = out.created ? created(safeDto) : ok(safeDto);
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
