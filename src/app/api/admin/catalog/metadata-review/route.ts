import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { adminOrDeny, denyUnless } from "@/lib/api/route-auth";
import { uuidSchema } from "@/lib/api/validation";
import {
  listMetadataReviewRows,
  metadataReviewOperationSchema,
  previewOrApplyMetadataReview,
  type MetadataReviewIssueFilter,
} from "@/lib/catalog/metadata-review";

const ISSUE_FILTERS = new Set<MetadataReviewIssueFilter>([
  "all", "missing_unit", "missing_value", "partial_pair", "weight_conflict", "packaged_piece", "duplicate_variant",
]);

export async function GET(request: Request) {
  const denied = await denyUnless("products.view");
  if (denied) return denied;
  const url = new URL(request.url);
  const rawIssue = url.searchParams.get("issue") ?? "all";
  const issue = ISSUE_FILTERS.has(rawIssue as MetadataReviewIssueFilter) ? rawIssue as MetadataReviewIssueFilter : null;
  const search = url.searchParams.get("search")?.trim().slice(0, 160) || null;
  const cursor = url.searchParams.get("cursor")?.trim() || null;
  const rawLimit = Number(url.searchParams.get("limit") ?? "50");
  const limit = Number.isInteger(rawLimit) && rawLimit >= 1 && rawLimit <= 100 ? rawLimit : 50;
  if (issue === null || (cursor !== null && !uuidSchema.safeParse(cursor).success)) {
    const r = fail(new ApiError("VALIDATION", "فلتر أو رابط مراجعة البيانات غير صالح."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const result = await listMetadataReviewRows({ issue, search, cursor, limit });
    const r = ok(result);
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}

export async function POST(request: Request) {
  const gate = await adminOrDeny("products.update");
  if ("denied" in gate) return gate.denied;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const r = fail(new ApiError("VALIDATION", "جسم الطلب غير صالح."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const parsed = metadataReviewOperationSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", parsed.error.issues[0]?.message ?? "بيانات التصحيح غير صالحة."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const result = await previewOrApplyMetadataReview(parsed.data, gate.admin.user.id);
    const r = ok(result);
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
