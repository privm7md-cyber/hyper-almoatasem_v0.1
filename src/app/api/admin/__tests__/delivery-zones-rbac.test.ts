// @vitest-environment node
// E-3 closure — delivery-zone & reporting RBAC proven on the BACKEND (never by
// hiding a button). Covers every required actor class:
//   • SUPER_ADMIN (all 33 seeded permissions)
//   • STORE_ADMIN (25 seeded permissions: holds delivery.view, delivery.assign,
//     reports.view; lacks settings.view and settings.manage)
//   • VIEWER (read-only role with and without delivery.view)
//   • Role without permission (zero grants)
//   • Unauthenticated caller
//   • Cross-origin direct API access
//   • Cross-role privilege escalation (grant ceiling on delivery.view,
//     delivery.assign, reports.view)
//
// Every Prisma / session effect is a mock: no database is touched.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userRead: vi.fn(),
  roleRead: vi.fn(),
  permRead: vi.fn(),
  grantCreate: vi.fn(),
  listZones: vi.fn(),
  createZone: vi.fn(),
  updateZone: vi.fn(),
  headers: vi.fn(async () => new Headers()),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: mocks.userRead },
    role: { findUnique: mocks.roleRead },
    permission: { findUnique: mocks.permRead },
    rolePermission: { create: mocks.grantCreate },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>) =>
      fn({ rolePermission: { create: mocks.grantCreate } }),
  },
}));
vi.mock("@/lib/auth/session", () => ({
  readSessionCookie: async () => "synthetic-admin-token",
  validateSessionToken: vi.fn(async () => ({ userId: "00000000-0000-4000-8000-0000000000aa" })),
}));
vi.mock("react", () => ({ cache: <T>(fn: T) => fn }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), forbidden: vi.fn() }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/lib/api/log-events", () => ({ logOperationalEvent: vi.fn() }));
vi.mock("@/lib/api/audit", () => ({ auditInTx: vi.fn() }));
vi.mock("@/lib/admin/notification-events", () => ({ notifyRoleAccessChanged: vi.fn(async () => {}) }));
vi.mock("@/lib/admin/delivery-zones", () => ({
  listDeliveryZones: mocks.listZones,
  createDeliveryZone: mocks.createZone,
  updateDeliveryZone: mocks.updateZone,
}));

import { GET as listRoute, POST as createRoute } from "@/app/api/admin/delivery-zones/route";
import { PATCH as updateRoute } from "@/app/api/admin/delivery-zones/[id]/route";
import { POST as grantRoute } from "@/app/api/admin/roles/[id]/grants/route";

const ACTOR = "00000000-0000-4000-8000-0000000000aa";
const ZONE = "00000000-0000-4000-8000-0000000000bb";
const TARGET_ROLE_ID = "00000000-0000-4000-8000-0000000000cc";
const NOW = new Date("2026-11-13T00:00:00.000Z");

const SUPER_ADMIN_PERMS = [
  "products.view", "products.create", "products.update", "products.archive", "products.delete",
  "categories.manage", "brands.manage", "prices.view", "prices.update", "costs.view", "costs.update",
  "inventory.view", "inventory.adjust", "orders.view", "orders.update_status", "orders.cancel",
  "replacements.offer", "replacements.resolve", "promotions.view", "promotions.manage",
  "coupons.view", "coupons.manage", "delivery.view", "delivery.assign", "reports.view",
  "users.view", "users.manage", "roles.view", "roles.manage", "settings.view", "settings.manage",
  "audit_logs.view", "notifications.view", "customers.view", "customers.manage", "customers.anonymize",
];

// Seeded STORE_ADMIN holds 25 keys (includes delivery.view, delivery.assign, reports.view;
// excludes users.*, roles.*, settings.*, audit_logs.view, customers.anonymize).
const STORE_ADMIN_PERMS = SUPER_ADMIN_PERMS.filter(
  (k) =>
    ![
      "users.view", "users.manage", "roles.view", "roles.manage",
      "settings.view", "settings.manage", "audit_logs.view", "customers.anonymize",
    ].includes(k),
);

function zoneRow() {
  return {
    id: ZONE,
    name: "المنطقة",
    normalizedName: "المنطقه",
    fee: { toString: () => "15.00" },
    isActive: true,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function adminWith(permissions: string[], roleName = "TEST_ROLE") {
  return {
    id: ACTOR,
    name: "Synthetic",
    email: "synthetic@example.invalid",
    isActive: true,
    deletedAt: null,
    userRoles: [
      {
        role: {
          name: roleName,
          isActive: true,
          rolePermissions: permissions.map((key) => ({ permission: { key, isActive: true } })),
        },
      },
    ],
  };
}

function request(method: string, url: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.headers.mockResolvedValue(new Headers());
  mocks.listZones.mockResolvedValue([]);
  mocks.createZone.mockResolvedValue(zoneRow());
  mocks.updateZone.mockResolvedValue({ ...zoneRow(), version: 2 });
});

describe("E-3 — delivery-zone read gate (delivery.view OR settings.view)", () => {
  it("allows SUPER_ADMIN to read delivery zones (200)", async () => {
    mocks.userRead.mockResolvedValue(adminWith(SUPER_ADMIN_PERMS, "SUPER_ADMIN"));
    const res = await listRoute(request("GET", "http://localhost/api/admin/delivery-zones"));
    expect(res.status).toBe(200);
    expect(mocks.listZones).toHaveBeenCalled();
  });

  it("allows STORE_ADMIN to read delivery zones via delivery.view even without settings.view (200)", async () => {
    mocks.userRead.mockResolvedValue(adminWith(STORE_ADMIN_PERMS, "STORE_ADMIN"));
    const res = await listRoute(request("GET", "http://localhost/api/admin/delivery-zones"));
    expect(res.status).toBe(200);
    expect(mocks.listZones).toHaveBeenCalled();
  });

  it("allows a VIEWER role that holds delivery.view only (200)", async () => {
    mocks.userRead.mockResolvedValue(adminWith(["delivery.view"], "VIEWER"));
    const res = await listRoute(request("GET", "http://localhost/api/admin/delivery-zones"));
    expect(res.status).toBe(200);
    expect(mocks.listZones).toHaveBeenCalled();
  });

  it("allows a role that holds the broader settings.view only (200)", async () => {
    mocks.userRead.mockResolvedValue(adminWith(["settings.view"]));
    const res = await listRoute(request("GET", "http://localhost/api/admin/delivery-zones"));
    expect(res.status).toBe(200);
    expect(mocks.listZones).toHaveBeenCalled();
  });

  it("denies a VIEWER role without delivery.view or settings.view (403)", async () => {
    mocks.userRead.mockResolvedValue(adminWith(["orders.view", "products.view"], "VIEWER"));
    const res = await listRoute(request("GET", "http://localhost/api/admin/delivery-zones"));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
    expect(mocks.listZones).not.toHaveBeenCalled();
  });

  it("denies a role with zero permissions (403)", async () => {
    mocks.userRead.mockResolvedValue(adminWith([], "EMPTY_ROLE"));
    const res = await listRoute(request("GET", "http://localhost/api/admin/delivery-zones"));
    expect(res.status).toBe(403);
    expect(mocks.listZones).not.toHaveBeenCalled();
  });

  it("denies an unauthenticated caller with 401", async () => {
    mocks.userRead.mockResolvedValue(null);
    const res = await listRoute(request("GET", "http://localhost/api/admin/delivery-zones"));
    expect(res.status).toBe(401);
    expect(mocks.listZones).not.toHaveBeenCalled();
  });

  it("denies a cross-origin request even for SUPER_ADMIN (403)", async () => {
    mocks.userRead.mockResolvedValue(adminWith(SUPER_ADMIN_PERMS, "SUPER_ADMIN"));
    mocks.headers.mockResolvedValue(
      new Headers({ origin: "https://evil.example", host: "localhost:3000" }),
    );
    const res = await listRoute(request("GET", "http://localhost/api/admin/delivery-zones"));
    expect(res.status).toBe(403);
    expect(mocks.listZones).not.toHaveBeenCalled();
  });
});

describe("E-3 — delivery-zone write gate (settings.manage AND delivery.assign)", () => {
  const createBody = { name: "المنطقة", fee: "15.00", isActive: true };

  it("allows SUPER_ADMIN (holds both settings.manage and delivery.assign) on POST and PATCH", async () => {
    mocks.userRead.mockResolvedValue(adminWith(SUPER_ADMIN_PERMS, "SUPER_ADMIN"));
    const created = await createRoute(request("POST", "http://localhost/api/admin/delivery-zones", createBody));
    expect(created.status).toBe(201);
    expect(mocks.createZone).toHaveBeenCalled();

    const updated = await updateRoute(
      request("PATCH", `http://localhost/api/admin/delivery-zones/${ZONE}`, { fee: "20.00", version: 1 }),
      { params: Promise.resolve({ id: ZONE }) },
    );
    expect(updated.status).toBe(200);
    expect(mocks.updateZone).toHaveBeenCalled();
  });

  it("denies STORE_ADMIN on POST and PATCH (holds delivery.assign but lacks settings.manage)", async () => {
    mocks.userRead.mockResolvedValue(adminWith(STORE_ADMIN_PERMS, "STORE_ADMIN"));
    const created = await createRoute(request("POST", "http://localhost/api/admin/delivery-zones", createBody));
    expect(created.status).toBe(403);
    expect(mocks.createZone).not.toHaveBeenCalled();

    const updated = await updateRoute(
      request("PATCH", `http://localhost/api/admin/delivery-zones/${ZONE}`, { fee: "20.00", version: 1 }),
      { params: Promise.resolve({ id: ZONE }) },
    );
    expect(updated.status).toBe(403);
    expect(mocks.updateZone).not.toHaveBeenCalled();
  });

  it("denies a role that holds settings.manage WITHOUT delivery.assign", async () => {
    mocks.userRead.mockResolvedValue(adminWith(["settings.manage"]));
    const res = await createRoute(request("POST", "http://localhost/api/admin/delivery-zones", createBody));
    expect(res.status).toBe(403);
    expect(mocks.createZone).not.toHaveBeenCalled();
  });

  it("denies a VIEWER role on POST and PATCH (403)", async () => {
    mocks.userRead.mockResolvedValue(adminWith(["delivery.view", "settings.view"], "VIEWER"));
    const created = await createRoute(request("POST", "http://localhost/api/admin/delivery-zones", createBody));
    expect(created.status).toBe(403);
    const updated = await updateRoute(
      request("PATCH", `http://localhost/api/admin/delivery-zones/${ZONE}`, { fee: "20.00", version: 1 }),
      { params: Promise.resolve({ id: ZONE }) },
    );
    expect(updated.status).toBe(403);
    expect(mocks.createZone).not.toHaveBeenCalled();
    expect(mocks.updateZone).not.toHaveBeenCalled();
  });

  it("denies an unauthenticated create and update with 401", async () => {
    mocks.userRead.mockResolvedValue(null);
    const created = await createRoute(request("POST", "http://localhost/api/admin/delivery-zones", createBody));
    expect(created.status).toBe(401);
    const updated = await updateRoute(
      request("PATCH", `http://localhost/api/admin/delivery-zones/${ZONE}`, { fee: "20.00", version: 1 }),
      { params: Promise.resolve({ id: ZONE }) },
    );
    expect(updated.status).toBe(401);
  });
});

describe("E-3 — cross-role privilege escalation prevention on the 3 permissions", () => {
  it.each([
    ["delivery.view", "02800000-0000-7000-8000-000000000121"],
    ["delivery.assign", "02800000-0000-7000-8000-000000000122"],
    ["reports.view", "02800000-0000-7000-8000-000000000123"],
  ])("forbids an operator with roles.manage from granting %s when they do not hold it themselves", async (key, permId) => {
    mocks.userRead.mockResolvedValue(adminWith(["roles.manage", "roles.view"], "ROLE_ADMIN_ONLY"));
    mocks.roleRead.mockResolvedValue({ id: TARGET_ROLE_ID, name: "CUSTOM_ROLE" });
    mocks.permRead.mockResolvedValue({ id: permId, key });

    const res = await grantRoute(
      request("POST", `http://localhost/api/admin/roles/${TARGET_ROLE_ID}/grants`, { permissionId: permId }),
      { params: Promise.resolve({ id: TARGET_ROLE_ID }) },
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
    expect(mocks.grantCreate).not.toHaveBeenCalled();
  });

  it.each([
    ["delivery.view", "02800000-0000-7000-8000-000000000121"],
    ["delivery.assign", "02800000-0000-7000-8000-000000000122"],
    ["reports.view", "02800000-0000-7000-8000-000000000123"],
  ])("allows SUPER_ADMIN (who holds %s) to grant it to a custom role", async (key, permId) => {
    mocks.userRead.mockResolvedValue(adminWith(SUPER_ADMIN_PERMS, "SUPER_ADMIN"));
    mocks.roleRead.mockResolvedValue({ id: TARGET_ROLE_ID, name: "CUSTOM_ROLE" });
    mocks.permRead.mockResolvedValue({ id: permId, key });
    mocks.grantCreate.mockResolvedValue({ id: "grant-1", roleId: TARGET_ROLE_ID, permissionId: permId });

    const res = await grantRoute(
      request("POST", `http://localhost/api/admin/roles/${TARGET_ROLE_ID}/grants`, { permissionId: permId }),
      { params: Promise.resolve({ id: TARGET_ROLE_ID }) },
    );
    expect(res.status).toBe(201);
    expect(mocks.grantCreate).toHaveBeenCalledOnce();
  });
});
