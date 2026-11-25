// Admin delivery zones: list + create (residual Phase-10 closure, P10-L-02).
//
// E-3 closure — the delivery capabilities are now enforced, not merely
// catalogued:
//   READ  : `delivery.view` OR `settings.view` — the dedicated capability OR
//           the broader store-configuration capability that always covered
//           this screen. The union never widens access beyond the database
//           grants: the caller must hold ONE of the two keys.
//   WRITE : `settings.manage` AND `delivery.assign` — a delivery-fee edit is a
//           store-wide money change (same trust class as store settings) AND
//           it is the delivery-assignment capability, so BOTH keys are
//           required. Only SUPER_ADMIN holds both by default; STORE_ADMIN is
//           intentionally excluded from `settings.manage`.
//
// The normalized matching key is derived server-side from `name`; clients
// never send it. Fees use the checkout wire shape (non-negative, ≤2 decimals).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { created, fail, ok } from "@/lib/api/respond";
import { adminOrDenyAll, denyUnlessAny } from "@/lib/api/route-auth";
import { deliveryZoneCreateSchema, deliveryZoneListQuerySchema } from "@/lib/admin/validation";
import { createDeliveryZone, listDeliveryZones } from "@/lib/admin/delivery-zones";
import { toDeliveryZone } from "@/lib/admin/serialize";

export async function GET(request: Request) {
  const denied = await denyUnlessAny(["delivery.view", "settings.view"]);
  if (denied) return denied;
  const parsed = deliveryZoneListQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid query."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const active = parsed.data.active == null ? null : parsed.data.active === "true";
  const rows = await listDeliveryZones(active);
  const r = ok(rows.map(toDeliveryZone), { total: rows.length });
  return NextResponse.json(r.body, { status: r.status });
}

export async function POST(request: Request) {
  const gate = await adminOrDenyAll(["settings.manage", "delivery.assign"]);
  if ("denied" in gate) return gate.denied;
  const auth = gate;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const r = fail(new ApiError("VALIDATION", "Invalid request body."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const parsed = deliveryZoneCreateSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid delivery zone."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const zone = await createDeliveryZone(parsed.data, auth.admin.user.id);
    const r = created(toDeliveryZone(zone));
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
