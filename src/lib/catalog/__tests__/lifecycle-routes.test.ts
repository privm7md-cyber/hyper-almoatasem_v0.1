// @vitest-environment node
// Real route guards with mocked identity; no login, session or real network.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";
const m = vi.hoisted(() => ({ permission: vi.fn(), headers: vi.fn(), transition: vi.fn(), eligibility: vi.fn(), hardDelete: vi.fn() }));
vi.mock("@/lib/auth/rbac", () => ({ checkPermission: m.permission }));
vi.mock("next/headers", () => ({ headers: m.headers }));
vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get() { throw new Error("Unexpected real DB access"); } }) }));
vi.mock("@/lib/api/log-events", () => ({ logOperationalEvent: vi.fn() }));
vi.mock("@/lib/catalog/lifecycle", async (importOriginal) => ({ ...await importOriginal<object>(), transitionProduct: m.transition, getProductDeletionEligibility: m.eligibility }));
vi.mock("@/lib/catalog/hard-delete", async (importOriginal) => ({ ...await importOriginal<object>(), hardDeleteProduct: m.hardDelete }));
import * as archive from "@/app/api/admin/catalog/products/[id]/archive/route";
import * as restore from "@/app/api/admin/catalog/products/[id]/restore/route";
import * as eligibility from "@/app/api/admin/catalog/products/[id]/deletion-eligibility/route";
import * as product from "@/app/api/admin/catalog/products/[id]/route";

const ID = "00000000-0000-4000-8000-000000000001";
const TOKEN = "2026-11-12T10:00:00.000Z";
const body = { confirmed: true, reason: "مراجعة", expectedUpdatedAt: TOKEN };
const context = { params: Promise.resolve({ id: ID }) };
const result = { id: ID, deletedAt: TOKEN, isActive: false, updatedAt: TOKEN, alreadyApplied: false };
function request(value: unknown = body, ifMatch?: string) { return new Request("http://localhost:3000/api/admin/catalog/products/test/archive", { method: "POST", headers: { "Content-Type": "application/json", ...(ifMatch !== undefined ? { "If-Match": ifMatch } : {}) }, body: JSON.stringify(value) }); }

beforeEach(() => {
  vi.resetAllMocks();
  m.headers.mockResolvedValue(new Headers({ host: "localhost:3000", origin: "http://localhost:3000" }));
  m.permission.mockResolvedValue({ ok: true, admin: { user: { id: "authenticated-actor", name: "private", email: "private@example.test" }, roles: [], permissions: ["products.delete", "products.update"] } });
  m.transition.mockResolvedValue(result); m.eligibility.mockResolvedValue({ executable: false });
  m.hardDelete.mockResolvedValue({ deleted: true, productId: ID, productName: "منتج", variantsDeleted: 1, references: [] });
});

describe("lifecycle route capabilities and actor boundary", () => {
  it.each([["archive", archive.POST, "products.delete"], ["restore", restore.POST, "products.update"]] as const)("%s uses exact capability and authenticated actor", async (operation, handler, permission) => {
    const response = await handler(request(), context);
    expect(response.status).toBe(200); expect(response.headers.get("etag")).toBe(`"${TOKEN}"`); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(m.permission).toHaveBeenCalledWith(permission);
    expect(m.transition).toHaveBeenCalledWith(ID, operation, body, "authenticated-actor");
    expect(await response.json()).toEqual({ data: result, meta: {} });
  });
  it("eligibility uses products.delete before read, is read-only, and uncached", async () => {
    const response = await eligibility.GET(new Request("http://localhost:3000/test"), context);
    expect(m.permission).toHaveBeenCalledWith("products.delete"); expect(m.eligibility).toHaveBeenCalledWith(ID);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store"); expect(m.transition).not.toHaveBeenCalled();
  });
  for (const [label, handler, permission] of [["archive", archive.POST, "products.delete"], ["restore", restore.POST, "products.update"], ["eligibility", eligibility.GET, "products.delete"]] as const) {
    it.each(["UNAUTHENTICATED", "FORBIDDEN"] as const)(`${label} %s denies before body, params, reads and mutations`, async (code) => {
      m.permission.mockResolvedValue({ ok: false, code });
      const req = request(); const json = vi.spyOn(req, "json");
      const forbiddenContext = { get params(): Promise<{ id: string }> { throw new Error("Params touched before permission"); } };
      const response = await handler(req, forbiddenContext);
      expect(response.status).toBe(code === "UNAUTHENTICATED" ? 401 : 403); expect((await response.json()).error.code).toBe(code);
      expect(m.permission).toHaveBeenCalledWith(permission); expect(json).not.toHaveBeenCalled(); expect(m.transition).not.toHaveBeenCalled(); expect(m.eligibility).not.toHaveBeenCalled();
    });
  }
  it("foreign origin is denied before identity or effects", async () => {
    m.headers.mockResolvedValue(new Headers({ host: "localhost:3000", origin: "https://evil.invalid" }));
    expect((await archive.POST(request(), context)).status).toBe(403);
    expect(m.permission).not.toHaveBeenCalled(); expect(m.transition).not.toHaveBeenCalled();
  });
  it("only the product route exports the final DELETE (the archive/restore routes never do)", () => {
    for (const route of [archive, restore, eligibility]) expect(route).not.toHaveProperty("DELETE");
    expect(product).toHaveProperty("DELETE");
  });

  it("the final DELETE uses products.delete and the authenticated actor", async () => {
    const req = new Request("http://localhost:3000/api/admin/catalog/products/x", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const response = await product.DELETE(req, context);
    expect(response.status).toBe(200);
    expect(m.permission).toHaveBeenCalledWith("products.delete");
    expect(m.hardDelete).toHaveBeenCalledWith(ID, body, "authenticated-actor");
  });

  it.each(["UNAUTHENTICATED", "FORBIDDEN"] as const)("the final DELETE %s denies before body, params and effects", async (code) => {
    m.permission.mockResolvedValue({ ok: false, code });
    const req = new Request("http://localhost:3000/api/admin/catalog/products/x", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = vi.spyOn(req, "json");
    const forbiddenContext = { get params(): Promise<{ id: string }> { throw new Error("Params touched before permission"); } };
    const response = await product.DELETE(req, forbiddenContext);
    expect(response.status).toBe(code === "UNAUTHENTICATED" ? 401 : 403);
    expect(m.permission).toHaveBeenCalledWith("products.delete");
    expect(json).not.toHaveBeenCalled();
    expect(m.hardDelete).not.toHaveBeenCalled();
  });

  it("the final DELETE rejects an invalid body or id before the service", async () => {
    const bad = new Request("http://localhost:3000/api/admin/catalog/products/x", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, confirmed: false }),
    });
    expect((await product.DELETE(bad, context)).status).toBe(400);
    expect(m.hardDelete).not.toHaveBeenCalled();
    const req = new Request("http://localhost:3000/api/admin/catalog/products/x", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect((await product.DELETE(req, { params: Promise.resolve({ id: "invalid" }) })).status).toBe(400);
    expect(m.hardDelete).not.toHaveBeenCalled();
  });

  it("the final DELETE maps a refusal to 422 and keeps the Arabic reason", async () => {
    m.hardDelete.mockRejectedValue(new ApiError("BUSINESS_RULE", "الحذف النهائي مش مسموح: بنود طلبات سابقة (1)."));
    const req = new Request("http://localhost:3000/api/admin/catalog/products/x", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const response = await product.DELETE(req, context);
    expect(response.status).toBe(422);
    expect((await response.json()).error.message).toContain("بنود طلبات سابقة");
  });
});

describe("lifecycle route values, versions and safe errors", () => {
  it.each([archive.POST, restore.POST])("If-Match wins over body and is echoed as version metadata", async (handler) => {
    await handler(request({ ...body, expectedUpdatedAt: "2020-01-01T00:00:00.000Z" }, `"${TOKEN}"`), context);
    expect(m.transition.mock.calls[0][2].expectedUpdatedAt).toBe(TOKEN);
  });
  it("If-Match can supply a missing body token", async () => {
    expect((await archive.POST(request({ confirmed: true, reason: "سبب" }, TOKEN), context)).status).toBe(200);
    expect(m.transition.mock.calls[0][2].expectedUpdatedAt).toBe(TOKEN);
  });
  it.each(["*", "", "W/\"2026-11-12T10:00:00.000Z\"", "not-date", `"${TOKEN}", "${TOKEN}"`])("rejects invalid If-Match %s before mutation", async (header) => {
    expect((await archive.POST(request(body, header), context)).status).toBe(400); expect(m.transition).not.toHaveBeenCalled();
  });
  it.each([null, [], {}, { ...body, confirmed: false }, { ...body, reason: " " }, { ...body, actorId: "spoof" }, { ...body, isActive: true }, { confirmed: true, reason: "سبب" }])("invalid/unknown request values rejected", async (value) => {
    expect((await archive.POST(request(value), context)).status).toBe(400); expect(m.transition).not.toHaveBeenCalled();
  });
  it.each([archive.POST, restore.POST, eligibility.GET])("invalid id fails before service", async (handler) => {
    expect((await handler(request(), { params: Promise.resolve({ id: "invalid" }) })).status).toBe(400);
    expect(m.transition).not.toHaveBeenCalled(); expect(m.eligibility).not.toHaveBeenCalled();
  });
  it("invalid JSON is a validation error", async () => {
    const req = new Request("http://localhost/test", { method: "POST", body: "{" });
    expect((await restore.POST(req, context)).status).toBe(400); expect(m.transition).not.toHaveBeenCalled();
  });
  it.each([["NOT_FOUND", 404], ["CONFLICT", 409], ["BUSINESS_RULE", 422]] as const)("preserves %s status for writes and inspection", async (code, status) => {
    m.transition.mockRejectedValue(new ApiError(code, "Safe fixed message.")); m.eligibility.mockRejectedValue(new ApiError(code, "Safe fixed message."));
    expect((await archive.POST(request(), context)).status).toBe(status); expect((await eligibility.GET(request(), context)).status).toBe(status);
  });
  it("unexpected DB details are not returned", async () => {
    m.eligibility.mockRejectedValue(new Error("private SQL customer@example.test"));
    const response = await eligibility.GET(request(), context);
    expect(response.status).toBe(500); expect(await response.json()).toEqual({ error: { code: "INTERNAL", message: "Unexpected error.", details: null } });
  });
});
