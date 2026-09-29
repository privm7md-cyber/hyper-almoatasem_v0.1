// Public storefront: guest get-or-create by canonical phone.
// Phone is the frozen identity (global UNIQUE); concurrent callers converge
// onto one customer via the UNIQUE backstop (never duplicates). Existing →
// 200, created → 201. No OTP/customer-auth exists in frozen scope — the
// response carries identity fields only (never password_hash by
// construction); customer self-service auth is deferred.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { created, fail, ok } from "@/lib/api/respond";
import { identifyInputSchema } from "@/lib/customers/validation";
import { identifyCustomer } from "@/lib/customers/writes";
import { toCustomer } from "@/lib/customers/serialize";

export async function POST(request: Request) {
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
    const out = await identifyCustomer({
      phoneRaw: parsed.data.phone,
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName ?? null,
    });
    const r = out.created ? created(toCustomer(out.customer)) : ok(toCustomer(out.customer));
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
