// Admin product→brand candidate review and explicitly confirmed apply.
// GET  = read-only candidate listing (classification recomputed server-side).
// POST = signed preview or transactional apply with RBAC + audit + receipt.
import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { adminOrDeny, adminSessionOrDeny, denyUnless } from "@/lib/api/route-auth";
import {
  BRAND_ASSOCIATION_CLASSIFICATIONS,
  brandAssociationOperationSchema,
  listBrandAssociationReviewCandidates,
  previewOrApplyBrandAssociations,
} from "@/lib/catalog/brand-association-review";

z.config({ jitless: true });

const listQuerySchema = z.object({
  classification: z.enum(BRAND_ASSOCIATION_CLASSIFICATIONS).default("ALL"),
  search: z.string().trim().max(120).default(""),
  brandId: z.string().uuid().nullable().default(null),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function GET(request: Request) {
  const denied = await denyUnless("products.view");
  if (denied) return denied;

  const url = new URL(request.url);
  const parsed = listQuerySchema.safeParse({
    classification: url.searchParams.get("classification") ?? "ALL",
    search: url.searchParams.get("search") ?? "",
    brandId: url.searchParams.get("brandId") || null,
    offset: url.searchParams.get("offset") ?? "0",
    limit: url.searchParams.get("limit") ?? "50",
  });
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", parsed.error.issues[0]?.message ?? "Invalid brand review query."));
    return NextResponse.json(r.body, { status: r.status });
  }

  try {
    const result = await listBrandAssociationReviewCandidates(parsed.data);
    const r = ok(result);
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}

export async function POST(request: Request) {
  const sessionGate = await adminSessionOrDeny(null);
  if ("denied" in sessionGate) return sessionGate.denied;

  const gate = await adminOrDeny("products.update");
  if ("denied" in gate) return gate.denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const r = fail(new ApiError("VALIDATION", "Invalid request body."));
    return NextResponse.json(r.body, { status: r.status });
  }

  const parsed = brandAssociationOperationSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", parsed.error.issues[0]?.message ?? "Invalid brand association payload."));
    return NextResponse.json(r.body, { status: r.status });
  }

  try {
    const result = await previewOrApplyBrandAssociations(parsed.data, sessionGate.admin.user.id);
    const r = ok(result);
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
