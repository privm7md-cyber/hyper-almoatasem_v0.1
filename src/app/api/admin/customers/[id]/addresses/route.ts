// Admin customer address book: list + create, scoped to the path customer.
// Reads: customers.view. Creates: customers.view (documented
// closest-capability mapping). Default switch is one transaction; the
// partial-UQ backstop turns a lost default race into 409. No governorate,
// no postal/geo fields — the shape mirrors the frozen table exactly.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { created, fail, ok } from "@/lib/api/respond";
import { adminOrDeny, denyUnless } from "@/lib/api/route-auth";
import { uuidSchema } from "@/lib/api/validation";
import { addressInputSchema } from "@/lib/customers/validation";
import { listAddressesByCustomer } from "@/lib/customers/queries";
import { createAddress } from "@/lib/customers/writes";
import { toAddress } from "@/lib/customers/serialize";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await denyUnless("customers.view");
  if (denied) return denied;
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid customer id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const rows = await listAddressesByCustomer(id);
  const r = ok(rows.map(toAddress));
  return NextResponse.json(r.body, { status: r.status });
}

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
  const parsed = addressInputSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid address."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const row = await createAddress(id, {
      label: parsed.data.label ?? null,
      city: parsed.data.city,
      area: parsed.data.area ?? null,
      village: parsed.data.village ?? null,
      street: parsed.data.street ?? null,
      buildingNumber: parsed.data.buildingNumber ?? null,
      landmark: parsed.data.landmark ?? null,
      phoneRaw: parsed.data.phone,
      isDefault: parsed.data.isDefault ?? null,
    }, gate.admin.user.id);
    if (!row) {
      const r = fail(new ApiError("NOT_FOUND", "Customer not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = created(toAddress(row));
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
