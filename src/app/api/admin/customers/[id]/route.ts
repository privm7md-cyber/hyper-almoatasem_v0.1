// Admin customer detail (with address book) + limited edit.
// GET: customers.view (READ only). PATCH: customers.manage (Phase-10
// remediation, G03 — the customer domain is split into a read capability and
// a write capability; the read key no longer authorizes a customer mutation).
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
import { emptyPatchResponse, isEmptyPatchBody } from "@/lib/api/patch";

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
  const gate = await adminOrDeny("customers.manage");
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
  // An empty patch changes nothing: reject it instead of writing a no-op row
  // and a misleading audit row (Phase-10 remediation, G05).
  if (isEmptyPatchBody(body)) return emptyPatchResponse();
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
