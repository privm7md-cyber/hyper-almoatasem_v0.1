// A5 / D9 — the AUTO_ACCEPTED path is staff-triggered, guarded and NEVER a 500.
//
// The contract:
//   * only a staff member holding `orders.update` may trigger it;
//   * an unsatisfied pre-consent condition is a BUSINESS RULE outcome
//     (422) — not an unhandled failure (500);
//   * the frontend can never trigger it: the decision source is recorded in
//     the audit trail as SYSTEM, and the only entry point is this staff
//     route;
//   * a genuine internal failure still surfaces as 500 with NO details.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const checkPermission = vi.fn();
const autoAcceptReplacement = vi.fn();
const getReplacement = vi.fn();

vi.mock("@/lib/auth/rbac", () => ({ checkPermission: (...a: unknown[]) => checkPermission(...a) }));
vi.mock("@/lib/replacements/writes", () => ({
  autoAcceptReplacement: (...a: unknown[]) => autoAcceptReplacement(...a),
}));
vi.mock("@/lib/replacements/queries", () => ({
  getReplacement: (...a: unknown[]) => getReplacement(...a),
}));
vi.mock("@/lib/replacements/serialize", () => ({ toReplacement: (r: unknown) => r }));

import { POST } from "@/app/api/admin/replacements/[id]/auto-accept/route";

const ID = "11111111-1111-4111-8111-111111111111";
const context = { params: Promise.resolve({ id: ID }) };

function request(): Request {
  return new Request(`https://example.test/api/admin/replacements/${ID}/auto-accept`, {
    method: "POST",
  });
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("A5 — auto-accept is a guarded staff path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuses an unauthenticated caller with 401", async () => {
    checkPermission.mockResolvedValue({ ok: false, code: "UNAUTHENTICATED" });
    const res = await POST(request(), context);
    expect(res.status).toBe(401);
    expect((await bodyOf(res)).error).toMatchObject({ code: "UNAUTHENTICATED" });
    expect(autoAcceptReplacement).not.toHaveBeenCalled();
  });

  it("refuses a caller without the permission with 403", async () => {
    checkPermission.mockResolvedValue({ ok: false, code: "FORBIDDEN" });
    const res = await POST(request(), context);
    expect(res.status).toBe(403);
    expect((await bodyOf(res)).error).toMatchObject({ code: "FORBIDDEN" });
    expect(autoAcceptReplacement).not.toHaveBeenCalled();
  });

  it("demands the orders.update permission", async () => {
    checkPermission.mockResolvedValue({ ok: false, code: "FORBIDDEN" });
    await POST(request(), context);
    expect(checkPermission).toHaveBeenCalledWith("orders.update");
  });

  it("rejects an invalid replacement id before touching the domain", async () => {
    checkPermission.mockResolvedValue({ ok: true, admin: { user: { id: ID } } });
    const res = await POST(request(), { params: Promise.resolve({ id: "not-a-uuid" }) });
    expect(res.status).toBe(400);
    expect(autoAcceptReplacement).not.toHaveBeenCalled();
  });

  it("returns 422 — not 500 — when the pre-consent condition is not met", async () => {
    checkPermission.mockResolvedValue({ ok: true, admin: { user: { id: ID } } });
    autoAcceptReplacement.mockRejectedValue(
      new (await import("@/lib/api/errors")).ApiError(
        "BUSINESS_RULE",
        "Pre-consent does not cover this replacement.",
        null,
      ),
    );
    const res = await POST(request(), context);
    expect(res.status).toBe(422);
    expect((await bodyOf(res)).error).toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("still surfaces a genuine internal failure as 500 with no details", async () => {
    checkPermission.mockResolvedValue({ ok: true, admin: { user: { id: ID } } });
    autoAcceptReplacement.mockRejectedValue(new Error("connection string postgres://user:pw@host/db"));
    const res = await POST(request(), context);
    expect(res.status).toBe(500);
    const body = await bodyOf(res);
    expect(body.error).toMatchObject({ code: "INTERNAL" });
    expect((body.error as { details: unknown }).details).toBeNull();
    expect(JSON.stringify(body)).not.toContain("postgres://");
  });

  it("records the executing admin as the decider when it succeeds", async () => {
    const adminId = "22222222-2222-4222-8222-222222222222";
    checkPermission.mockResolvedValue({ ok: true, admin: { user: { id: adminId } } });
    autoAcceptReplacement.mockResolvedValue(ID);
    getReplacement.mockResolvedValue({ id: ID, status: "AUTO_ACCEPTED" });
    const res = await POST(request(), context);
    expect(res.status).toBe(200);
    expect(autoAcceptReplacement).toHaveBeenCalledWith({
      replacementId: ID,
      executorAdminId: adminId,
    });
  });
});
