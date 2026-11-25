// @vitest-environment node
// ADM-09 — effective permission states.
//
// Source-level with an isolated Prisma mock: no database is touched. The test
// proves the state machine, not the live grants. The live grant state is
// reported separately as DB-GRANT-UNVERIFIED.
import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  permission: { findMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: dbMock }));

import { PERMISSION_GROUPS } from "@/lib/admin/terminology";
import {
  OWNER_APPROVAL_PERMISSIONS,
  actorCeilingMap,
  effectivePermissionsFor,
} from "../effective-permissions";

const ALL_KEYS = PERMISSION_GROUPS.flatMap((group) => group.permissions.map((permission) => permission.key));
const USER = "00000000-0000-4000-8000-000000000001";
const ROLE = "00000000-0000-4000-8000-000000000010";

function role(name: string, isActive = true, deletedAt: Date | null = null, grants: Array<[string, boolean]> = []) {
  return {
    id: ROLE,
    name,
    isActive,
    deletedAt,
    rolePermissions: grants.map(([key, active]) => ({ permission: { key, isActive: active } })),
  };
}

function user(roles: ReturnType<typeof role>[]) {
  return {
    id: USER,
    name: "Synthetic Admin",
    email: "synthetic@example.invalid",
    isActive: true,
    userRoles: roles.map((item) => ({ role: item })),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  dbMock.permission.findMany.mockResolvedValue(ALL_KEYS.map((key) => ({ key })));
});

describe("ADM-09 — effective permissions report", () => {
  it("returns null for an unknown account", async () => {
    dbMock.user.findUnique.mockResolvedValue(null);
    expect(await effectivePermissionsFor(USER)).toBeNull();
    expect(dbMock.permission.findMany).not.toHaveBeenCalled();
  });

  it("never treats an inactive or deleted role as a grant source", async () => {
    dbMock.user.findUnique.mockResolvedValue(
      user([
        role("disabled", false, null, [["products.view", true]]),
        role("deleted", true, new Date("2026-01-01T00:00:00Z"), [["orders.view", true]]),
      ]),
    );
    const report = await effectivePermissionsFor(USER);
    expect(report).not.toBeNull();
    expect(report?.permissions.every((permission) => !permission.granted)).toBe(true);
    expect(report?.summary.grantedTotal).toBe(0);
    expect(report?.roles).toEqual([
      { id: ROLE, name: "disabled", isActive: false },
      { id: ROLE, name: "deleted", isActive: false },
    ]);
  });

  it("ignores an inactive permission row on an active role", async () => {
    dbMock.user.findUnique.mockResolvedValue(user([role("manager", true, null, [["products.view", false]])]));
    const report = await effectivePermissionsFor(USER);
    const productsView = report?.permissions.find((permission) => permission.key === "products.view");
    expect(productsView?.granted).toBe(false);
    expect(productsView?.source).toBeNull();
  });

  it("reports a real active grant with its source role", async () => {
    dbMock.user.findUnique.mockResolvedValue(user([role("manager", true, null, [["products.view", true]])]));
    const report = await effectivePermissionsFor(USER);
    const productsView = report?.permissions.find((permission) => permission.key === "products.view");
    expect(productsView).toMatchObject({
      granted: true,
      source: { roleId: ROLE, roleName: "manager" },
      dbState: "PRESENT",
      activation: "GRANTED",
    });
  });

  it("reports a granted key that is missing from the database as DB_MISSING, never GRANTED", async () => {
    dbMock.permission.findMany.mockResolvedValue([{ key: "products.view" }].filter((row) => row.key !== "orders.view"));
    dbMock.user.findUnique.mockResolvedValue(user([role("manager", true, null, [["orders.view", true]])]));
    const report = await effectivePermissionsFor(USER);
    const ordersView = report?.permissions.find((permission) => permission.key === "orders.view");
    expect(ordersView?.dbState).toBe("MISSING");
    expect(ordersView?.activation).toBe("DB_MISSING");
    expect(report?.summary.missingInDatabase).toBe(ALL_KEYS.length - 1);
  });

  it("keeps the owner-approval capabilities pending even when granted", async () => {
    dbMock.user.findUnique.mockResolvedValue(
      user([
        role("SUPER_ADMIN", true, null, [
          ["customers.anonymize", true],
          ["products.delete", true],
          ["products.view", true],
        ]),
      ]),
    );
    const report = await effectivePermissionsFor(USER);
    for (const key of OWNER_APPROVAL_PERMISSIONS) {
      const entry = report?.permissions.find((permission) => permission.key === key);
      expect(entry?.granted, key).toBe(true);
      expect(entry?.activation, key).toBe("PENDING_OWNER_APPROVAL");
    }
    expect(report?.summary.pendingOwnerApproval).toBe(OWNER_APPROVAL_PERMISSIONS.length);
    expect(report?.permissions.find((permission) => permission.key === "products.view")?.activation).toBe("GRANTED");
  });

  it("keeps a defined-but-not-granted sensitive capability NOT_GRANTED", async () => {
    dbMock.user.findUnique.mockResolvedValue(user([role("manager", true, null, [["products.view", true]])]));
    const report = await effectivePermissionsFor(USER);
    for (const key of ["customers.anonymize", "products.delete", "prices.view", "roles.manage"]) {
      expect(report?.permissions.find((permission) => permission.key === key)?.activation, key).toBe("NOT_GRANTED");
    }
  });

  it("reports the catalogue total and one row per catalogue key", async () => {
    dbMock.user.findUnique.mockResolvedValue(user([role("manager", true, null, [["products.view", true]])]));
    const report = await effectivePermissionsFor(USER);
    expect(report?.permissions).toHaveLength(ALL_KEYS.length);
    expect(report?.summary.catalogueTotal).toBe(ALL_KEYS.length);
    expect(report?.permissions.map((permission) => permission.key).sort()).toEqual(ALL_KEYS.slice().sort());
    for (const permission of report?.permissions ?? []) {
      expect(permission.description.length, permission.key).toBeGreaterThan(10);
      expect(permission.capability, permission.key).not.toBeNull();
    }
  });

  it("reports the actor ceiling as data, never as a grant", async () => {
    dbMock.user.findUnique.mockResolvedValue(user([role("manager", true, null, [["products.view", true]])]));
    const report = await effectivePermissionsFor(USER, ["products.view", "orders.view"]);
    expect(report?.permissions.find((permission) => permission.key === "products.view")).toMatchObject({
      granted: true,
      allowedHere: true,
    });
    expect(report?.permissions.find((permission) => permission.key === "orders.view")).toMatchObject({
      granted: false,
      allowedHere: true,
    });
    expect(report?.permissions.find((permission) => permission.key === "roles.manage")?.allowedHere).toBe(false);
    expect(report?.summary.allowedHereTotal).toBe(2);
  });

  it("reports the actor ceiling map independently of the target account", () => {
    const ceiling = actorCeilingMap(["products.view", "orders.view", "not.a.key"]);
    expect(ceiling["products.view"]).toBe(true);
    expect(ceiling["orders.view"]).toBe(true);
    expect(ceiling["roles.manage"]).toBe(false);
    expect(ceiling["not.a.key"]).toBeUndefined();
    expect(Object.keys(ceiling).sort()).toEqual(ALL_KEYS.slice().sort());
  });
});
