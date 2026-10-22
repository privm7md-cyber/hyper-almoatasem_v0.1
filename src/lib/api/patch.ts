// Shared PATCH-body helpers (Phase-10 remediation, G05).
//
// A PATCH that carries NO field is not a valid update in this contract: it
// changes nothing, so the only thing it can produce is a misleading audit
// row ("something was updated" when nothing was). Every admin PATCH route
// rejects an empty body with a validation error — AFTER the permission check
// (an unauthorized caller must not learn whether the body would have been
// acceptable) and AFTER the schema validation (so the message stays precise).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail } from "@/lib/api/respond";

/** True when the request body is an object that carries no field at all. */
export function isEmptyPatchBody(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    !Array.isArray(body) &&
    Object.keys(body as Record<string, unknown>).length === 0
  );
}

/** The shared 400 response for an empty patch. */
export function emptyPatchResponse(): NextResponse {
  const r = fail(new ApiError("VALIDATION", "Empty patch: no field to update."));
  return NextResponse.json(r.body, { status: r.status });
}
