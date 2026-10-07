// Storefront authenticated password change (PHASE 2.5).
// PATCH body { currentPassword, newPassword }: verifies the current
// credential (wrong → generic 401), enforces policy on the new one,
// rehashes, and revokes EVERY session including the current one —
// the client re-authenticates afterwards. Never exposes hashes.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { customerPasswordChangeSchema } from "@/lib/customers/validation";
import { changeCustomerPassword } from "@/lib/customers/auth";
import { requireCustomer } from "@/lib/customers/session";

export async function PATCH(request: Request) {
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
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
