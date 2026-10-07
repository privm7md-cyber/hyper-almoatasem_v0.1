// Storefront customer registration (PHASE 2.5): phone + password →
// registered account + authenticated server-side session.
// Validation: phone ladder (422 on ladder failure via domain), password
// policy 12..128 (400 on malformed body, policy enforced in domain).
// Duplicate registered phone → 409 (accepted, documented enumeration
// surface — login itself stays uniform). Guest-row conversion happens
// transparently for unregistered phones. Strict: no customerId,
// password_hash, is_registered, or timestamps from clients.
// Sets the HttpOnly session cookie AND returns the token.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { created, fail } from "@/lib/api/respond";
import { customerRegisterSchema } from "@/lib/customers/validation";
import { registerCustomer } from "@/lib/customers/auth";
import {
  CUSTOMER_SESSION_COOKIE,
  CUSTOMER_SESSION_TTL_SECONDS,
  sessionExpiryIso,
} from "@/lib/customers/session";
import { getCustomer } from "@/lib/customers/queries";
import { toCustomer } from "@/lib/customers/serialize";

const isProd = process.env.NODE_ENV === "production";

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
  const out = await registerCustomer(
    {
      phone: parsed.data.phone,
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName ?? null,
      password: parsed.data.password,
    },
    {
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
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
  res.headers.set(
    "Set-Cookie",
    `${CUSTOMER_SESSION_COOKIE}=${encodeURIComponent(out.token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${CUSTOMER_SESSION_TTL_SECONDS}${isProd ? "; Secure" : ""}`,
  );
  return res;
}
