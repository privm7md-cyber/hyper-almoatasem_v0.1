// Admin customer detail (with address book) + limited edit.
// GET: customers.view. PATCH: customers.view (documented closest-capability
// mapping — the frozen 31-key matrix holds no customer write key; a future
// customers.manage split is deferred, never invented here).
// Phone is immutable (identity stability); registration changes only via
// /register; customers are never hard-deleted (RESTRICT pins + history).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { adminOrDeny, denyUnless } from "@/lib/api/route-auth";
import { uuidSchema } from "@/lib/api/validation";
import { customerPatchSchema } from "@/lib/customers/validation";
import { getCustomer } from "@/lib/customers/queries";
import { patchCustomer } from "@/lib/customers/writes";
import { toAddress, toCustomer } from "@/lib/customers/serialize";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await denyUnless("customers.view");
  if (denied) return denied;
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid customer id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const row = await getCustomer(id);
  if (!row) {
    const r = fail(new ApiError("NOT_FOUND", "Customer not found."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const r = ok({ customer: toCustomer(row), addresses: row.addresses.map(toAddress) });
  return NextResponse.json(r.body, { status: r.status });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
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
  const parsed = customerPatchSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid customer."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const updated = await patchCustomer(id, {
      firstName: parsed.data.firstName ?? undefined,
      lastName: parsed.data.lastName,
      email: parsed.data.email,
      autoAcceptReplacements: parsed.data.autoAcceptReplacements ?? undefined,
      isActive: parsed.data.isActive ?? undefined,
    }, gate.admin.user.id);
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
