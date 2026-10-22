// Storefront customer registration (PHASE 2.5): phone + password →
// registered account + authenticated server-side session.
// Validation: phone ladder (422 on ladder failure via domain), password
// policy 12..128 (400 on malformed body, policy enforced in domain).
// Duplicate registered phone → 409 (accepted, documented enumeration
// surface — login itself stays uniform). Guest-row conversion happens
// transparently for unregistered phones. Strict: no customerId,
// password_hash, is_registered, or timestamps from clients.
// G5 rate limiting: isolated IP (30/15min) + HMAC-bound canonical-phone
// (10/15min, secret REG_RATE_LIMIT_PHONE_SECRET) buckets on the shared
// customer table — checked AFTER Zod parse (malformed bodies burn no budget)
// and BEFORE hashing/DB writes (each attempt burns Argon2 + a tx).
// Rejection is generic 429; a missing/invalid secret fails closed (500).
// Sets the HttpOnly session cookie AND returns the token.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { created, fail } from "@/lib/api/respond";
import {
  REG_REGISTER_IP_LIMIT,
  REG_REGISTER_PHONE_LIMIT,
  checkAndRecordRateLimit,
  customerRegIpBucket,
  customerRegPhoneBucket,
} from "@/lib/auth/rate-limit";
import { normalizeIdentityPhone } from "@/lib/customers/phone";
import { customerRegisterSchema } from "@/lib/customers/validation";
import { registerCustomer } from "@/lib/customers/auth";
import {
  customerSessionCookieName,
  CUSTOMER_SESSION_TTL_SECONDS,
  sessionExpiryIso,
} from "@/lib/customers/session";
import { getCustomer } from "@/lib/customers/queries";
import { toCustomer } from "@/lib/customers/serialize";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const r = fail(new ApiError("VALIDATION", "Invalid request body."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const parsed = customerRegisterSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid registration."));
    return NextResponse.json(r.body, { status: r.status });
  }
  // G5 gate: IP bucket always; HMAC phone bucket only when the phone
  // canonicalizes (ladder-invalid input still burns IP budget, matching the
  // login uniform-budget posture — but never a phone bucket it can't key).
  // Phone keys are secret-bound (never raw, never plain SHA-256); a missing
  // or invalid secret fails closed here with a generic 500 — no fallback.
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  try {
    const ipGate = await checkAndRecordRateLimit(
      customerRegIpBucket(ip),
      REG_REGISTER_IP_LIMIT,
      undefined,
      "customer_auth_rate_limits",
    );
    if (!ipGate.allowed) {
      const r = fail(new ApiError("RATE_LIMITED", "Too many requests.", null, true));
      return NextResponse.json(r.body, { status: r.status });
    }
  } catch {
    const r = fail(new ApiError("INTERNAL", "Unexpected error.", null, false));
    return NextResponse.json(r.body, { status: r.status });
  }
  let canonical: string | null = null;
  try {
    canonical = normalizeIdentityPhone(parsed.data.phone);
  } catch {
    canonical = null;
  }
  if (canonical !== null) {
    let phoneGate: { allowed: boolean };
    try {
      phoneGate = await checkAndRecordRateLimit(
        customerRegPhoneBucket(canonical),
        REG_REGISTER_PHONE_LIMIT,
        undefined,
        "customer_auth_rate_limits",
      );
    } catch {
      const r = fail(new ApiError("INTERNAL", "Unexpected error.", null, false));
      return NextResponse.json(r.body, { status: r.status });
    }
    if (!phoneGate.allowed) {
      const r = fail(new ApiError("RATE_LIMITED", "Too many requests.", null, true));
      return NextResponse.json(r.body, { status: r.status });
    }
  }
  const out = await registerCustomer(
    {
      phone: parsed.data.phone,
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName ?? null,
      password: parsed.data.password,
    },
    {
      ip,
      userAgent: request.headers.get("user-agent"),
    },
  );
  if (!out.ok) {
    const code = out.error === "An account with this phone already exists." ? "CONFLICT" : "VALIDATION";
    const r = fail(new ApiError(code as "CONFLICT" | "VALIDATION", out.error));
    return NextResponse.json(r.body, { status: r.status });
  }
  const row = await getCustomer(out.customer.id);
  if (!row) {
    const r = fail(new ApiError("INTERNAL", "Unexpected error.", null, false));
    return NextResponse.json(r.body, { status: r.status });
  }
  const r = created({ customer: toCustomer(row), customerToken: out.token, expiresAt: sessionExpiryIso() });
  const res = NextResponse.json(r.body, { status: r.status });
  // The cookie NAME follows the environment policy and `Secure` is mandatory
  // for a `__Host-` cookie (Phase-12: the storefront session had the same
  // "browser drops the cookie" defect as the admin session).
  const sessionCookie = customerSessionCookieName();
  res.headers.set(
    "Set-Cookie",
    `${sessionCookie}=${encodeURIComponent(out.token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${CUSTOMER_SESSION_TTL_SECONDS}${
      sessionCookie.startsWith("__Host-") ? "; Secure" : ""
    }`,
  );
  return res;
}
