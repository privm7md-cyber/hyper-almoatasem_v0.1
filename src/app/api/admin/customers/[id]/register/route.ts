// Admin customer registration: staff-assisted guest → registered upgrade.
// Permission: customers.view (documented closest-capability mapping — see
// [id]/route.ts). Policy + Argon2id via the existing auth infrastructure;
// the secret travels only in this request body, is hashed server-side, and
// is never logged or returned. Already-registered (or raced) → 409.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { adminOrDeny } from "@/lib/api/route-auth";
import { uuidSchema } from "@/lib/api/validation";
import { registerInputSchema } from "@/lib/customers/validation";
import { upgradeToRegistered } from "@/lib/customers/writes";
import { toCustomer } from "@/lib/customers/serialize";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await adminOrDeny("customers.view");
  if ("denied" in gate) return gate.denied;
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid customer id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const r = fail(new ApiError("VALIDATION", "Invalid request body."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const parsed = registerInputSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid registration."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const updated = await upgradeToRegistered(id, parsed.data.password, gate.admin.user.id);
    if (!updated) {
      const r = fail(new ApiError("NOT_FOUND", "Customer not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = ok(toCustomer(updated));
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
