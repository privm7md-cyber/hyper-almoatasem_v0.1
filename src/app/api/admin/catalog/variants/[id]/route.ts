// Admin catalog: single variant GET + PATCH (cost basis visible here;
// never on storefront shapes). Price changes go through ./price (history).
// Reads: products.view AND prices.view (the variant carries the selling
// price and the internal cost basis — Phase-10 remediation, G01).
// Updates: products.update.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { adminOrDenyAll, denyUnlessAll } from "@/lib/api/route-auth";
import { uuidSchema } from "@/lib/api/validation";
import { variantPatchSchema } from "@/lib/catalog/validation";
import { getVariant } from "@/lib/catalog/queries";
import { patchVariant } from "@/lib/catalog/writes";
import { toAdminVariant } from "@/lib/catalog/serialize";
import { emptyPatchResponse, isEmptyPatchBody } from "@/lib/api/patch";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await denyUnlessAll(["products.view", "prices.view"]);
  if (denied) return denied;
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid variant id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const row = await getVariant(id, true);
  if (!row) {
    const r = fail(new ApiError("NOT_FOUND", "Variant not found."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const r = ok(toAdminVariant(row));
  return NextResponse.json(r.body, { status: r.status });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const r = fail(new ApiError("VALIDATION", "Invalid request body."));
    return NextResponse.json(r.body, { status: r.status });
  }
  // Field-level authorization (Phase-10 remediation, G01): the variant
  // structure is `products.update`; a PRICE field (compare-at / cost basis)
  // additionally needs `prices.update`, so price governance is not reachable
  // through a plain product edit.
  const touchesPrice = ["compareAtPrice", "costPrice"].some(
    (k) => body && typeof body === "object" && k in (body as Record<string, unknown>),
  );
  const gate = await adminOrDenyAll(
    touchesPrice ? ["products.update", "prices.update"] : ["products.update"],
  );
  if ("denied" in gate) return gate.denied;
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid variant id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const parsed = variantPatchSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid variant."));
    return NextResponse.json(r.body, { status: r.status });
  }
  // An empty patch changes nothing: reject it instead of writing a no-op row
  // and a misleading audit row (Phase-10 remediation, G05).
  if (isEmptyPatchBody(body)) return emptyPatchResponse();
  try {
    const row = await patchVariant(id, parsed.data, gate.admin.user.id);
    if (!row) {
      const r = fail(new ApiError("NOT_FOUND", "Variant not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = ok(toAdminVariant(row));
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
