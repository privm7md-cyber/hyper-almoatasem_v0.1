// @vitest-environment node
// Direct handlers with mocked auth/domain/DB. No HTTP requests or live sessions.
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ auth: vi.fn(), full: vi.fn(), cancel: vi.fn(), rotate: vi.fn(), audit: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/auth/rbac", () => ({ checkPermission: m.auth }));
vi.mock("@/lib/db", () => ({ prisma: { $transaction: m.transaction } }));
vi.mock("@/lib/orders/queries", () => ({ getOrderFull: m.full }));
vi.mock("@/lib/orders/writes", () => ({ cancelOrder: m.cancel }));
vi.mock("@/lib/orders/serialize", () => ({ toOrder: () => ({ status: "CANCELLED" }) }));
vi.mock("@/lib/orders/guest-access", () => ({ rotateGuestOrderCredential: m.rotate }));
vi.mock("@/lib/api/audit", () => ({ auditInTx: m.audit }));
vi.mock("@/lib/api/log-events", () => ({ logOperationalEvent: vi.fn() }));
import { POST as cancel } from "@/app/api/admin/orders/[id]/cancel/route";
import { POST as rotate } from "@/app/api/admin/orders/[id]/credential/rotate/route";
const id = "00000000-0000-4000-8000-000000000001";
const actorId = "00000000-0000-4000-8000-000000000002";
const context = { params: Promise.resolve({ id }) };
const request = (body: unknown) => new Request("http://localhost/api/admin/orders/isolated", { method: "POST", body: JSON.stringify(body) });
const tx = Object.freeze({ mockedTransaction: true });
beforeEach(() => {
  vi.resetAllMocks();
  m.auth.mockResolvedValue({ ok: true, admin: { user: { id: actorId }, permissions: ["orders.cancel", "orders.update"] } });
  m.full.mockResolvedValue({ id, customerId: null });
  m.cancel.mockResolvedValue(id);
  m.transaction.mockImplementation(async (callback) => callback(tx));
  m.rotate.mockResolvedValue({ token: "SECRET_GUEST_CREDENTIAL_NEVER_EXPOSE" });
  m.audit.mockResolvedValue(undefined);
});

describe("ADM05 admin handler boundaries", () => {
  it.each([{}, { reason: "x" }, { reason: "x", confirmed: false }, { reason: "  ", confirmed: true },
    { reason: "x".repeat(2001), confirmed: true }, { reason: "x", confirmed: true, actorId: "spoof" }])("cancel rejects invalid terms %j", async (body) => {
    expect((await cancel(request(body), context)).status).toBe(400);
    expect(m.auth).toHaveBeenCalledWith("orders.cancel");
    expect(m.cancel).not.toHaveBeenCalled();
    expect(m.full).not.toHaveBeenCalled();
  });
  it("cancel rejects malformed JSON", async () => {
    const response = await cancel(new Request("http://localhost", { method: "POST", body: "{" }), context);
    expect(response.status).toBe(400);
    expect(m.cancel).not.toHaveBeenCalled();
  });
  it("only server actor and normalized reason reach the cancel transaction", async () => {
    expect((await cancel(request({ reason: "  Customer requested  ", confirmed: true }), context)).status).toBe(200);
    expect(m.cancel).toHaveBeenCalledExactlyOnceWith({ orderId: id, actorType: "STAFF", actorId, reason: "Customer requested" });
  });
  it.each([cancel, rotate])("invalid UUID never reaches domain reads/writes", async (handler) => {
    expect((await handler(request({}), { params: Promise.resolve({ id: "bad" }) })).status).toBe(400);
    expect(m.full).not.toHaveBeenCalled();
    expect(m.cancel).not.toHaveBeenCalled();
    expect(m.transaction).not.toHaveBeenCalled();
  });
  it.each([cancel, rotate])("denies before reading params/body or calling domain", async (handler) => {
    m.auth.mockResolvedValue({ ok: false, code: "FORBIDDEN" });
    expect((await handler(request({}), context)).status).toBe(403);
    expect(m.full).not.toHaveBeenCalled();
    expect(m.cancel).not.toHaveBeenCalled();
    expect(m.transaction).not.toHaveBeenCalled();
  });
  it("rotation retains transaction+audit but returns only nonsecret acknowledgement", async () => {
    const response = await rotate(request({}), context);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toMatch(/SECRET_GUEST|guestOrderToken|token/i);
    expect(JSON.parse(text).data).toEqual({ credential: "rotated" });
    expect(m.auth).toHaveBeenCalledWith("orders.update");
    expect(m.rotate).toHaveBeenCalledExactlyOnceWith(tx, id);
    expect(m.audit).toHaveBeenCalledExactlyOnceWith(tx, expect.objectContaining({ action: "orders.credential_rotate", newValues: { credential: "rotated" } }));
  });
  it("registered order cannot rotate guest credentials", async () => {
    m.full.mockResolvedValue({ id, customerId: actorId });
    expect((await rotate(request({}), context)).status).toBe(404);
    expect(m.transaction).not.toHaveBeenCalled();
  });
});
