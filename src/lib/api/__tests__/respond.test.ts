// Unit tests for the shared error envelope (R-04 remediation).
//
// The contract under test: an INTERNAL failure never echoes a caller payload
// back to the client, while validation/business errors keep their allowlisted
// details.
import { describe, expect, it } from "vitest";
import { ApiError, businessRule, conflict, normalizeError } from "@/lib/api/errors";
import { fail } from "@/lib/api/respond";

describe("fail()", () => {
  it("keeps allowlisted details on a business error", () => {
    const res = fail(businessRule("Bad weight.", { step: 125 }));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("BUSINESS_RULE");
    expect(res.body.error.details).toEqual({ step: 125 });
  });

  it("keeps allowlisted details on a conflict", () => {
    const res = fail(conflict("Race.", { reason: "DELIVERY_FEE_CHANGED" }));
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual({ reason: "DELIVERY_FEE_CHANGED" });
  });

  it("never echoes details on an INTERNAL failure", () => {
    const res = fail(new ApiError("INTERNAL", "Unexpected error.", { password: "leak" }, false));
    expect(res.status).toBe(500);
    expect(res.body.error.details).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain("leak");
  });

  it("never leaks the thrown message of an unknown error", () => {
    const res = fail(new Error("secret password_hash leak SELECT"));
    expect(res.status).toBe(500);
    expect(res.body.error.message).toBe("Unexpected error.");
    expect(JSON.stringify(res.body)).not.toContain("password_hash");
  });

  it("normalizes an unknown throw to a detail-free INTERNAL error", () => {
    const normalized = normalizeError(new Error("boom"));
    expect(normalized.code).toBe("INTERNAL");
    expect(normalized.details).toBeNull();
  });
});
