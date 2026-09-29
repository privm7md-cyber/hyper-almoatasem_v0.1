// Admin single address: get / update / hard-delete, always scoped to the
// path customer (cross-customer access → 404, never leaks existence).
// Permission: customers.view throughout (documented mapping). DELETE is a
// hard delete per the frozen model (no deleted_at; orders keep snapshots).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { adminOrDeny, denyUnless } from "@/lib/api/route-auth";
import { uuidSchema } from "@/lib/api/validation";
import { addressPatchSchema } from "@/lib/customers/validation";
import { getAddressOfCustomer } from "@/lib/customers/queries";
import { deleteAddress, patchAddress } from "@/lib/customers/writes";
import { toAddress } from "@/lib/customers/serialize";

async function ids(context: { params: Promise<{ id: string; addressId: string }> }) {
  const p = await context.params;
  if (!uuidSchema.safeParse(p.id).success || !uuidSchema.safeParse(p.addressId).success) return null;
  return p;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string; addressId: string }> }) {
  const denied = await denyUnless("customers.view");
  if (denied) return denied;
  const p = await ids(context);
  if (!p) {
    const r = fail(new ApiError("VALIDATION", "Invalid address id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const row = await getAddressOfCustomer(p.id, p.addressId);
  if (!row) {
    const r = fail(new ApiError("NOT_FOUND", "Address not found."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const r = ok(toAddress(row));
  return NextResponse.json(r.body, { status: r.status });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string; addressId: string }> }) {
  const gate = await adminOrDeny("customers.view");
  if ("denied" in gate) return gate.denied;
  const p = await ids(context);
  if (!p) {
    const r = fail(new ApiError("VALIDATION", "Invalid address id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const r = fail(new ApiError("VALIDATION", "Invalid request body."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const parsed = addressPatchSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid address."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const row = await patchAddress(p.id, p.addressId, {
      label: parsed.data.label,
      city: parsed.data.city ?? undefined,
      area: parsed.data.area,
      village: parsed.data.village,
      street: parsed.data.street,
      buildingNumber: parsed.data.buildingNumber,
      landmark: parsed.data.landmark,
      phoneRaw: parsed.data.phone ?? undefined,
      isDefault: parsed.data.isDefault ?? undefined,
    }, gate.admin.user.id);
    if (!row) {
      const r = fail(new ApiError("NOT_FOUND", "Address not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = ok(toAddress(row));
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string; addressId: string }> }) {
  const gate = await adminOrDeny("customers.view");
  if ("denied" in gate) return gate.denied;
  const p = await ids(context);
  if (!p) {
    const r = fail(new ApiError("VALIDATION", "Invalid address id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const done = await deleteAddress(p.id, p.addressId, gate.admin.user.id);
  if (!done) {
    const r = fail(new ApiError("NOT_FOUND", "Address not found."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const r = ok({ deleted: true });
  return NextResponse.json(r.body, { status: r.status });
}
