// @vitest-environment node
// Real preview/authorization gates; every data or session access throws.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ db: vi.fn(), session: vi.fn(), headers: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get(_target, key) { m.db(String(key)); throw new Error("Unexpected DB access"); } }) }));
vi.mock("next/headers", () => ({ headers: m.headers }));
vi.mock("@/lib/auth/session", () => ({ readSessionCookie: m.session, validateSessionToken: m.session }));
vi.mock("@/lib/api/log-events", () => ({ logOperationalEvent: vi.fn() }));

beforeAll(() => {
  vi.stubEnv("ADMIN_READ_ONLY_PREVIEW", "1"); vi.stubEnv("NODE_ENV", "development");
  m.headers.mockResolvedValue(new Headers({ host: "localhost:3000", purpose: "prefetch", "x-forwarded-host": "evil.invalid" }));
  vi.resetModules();
});
afterAll(() => vi.unstubAllEnvs());

const routes = [
  ["archive", "POST", () => import("@/app/api/admin/catalog/products/[id]/archive/route")],
  ["restore", "POST", () => import("@/app/api/admin/catalog/products/[id]/restore/route")],
  ["eligibility", "GET", () => import("@/app/api/admin/catalog/products/[id]/deletion-eligibility/route")],
  ["images register", "POST", () => import("@/app/api/admin/catalog/products/[id]/images/route")],
  ["images patch", "PATCH", () => import("@/app/api/admin/catalog/images/[id]/route")],
  ["images remove", "DELETE", () => import("@/app/api/admin/catalog/images/[id]/route")],
] as const;

describe("read-only preview before all lifecycle/media effects", () => {
  it.each(routes)("%s %s veto before params, body, session and DB (prefetch bypass)", async (_label, method, load) => {
    m.db.mockClear(); m.session.mockClear();
    const routeModule = await load();
    const handler = (routeModule as unknown as Record<string, (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>>)[method];
    const req = new Request("http://localhost:3000/api/admin/catalog/test?ADMIN_READ_ONLY_PREVIEW=0", { method, headers: { purpose: "prefetch", "admin-read-only-preview": "0" }, ...(method !== "GET" ? { body: "{}" } : {}) });
    const json = vi.spyOn(req, "json");
    const ctx = { get params(): Promise<{ id: string }> { throw new Error("Premature params access"); } };
    const response = await handler(req, ctx);
    expect(response.status).toBe(403); expect((await response.json()).error.code).toBe("FORBIDDEN");
    expect(json).not.toHaveBeenCalled(); expect(m.session).not.toHaveBeenCalled(); expect(m.db).not.toHaveBeenCalled();
  });
  it("core transition also rejects without HTTP scope before transaction access", async () => {
    const { transitionProduct } = await import("../lifecycle"); m.db.mockClear();
    await expect(transitionProduct("00000000-0000-4000-8000-000000000001", "archive", { confirmed: true, reason: "test", expectedUpdatedAt: "2026-11-12T00:00:00.000Z" }, "actor")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(m.db).not.toHaveBeenCalled(); expect(m.session).not.toHaveBeenCalled();
  });
});
