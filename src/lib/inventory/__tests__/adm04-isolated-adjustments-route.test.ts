// @vitest-environment node
// Native Request/Response with real route/auth orchestration and mocked identity,
// preview configuration and service. No HTTP server, session, login or database.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";

const m = vi.hoisted(() => ({
  permission: vi.fn(), headers: vi.fn(), adjust: vi.fn(), db: vi.fn(),
  previewConfigured: vi.fn(), previewPermission: vi.fn(), previewRead: vi.fn(),
}));
vi.mock("@/lib/auth/rbac", () => ({ checkPermission: m.permission }));
vi.mock("next/headers", () => ({ headers: m.headers }));
vi.mock("@/lib/auth/admin-read-only-preview", () => ({
  isAdminReadOnlyPreviewConfigured: m.previewConfigured,
  isAdminPreviewPermissionAllowed: m.previewPermission,
}));
vi.mock("@/lib/auth/admin-preview-request", () => ({ isAdminPreviewReadRequestAllowed: m.previewRead }));
vi.mock("@/lib/inventory/service", () => ({ adjustStock: m.adjust }));
vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, {
  get(_target, key) { m.db(String(key)); throw new Error("Unexpected database access"); },
}) }));
vi.mock("@/lib/api/log-events", () => ({ logOperationalEvent: vi.fn() }));
import { POST } from "@/app/api/admin/inventory/adjustments/route";

const VARIANT = "abcdefab-1234-4000-8000-000000000001";
const REQUEST = "abcdefab-1234-4000-8000-000000000002";
const ACTOR = "abcdefab-1234-4000-8000-000000000003";
const body = {
  productVariantId: VARIANT, requestId: REQUEST, expectedQuantity: "10.000",
  delta: "2.000", movementType: "ADJUSTMENT", reason: "Stock count", confirmed: true,
};
const output = {
  movementId: "abcdefab-1234-4000-8000-000000000004", previousQuantity: "10.000", newQuantity: "12.000",
};
function request(value: unknown = body) {
  return new Request("http://localhost:3000/api/admin/inventory/adjustments", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  m.previewConfigured.mockReturnValue(false);
  m.previewPermission.mockReturnValue(false);
  m.headers.mockResolvedValue(new Headers({ host: "localhost:3000", origin: "http://localhost:3000" }));
  m.permission.mockResolvedValue({
    ok: true, admin: { user: { id: ACTOR, name: "Private name", email: "private@example.test" }, roles: [], permissions: ["inventory.adjust"] },
  });
  m.adjust.mockResolvedValue(output);
});
afterEach(() => { expect(m.db).not.toHaveBeenCalled(); });

describe("ADM04 adjustments route permission boundary", () => {
  it("requires inventory.adjust and uses the authenticated actor with normalized terms", async () => {
    const response = await POST(request({
      ...body, productVariantId: VARIANT.toUpperCase(), requestId: REQUEST.toUpperCase(), reason: "  Stock count  ",
    }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ data: output, meta: {} });
    expect(m.permission).toHaveBeenCalledExactlyOnceWith("inventory.adjust");
    expect(m.adjust).toHaveBeenCalledExactlyOnceWith({
      variantId: VARIANT, delta: "2.000", movementType: "ADJUSTMENT",
      referenceType: "MANUAL", referenceId: REQUEST, reason: "Stock count", actorId: ACTOR,
    }, { requestId: REQUEST, expectedQuantity: "10.000", confirmed: true });
    expect(m.permission.mock.invocationCallOrder[0]).toBeLessThan(m.adjust.mock.invocationCallOrder[0]);
  });

  it.each([["UNAUTHENTICATED", 401], ["FORBIDDEN", 403]] as const)("%s denies before parsing JSON or calling service", async (code, status) => {
    m.permission.mockResolvedValue({ ok: false, code });
    const req = request({ invalid: true });
    const json = vi.spyOn(req, "json");
    const response = await POST(req);
    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(code);
    expect(m.permission).toHaveBeenCalledWith("inventory.adjust");
    expect(json).not.toHaveBeenCalled();
    expect(m.adjust).not.toHaveBeenCalled();
  });

  it("preview veto precedes headers, authentication, body and service even with bypass-looking input", async () => {
    m.previewConfigured.mockReturnValue(true);
    const req = new Request("http://localhost:3000/api/admin/inventory/adjustments?ADMIN_READ_ONLY_PREVIEW=0", {
      method: "POST", headers: { purpose: "prefetch", "admin-read-only-preview": "0" }, body: "{",
    });
    const json = vi.spyOn(req, "json");
    const response = await POST(req);
    expect(response.status).toBe(403);
    expect((await response.json()).error).toMatchObject({ code: "FORBIDDEN", message: "Admin read-only preview." });
    // Array.every supplies index/array too; the capability is its first argument.
    expect(m.previewPermission.mock.calls.map(call => call[0])).toEqual(["inventory.adjust"]);
    for (const fn of [m.headers, m.permission, m.previewRead, json, m.adjust]) expect(fn).not.toHaveBeenCalled();
  });

  it("rejects a foreign origin before authentication, JSON and service", async () => {
    m.headers.mockResolvedValue(new Headers({ host: "localhost:3000", origin: "https://foreign.invalid" }));
    const req = request();
    const json = vi.spyOn(req, "json");
    const response = await POST(req);
    expect(response.status).toBe(403);
    expect(m.permission).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
    expect(m.adjust).not.toHaveBeenCalled();
  });
});

describe("ADM04 adjustments route values and outcomes", () => {
  it.each([
    null, [], {}, { ...body, reason: " " }, { ...body, reason: undefined },
    { ...body, confirmed: false }, { ...body, confirmed: undefined },
    { ...body, expectedQuantity: undefined }, { ...body, expectedQuantity: "1000000000" },
    { ...body, requestId: undefined }, { ...body, requestId: "not-a-uuid" },
    { ...body, productVariantId: "not-a-uuid" }, { ...body, delta: "0" },
    { ...body, delta: "0.0001" }, { ...body, delta: "-1000000000" }, { ...body, delta: 2 },
    { ...body, movementType: "SALE" }, { ...body, actorId: "spoof" },
    { ...body, referenceType: "ORDER" }, { ...body, referenceId: REQUEST },
  ])("rejects invalid/unknown body fields before service: %j", async (value) => {
    const response = await POST(request(value));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("VALIDATION");
    expect(m.adjust).not.toHaveBeenCalled();
  });

  it("malformed JSON becomes a validation envelope", async () => {
    const response = await POST(new Request("http://localhost:3000/api/admin/inventory/adjustments", { method: "POST", body: "{" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "VALIDATION", message: "Invalid request body.", details: null } });
    expect(m.adjust).not.toHaveBeenCalled();
  });

  it.each([["NOT_FOUND", 404], ["CONFLICT", 409], ["BUSINESS_RULE", 422], ["FORBIDDEN", 403]] as const)(
    "preserves service %s as HTTP %s", async (code, status) => {
      m.adjust.mockRejectedValue(new ApiError(code, "Safe fixed message."));
      const response = await POST(request());
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: { code, message: "Safe fixed message.", details: null } });
    },
  );

  it("returns the durable replay outcome without rereading current inventory", async () => {
    const first = await POST(request());
    const replay = await POST(request());
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual(await first.json());
    expect(m.adjust).toHaveBeenCalledTimes(2);
  });

  it("unexpected service failures cannot expose SQL, stack or private values", async () => {
    m.adjust.mockRejectedValue(new Error("private SQL actor@example.test"));
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "INTERNAL", message: "Unexpected error.", details: null } });
  });
});
