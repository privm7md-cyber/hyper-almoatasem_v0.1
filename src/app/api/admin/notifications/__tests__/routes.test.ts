// @vitest-environment node
// ADM-11 — notification API contracts (isolated mocks, no database).
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  gate: vi.fn(),
  list: vi.fn(),
  count: vi.fn(),
  markOne: vi.fn(),
  markAll: vi.fn(),
}));
vi.mock("@/lib/api/route-auth", () => ({ adminSessionOrDeny: mocks.gate }));
vi.mock("@/lib/admin/notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin/notifications")>();
  return {
    ...actual,
    listOwnNotifications: mocks.list,
    countOwnUnreadNotifications: mocks.count,
    markOwnNotificationRead: mocks.markOne,
    markAllOwnNotificationsRead: mocks.markAll,
  };
});

import { GET as listRoute } from "../route";
import { POST as readOneRoute } from "../[id]/read/route";
import { POST as readAllRoute } from "../read-all/route";
import { GET as countRoute } from "../unread-count/route";

const admin = { user: { id: "00000000-0000-4000-8000-000000000001", name: "Synthetic", email: "s@example.invalid" }, roles: [], permissions: [] };
const ID = "00000000-0000-4000-8000-000000000002";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.gate.mockResolvedValue({ admin });
});

describe("ADM-11 — notification routes", () => {
  it("lists only through the session-scoped reader and validates the type", async () => {
    mocks.list.mockResolvedValue({ rows: [], nextCursor: null, invalidCursor: false });
    mocks.count.mockResolvedValue(4);

    const response = await listRoute(new Request(`http://localhost/api/admin/notifications?unread=true&type=security.role_changed&cursor=${ID}`));
    expect(response.status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith(admin, ID, true, "security.role_changed");
    expect(mocks.count).toHaveBeenCalledWith(admin);
    await expect(response.json()).resolves.toMatchObject({ data: { unreadCount: 4, rows: [] } });
  });

  it("rejects an unknown type before reading anything", async () => {
    const response = await listRoute(new Request("http://localhost/api/admin/notifications?type=security.anything"));
    expect(response.status).toBe(400);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.count).not.toHaveBeenCalled();
  });

  it("returns the authentication denial unchanged for the list", async () => {
    const denied = new Response(JSON.stringify({ error: { code: "UNAUTHENTICATED" } }), { status: 401 });
    mocks.gate.mockResolvedValue({ denied });
    expect(await listRoute(new Request("http://localhost/api/admin/notifications"))).toBe(denied);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("marks one owned notification and reports an idempotent already-read row", async () => {
    mocks.markOne.mockResolvedValue("updated");
    const updated = await readOneRoute(new Request("http://localhost/api/admin/x", { method: "POST" }), { params: Promise.resolve({ id: ID }) });
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({ data: { updated: true, read: true } });
    expect(mocks.markOne).toHaveBeenCalledWith(admin, ID);

    mocks.markOne.mockResolvedValue("already-read");
    const already = await readOneRoute(new Request("http://localhost/api/admin/x", { method: "POST" }), { params: Promise.resolve({ id: ID }) });
    await expect(already.json()).resolves.toMatchObject({ data: { updated: false, read: true } });
  });

  it("answers missing and foreign ids with the same 404", async () => {
    mocks.markOne.mockResolvedValue("missing");
    const response = await readOneRoute(new Request("http://localhost/api/admin/x", { method: "POST" }), { params: Promise.resolve({ id: ID }) });
    expect(response.status).toBe(404);
    expect(JSON.stringify(await response.json())).not.toContain("foreign");
  });

  it("rejects a malformed id before the write", async () => {
    const response = await readOneRoute(new Request("http://localhost/api/admin/x", { method: "POST" }), { params: Promise.resolve({ id: "not-a-uuid" }) });
    expect(response.status).toBe(400);
    expect(mocks.markOne).not.toHaveBeenCalled();
  });

  it("marks all unread rows for the session account and returns the changed count", async () => {
    mocks.markAll.mockResolvedValue(6);
    const response = await readAllRoute();
    expect(response.status).toBe(200);
    expect(mocks.markAll).toHaveBeenCalledWith(admin);
    await expect(response.json()).resolves.toMatchObject({ data: { updated: 6 } });
  });

  it("returns the own unread count", async () => {
    mocks.count.mockResolvedValue(9);
    const response = await countRoute();
    expect(response.status).toBe(200);
    expect(mocks.count).toHaveBeenCalledWith(admin);
    await expect(response.json()).resolves.toMatchObject({ data: { unreadCount: 9 } });
  });

  it("uses null (a mutation) as the preview token on both writes and notifications.view on reads", async () => {
    mocks.markAll.mockResolvedValue(0);
    await readAllRoute();
    expect(mocks.gate).toHaveBeenLastCalledWith(null);
    mocks.count.mockResolvedValue(0);
    await countRoute();
    expect(mocks.gate).toHaveBeenLastCalledWith("notifications.view");
  });
});
