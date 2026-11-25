// @vitest-environment node
// ADM-OWNER — the anonymization route's RBAC matrix (owner decision, 12 Nov
// 2026): hiding a customer's identity needs `customers.anonymize`; holding
// `customers.manage` NEVER implies it.
// P12-08 D01 (18 Nov 2026): also verifies the default-disabled H2 activation
// boundary (`CUSTOMER_AUDIT_REDACTION_MODE !== "H2"`) and the opt-in H2 200/202
// POST/GET contract.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  permission: vi.fn(),
  headers: vi.fn(),
  anonymize: vi.fn(),
  status: vi.fn(),
}));

vi.mock("@/lib/auth/rbac", () => ({
  checkPermission: m.permission,
  adminOrDeny: async (permission: string) => {
    const auth = await m.permission(permission);
    if (auth.ok === false) return { denied: new Response("denied", { status: auth.code === "UNAUTHENTICATED" ? 401 : 403 }) };
    return { admin: auth.admin };
  },
}));
vi.mock("next/headers", () => ({ headers: m.headers }));
vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get() { throw new Error("Unexpected real DB access"); } }) }));
vi.mock("@/lib/api/log-events", () => ({ logOperationalEvent: vi.fn() }));
vi.mock("@/lib/customers/anonymize", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  anonymizeCustomer: m.anonymize,
  getCustomerAnonymizeStatus: m.status,
}));

import { ApiError } from "@/lib/api/errors";
import { GET, POST } from "@/app/api/admin/customers/[id]/anonymize/route";

const ID = "00000000-0000-4000-8000-000000000001";
const SESSION_ID = "00000000-0000-4000-8000-0000000000bb";
const TOKEN = "2026-11-12T10:00:00.000Z";
const body = { confirmed: true, reason: "طلب من صاحب المتجر", expectedUpdatedAt: TOKEN };
const context = { params: Promise.resolve({ id: ID }) };

function request(value: unknown = body) {
  return new Request("http://localhost:3000/api/admin/customers/x/anonymize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
}

function getRequest() {
  return new Request("http://localhost:3000/api/admin/customers/x/anonymize", { method: "GET" });
}

beforeEach(() => {
  vi.resetAllMocks();
  delete process.env.CUSTOMER_AUDIT_REDACTION_MODE;
  m.headers.mockResolvedValue(new Headers({ host: "localhost:3000", origin: "http://localhost:3000" }));
  m.permission.mockResolvedValue({
    ok: true,
    admin: { user: { id: "actor", name: "n", email: "e" }, roles: [], permissions: ["customers.anonymize"] },
  });
  m.anonymize.mockResolvedValue({ anonymized: true, outcome: "COMPLETED" });
  m.status.mockResolvedValue({ state: "COMPLETED", customerId: ID, anonymized: true, result: null });
});

afterEach(() => {
  delete process.env.CUSTOMER_AUDIT_REDACTION_MODE;
});

describe("G6 — the anonymization RBAC matrix (default-disabled H2)", () => {
  it("requires `customers.anonymize` — not `customers.manage`", async () => {
    const response = await POST(request(), context);
    expect(response.status).toBe(200);
    expect(m.permission).toHaveBeenCalledWith("customers.anonymize");
    expect(m.permission).not.toHaveBeenCalledWith("customers.manage");
    expect(m.anonymize).toHaveBeenCalledWith(ID, body, "actor");
  });

  it.each([
    ["customers.view only", ["customers.view"]],
    ["customers.manage only", ["customers.manage"]],
    ["both previous capabilities without customers.anonymize", ["customers.view", "customers.manage"]],
  ])("%s is refused", async (_label, permissions) => {
    m.permission.mockResolvedValue({
      ok: false,
      code: "FORBIDDEN",
      admin: { user: { id: "actor", name: "n", email: "e" }, roles: [], permissions },
    });
    const response = await POST(request(), context);
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("FORBIDDEN");
    expect(m.anonymize).not.toHaveBeenCalled();
  });

  it("an unauthenticated call is refused before the body is read", async () => {
    m.permission.mockResolvedValue({ ok: false, code: "UNAUTHENTICATED" });
    const req = request();
    const json = vi.spyOn(req, "json");
    const forbiddenContext = { get params(): Promise<{ id: string }> { throw new Error("Params touched before permission"); } };
    const response = await POST(req, forbiddenContext);
    expect(response.status).toBe(401);
    expect(json).not.toHaveBeenCalled();
    expect(m.anonymize).not.toHaveBeenCalled();
  });

  it("an invalid id or body never reaches the service", async () => {
    expect((await POST(request(), { params: Promise.resolve({ id: "nope" }) })).status).toBe(400);
    expect((await POST(request({ ...body, confirmed: false }), context)).status).toBe(400);
    expect((await POST(request({ ...body, reason: " " }), context)).status).toBe(400);
    expect((await POST(request({ ...body, reason: "leak@example.test" }), context)).status).toBe(400);
    expect(m.anonymize).not.toHaveBeenCalled();
  });

  it("a refusal from the service keeps the Arabic reason and the 422 status", async () => {
    const { ApiError } = await import("@/lib/api/errors");
    m.anonymize.mockRejectedValue(
      new ApiError("BUSINESS_RULE", "مفيش إخفاء هوية دلوقتي: فيه 1 طلب لسه مفتوح (HM-1)."),
    );
    const response = await POST(request(), context);
    expect(response.status).toBe(422);
    expect((await response.json()).error.message).toContain("طلب لسه مفتوح");
  });
});

describe("P12-08 D01 H2 — default-disabled boundary & opt-in 200/202 contract", () => {
  it("when H2 is disabled by default, GET enforces RBAC first (401/403) and returns 404 inactive without querying H2 status", async () => {
    m.permission.mockResolvedValueOnce({ ok: false, code: "UNAUTHENTICATED" });
    expect((await GET(getRequest(), context)).status).toBe(401);

    m.permission.mockResolvedValueOnce({ ok: false, code: "FORBIDDEN" });
    expect((await GET(getRequest(), context)).status).toBe(403);

    const inactiveRes = await GET(getRequest(), context);
    expect(inactiveRes.status).toBe(404);
    expect((await inactiveRes.json()).error.code).toBe("NOT_FOUND");
    expect(m.status).not.toHaveBeenCalled();
  });

  it("when CUSTOMER_AUDIT_REDACTION_MODE=H2, POST requires sessionId and returns 202 for PENDING/FAILED and 200 for COMPLETED", async () => {
    process.env.CUSTOMER_AUDIT_REDACTION_MODE = "H2";

    // Missing sessionId -> 401 fail closed
    const missingSessRes = await POST(request(), context);
    expect(missingSessRes.status).toBe(401);
    expect(m.anonymize).not.toHaveBeenCalled();

    m.permission.mockResolvedValue({
      ok: true,
      admin: {
        user: { id: "actor", name: "n", email: "e" },
        sessionId: SESSION_ID,
        roles: [],
        permissions: ["customers.anonymize"],
      },
    });

    m.anonymize.mockResolvedValueOnce({
      anonymized: false,
      outcome: "PENDING_AUDIT_REDACTION",
      auditRedactionPending: true,
    });
    const pendingRes = await POST(request(), context);
    expect(pendingRes.status).toBe(202);
    expect(m.anonymize).toHaveBeenCalledWith(ID, body, "actor", SESSION_ID);
    expect((await pendingRes.json()).data.anonymized).toBe(false);

    m.anonymize.mockResolvedValueOnce({
      anonymized: false,
      outcome: "FAILED",
      lastErrorCode: "WORKER_EXECUTION_ERROR",
    });
    const failedRes = await POST(request(), context);
    expect(failedRes.status).toBe(202);
    expect((await failedRes.json()).data.outcome).toBe("FAILED");

    m.anonymize.mockResolvedValueOnce({ anonymized: true, outcome: "COMPLETED_WITH_LEGAL_REVIEW" });
    expect((await POST(request(), context)).status).toBe(200);
  });

  it("when CUSTOMER_AUDIT_REDACTION_MODE=H2, GET enforces customers.anonymize and returns 202 on PENDING/FAILED and 200 on COMPLETED", async () => {
    process.env.CUSTOMER_AUDIT_REDACTION_MODE = "H2";

    m.status.mockResolvedValueOnce({
      state: "PENDING_AUDIT_REDACTION",
      customerId: ID,
      anonymized: false,
      result: { anonymized: false, outcome: "PENDING_AUDIT_REDACTION" },
    });
    expect((await GET(getRequest(), context)).status).toBe(202);

    m.status.mockResolvedValueOnce({
      state: "FAILED",
      customerId: ID,
      anonymized: false,
      result: { anonymized: false, outcome: "FAILED" },
    });
    expect((await GET(getRequest(), context)).status).toBe(202);

    m.status.mockResolvedValueOnce({
      state: "COMPLETED",
      customerId: ID,
      anonymized: true,
      result: { anonymized: true, outcome: "COMPLETED_WITH_LEGAL_REVIEW" },
    });
    expect((await GET(getRequest(), context)).status).toBe(200);
  });

  it("returns 422 BUSINESS_RULE with AUDIT_REDACTION_MIGRATION_REQUIRED and anonymized=false on unmigrated historical-PII failure", async () => {
    m.anonymize.mockRejectedValueOnce(
      new ApiError("BUSINESS_RULE", "H2 migration required", {
        reasonCode: "AUDIT_REDACTION_MIGRATION_REQUIRED",
        anonymized: false,
      }),
    );
    const res = await POST(request(body), context);
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error.code).toBe("BUSINESS_RULE");
    expect(json.error.details).toEqual({
      reasonCode: "AUDIT_REDACTION_MIGRATION_REQUIRED",
      anonymized: false,
    });
  });
});
