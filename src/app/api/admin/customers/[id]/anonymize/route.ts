// ADM-OWNER G3 — customer anonymization & H2 status API (default-disabled).
//
// Permission: `customers.anonymize` — a SEPARATE capability from
// `customers.manage` (owner decision, 12 Nov 2026). Both `GET` and `POST`
// enforce `adminOrDeny("customers.anonymize")` and UUID validation first.
//
// Activation Boundary (P12-08 D01, 18 Nov 2026):
//   • Default (`CUSTOMER_AUDIT_REDACTION_MODE !== "H2"`):
//     - `POST` runs the pre-existing synchronous path (`200 OK`).
//     - `GET` enforces `adminOrDeny("customers.anonymize")` first, then returns
//       `404 NOT_FOUND` so the H2 status contract is NOT activated on Primary
//       before database migration and worker provisioning are approved.
//   • When `CUSTOMER_AUDIT_REDACTION_MODE=H2` is explicitly enabled:
//     - `POST` requires `gate.admin.sessionId` and returns `200 OK` (`anonymized: true`)
//       or `202 Accepted` (`anonymized: false` — `PENDING_AUDIT_REDACTION` / `FAILED`).
//     - `GET` returns `CustomerAnonymizeStatusResponse` (`202` when `PENDING`/`FAILED`,
//       `200` when `NOT_ANONYMIZED` / `COMPLETED`) with zero PII.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { adminOrDeny } from "@/lib/api/route-auth";
import { uuidSchema } from "@/lib/api/validation";
import {
  anonymizeInputSchema,
  anonymizeCustomer,
  getCustomerAnonymizeStatus,
  isCustomerAuditRedactionH2Enabled,
} from "@/lib/customers/anonymize";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await adminOrDeny("customers.anonymize");
  if ("denied" in gate) return gate.denied;
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid customer id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  if (!isCustomerAuditRedactionH2Enabled()) {
    const r = fail(new ApiError("NOT_FOUND", "Customer audit redaction queue is not enabled."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const status = await getCustomerAnonymizeStatus(id);
    if (!status) {
      const r = fail(new ApiError("NOT_FOUND", "Customer not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = ok(status);
    const httpStatus =
      status.state === "PENDING_AUDIT_REDACTION" || status.state === "FAILED" ? 202 : 200;
    return NextResponse.json(r.body, { status: httpStatus });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await adminOrDeny("customers.anonymize");
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
  const parsed = anonymizeInputSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid anonymization request."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const h2Enabled = isCustomerAuditRedactionH2Enabled();
  if (h2Enabled && !gate.admin.sessionId) {
    const r = fail(new ApiError("UNAUTHENTICATED", "Authentication required."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const result = h2Enabled
      ? await anonymizeCustomer(id, parsed.data, gate.admin.user.id, gate.admin.sessionId)
      : await anonymizeCustomer(id, parsed.data, gate.admin.user.id);
    const r = ok(result);
    const httpStatus = h2Enabled && !result.anonymized ? 202 : r.status;
    return NextResponse.json(r.body, { status: httpStatus });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
