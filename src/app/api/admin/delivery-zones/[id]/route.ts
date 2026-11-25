// Admin delivery zone: update (compare-and-set) + deactivate via PATCH.
//
// E-3 closure — reads: `delivery.view` OR `settings.view` (the dedicated
// capability or the broader store-configuration one). Writes:
// `settings.manage` AND `delivery.assign` — a delivery-fee edit is a
// store-wide money change (same trust class as store settings) and it is the
// delivery-assignment capability, so BOTH keys are required.
//
// `version` is required and must match the row the admin read; a stale
// version answers 409 instead of overwriting a concurrent change. There is
// deliberately no hard DELETE: fee history and auditability outlive a zone,
// and deactivation (`isActive: false`) removes it from fee resolution.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { adminOrDenyAll } from "@/lib/api/route-auth";
import { uuidSchema } from "@/lib/api/validation";
import { deliveryZonePatchSchema } from "@/lib/admin/validation";
import { updateDeliveryZone } from "@/lib/admin/delivery-zones";
import { toDeliveryZone } from "@/lib/admin/serialize";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await adminOrDenyAll(["settings.manage", "delivery.assign"]);
  if ("denied" in gate) return gate.denied;
  const auth = gate;
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid delivery zone id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const r = fail(new ApiError("VALIDATION", "Invalid request body."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const parsed = deliveryZonePatchSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid delivery zone."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const zone = await updateDeliveryZone(id, parsed.data, auth.admin.user.id);
    if (!zone) {
      const r = fail(new ApiError("NOT_FOUND", "Delivery zone not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = ok(toDeliveryZone(zone));
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
