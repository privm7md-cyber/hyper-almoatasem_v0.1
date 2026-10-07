// Storefront customer address book: list + create for the current customer.
//
// Identity (PHASE 2): the owner is derived server-side from the verified
// customer session — no customerId travels in query or body, so there is
// no client-controlled ownership to forge. Missing/invalid/expired
// session → 401. Cross-customer access is impossible by construction
// (the scope always equals the session customer). Self-service mutations
// are unaudited per the frozen rule (audit rows are ADMIN-actor rows).
// No governorate, no new fields — the shape mirrors the frozen table.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { created, fail, ok } from "@/lib/api/respond";
import { addressInputSchema } from "@/lib/customers/validation";
import { listAddressesByCustomer } from "@/lib/customers/queries";
import { createAddress } from "@/lib/customers/writes";
import { requireCustomer } from "@/lib/customers/session";
import { toAddress } from "@/lib/customers/serialize";

export async function GET(request: Request) {
  try {
    const me = await requireCustomer(request);
    const rows = await listAddressesByCustomer(me.customerId);
    const r = ok(rows.map(toAddress));
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}

export async function POST(request: Request) {
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
    const me = await requireCustomer(request);
    const row = await createAddress(me.customerId, {
      label: parsed.data.label ?? null,
      city: parsed.data.city,
      area: parsed.data.area ?? null,
      village: parsed.data.village ?? null,
      street: parsed.data.street ?? null,
      buildingNumber: parsed.data.buildingNumber ?? null,
      landmark: parsed.data.landmark ?? null,
      phoneRaw: parsed.data.phone,
      isDefault: parsed.data.isDefault ?? null,
    }, null);
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
