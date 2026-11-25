// @vitest-environment node
// ADM-11 — notification write sites (isolated mock, no database).
import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
  user: { findMany: vi.fn() },
  notification: { createMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: dbMock }));

import { notifyAccountLocked, notifyRoleAccessChanged } from "../notification-events";

const ACTOR = "00000000-0000-4000-8000-000000000001";
const OWNER = "00000000-0000-4000-8000-000000000002";

beforeEach(() => {
  vi.resetAllMocks();
  dbMock.notification.createMany.mockResolvedValue({ count: 1 });
});

describe("ADM-11 — notification events target real owners only", () => {
  it("reads active, non-deleted SUPER_ADMIN holders and skips the actor", async () => {
    dbMock.user.findMany.mockResolvedValue([{ id: OWNER }]);
    await notifyRoleAccessChanged({ actorId: ACTOR, kind: "grant.add", roleName: "manager", target: "prices.view" });
    expect(dbMock.user.findMany).toHaveBeenCalledWith({
      where: {
        isActive: true,
        deletedAt: null,
        id: { not: ACTOR },
        userRoles: { some: { role: { name: "SUPER_ADMIN", isActive: true } } },
      },
      select: { id: true },
    });
    expect(dbMock.notification.createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: OWNER,
          type: "security.role_changed",
          title: "تغيير في صلاحيات الإدارة",
          message: expect.stringContaining("prices.view"),
          data: { kind: "grant.add", role: "manager", target: "prices.view" },
        },
      ],
    });
  });

  it("writes nothing when no owner remains (no hard-coded fallback recipient)", async () => {
    dbMock.user.findMany.mockResolvedValue([]);
    expect(await notifyRoleAccessChanged({ actorId: ACTOR, kind: "role.delete", roleName: "manager" })).toBe(0);
    expect(dbMock.notification.createMany).not.toHaveBeenCalled();
  });

  it("returns the number of real recipients written", async () => {
    dbMock.user.findMany.mockResolvedValue([{ id: OWNER }, { id: "00000000-0000-4000-8000-000000000003" }]);
    dbMock.notification.createMany.mockResolvedValue({ count: 2 });
    expect(await notifyAccountLocked({ userId: ACTOR, userName: "Synthetic Admin" })).toBe(2);
  });

  it("keeps the type inside the database CHECK pattern and every text non-empty", async () => {
    dbMock.user.findMany.mockResolvedValue([{ id: OWNER }]);
    await notifyAccountLocked({ userId: ACTOR, userName: "Synthetic Admin" });
    const [call] = dbMock.notification.createMany.mock.calls[0] as [{ data: Array<{ type: string; title: string; message: string }> }];
    for (const row of call.data) {
      expect(row.type).toMatch(/^[a-z0-9_.]+$/);
      expect(row.title.length).toBeGreaterThan(0);
      expect(row.title.length).toBeLessThanOrEqual(160);
      expect(row.message.length).toBeGreaterThan(0);
    }
  });

  it("does not put an email address in the lockout notification", async () => {
    dbMock.user.findMany.mockResolvedValue([{ id: OWNER }]);
    await notifyAccountLocked({ userId: ACTOR, userName: "Synthetic Admin" });
    const text = JSON.stringify(dbMock.notification.createMany.mock.calls[0][0]);
    expect(text).not.toContain("@");
    expect(text).toContain("Synthetic Admin");
  });

  it("does not notify a role change to a non-owner recipient set", async () => {
    dbMock.user.findMany.mockResolvedValue([]);
    await notifyRoleAccessChanged({ actorId: ACTOR, kind: "mapping.add", roleName: "manager", target: "user" });
    expect(dbMock.notification.createMany).not.toHaveBeenCalled();
  });
});
