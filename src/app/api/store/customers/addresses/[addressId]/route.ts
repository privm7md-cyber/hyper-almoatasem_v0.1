// Storefront single address: get / update / hard-delete, always scoped to
// the session customer (PHASE 2 — owner derived server-side; unknown or
// foreign addresses read as 404 without leaking existence). PATCH is
// partial with an immutable owner; DELETE is a hard delete per the frozen
// model (no deleted_at; orders keep snapshots, never FKs here).
// Self-service mutations unaudited (actorId null, frozen rule).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { uuidSchema } from "@/lib/api/validation";
import { addressPatchSchema } from "@/lib/customers/validation";
import { getAddressOfCustomer } from "@/lib/customers/queries";
import { deleteAddress, patchAddress } from "@/lib/customers/writes";
import { requireCustomer } from "@/lib/customers/session";
import { toAddress } from "@/lib/customers/serialize";

export async function GET(request: Request, context: { params: Promise<{ addressId: string }> }) {
  try {
    const me = await requireCustomer(request);
    const { addressId } = await context.params;
    if (!uuidSchema.safeParse(addressId).success) {
      throw new ApiError("VALIDATION", "Invalid address id.");
    }
    const row = await getAddressOfCustomer(me.customerId, addressId);
    if (!row) throw new ApiError("NOT_FOUND", "Address not found.");
    const r = ok(toAddress(row));
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ addressId: string }> }) {
  const { addressId } = await context.params;
  if (!uuidSchema.safeParse(addressId).success) {
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
    const me = await requireCustomer(request);
    const row = await patchAddress(me.customerId, addressId, {
      label: parsed.data.label,
      city: parsed.data.city ?? undefined,
      area: parsed.data.area,
      village: parsed.data.village,
      street: parsed.data.street,
      buildingNumber: parsed.data.buildingNumber,
      landmark: parsed.data.landmark,
      phoneRaw: parsed.data.phone ?? undefined,
      isDefault: parsed.data.isDefault ?? undefined,
    }, null);
    if (!row) throw new ApiError("NOT_FOUND", "Address not found.");
    const r = ok(toAddress(row));
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ addressId: string }> }) {
  try {
    const me = await requireCustomer(request);
    const { addressId } = await context.params;
    if (!uuidSchema.safeParse(addressId).success) {
      throw new ApiError("VALIDATION", "Invalid address id.");
    }
    const done = await deleteAddress(me.customerId, addressId, null);
    if (!done) throw new ApiError("NOT_FOUND", "Address not found.");
    const r = ok({ deleted: true });
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
