import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));

const mocks = vi.hoisted(() => ({
  checkAndRecordRateLimit: vi.fn(),
  identifyCustomer: vi.fn(),
  checkPermission: vi.fn(),
  headersMap: {} as Record<string, string>,
}));

vi.mock("next/headers", () => ({
  headers: vi.fn().mockImplementation(async () => ({
    get: (name: string) => {
      const k = Object.keys(mocks.headersMap).find((key) => key.toLowerCase() === name.toLowerCase());
      return k ? mocks.headersMap[k] : null;
    },
  })),
}));

vi.mock("@/lib/auth/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/rate-limit")>();
  return {
    ...actual,
    checkAndRecordRateLimit: mocks.checkAndRecordRateLimit,
  };
});

vi.mock("@/lib/customers/writes", () => ({
  identifyCustomer: mocks.identifyCustomer,
}));

vi.mock("@/lib/auth/rbac", () => ({
  checkPermission: mocks.checkPermission,
}));

import { POST as identifyPost } from "@/app/api/store/customers/identify/route";
import { denyUnless, adminOrDeny } from "@/lib/api/route-auth";
import {
  guestOrderCreateBucket,
  guestOrderReadBucket,
  ipBucket,
  customerIpBucket,
  customerRegIpBucket,
} from "@/lib/auth/rate-limit";

describe("Security Remediation Suite (BUG-04, BUG-05, BUG-06)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.headersMap = {};
    mocks.checkAndRecordRateLimit.mockResolvedValue({ allowed: true, attempts: 1 });
  });

  it("BUG-04: /api/store/customers/identify redacts stored PII (firstName, lastName, email) when an existing customer matches by phone", async () => {
    mocks.identifyCustomer.mockResolvedValue({
      created: false,
      customer: {
        id: "04800000-0000-7000-8000-000000000099",
        phone: "201012345678",
        firstName: "سارة الحقيقية",
        lastName: "محمود السري",
        email: "sara.private@example.com",
        isRegistered: true,
        isActive: true,
        notes: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      },
    });

    const req = new Request("http://localhost:3000/api/store/customers/identify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        host: "localhost:3000",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({ phone: "01012345678", firstName: "زائر" }),
    });

    const res = await identifyPost(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe("04800000-0000-7000-8000-000000000099");
    expect(body.data.phone).toBe("201012345678");
    // Stored PII from the DB row is NEVER leaked to an unauthenticated phone lookup:
    expect(body.data.firstName).toBe("زائر");
    expect(body.data.lastName).toBeNull();
    expect(body.data.email).toBeNull();
    expect(JSON.stringify(body)).not.toContain("سارة الحقيقية");
    expect(JSON.stringify(body)).not.toContain("sara.private@example.com");
  });

  it("BUG-04 & BUG-05: /api/store/customers/identify enforces rate limiting (429 RATE_LIMITED)", async () => {
    mocks.checkAndRecordRateLimit.mockResolvedValue({ allowed: false, attempts: 31 });
    const req = new Request("http://localhost:3000/api/store/customers/identify", {
      method: "POST",
      headers: { "Content-Type": "application/json", host: "localhost:3000" },
      body: JSON.stringify({ phone: "01012345678", firstName: "زائر" }),
    });
    const res = await identifyPost(req);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(mocks.identifyCustomer).not.toHaveBeenCalled();
  });

  it("BUG-06: /api/store/customers/identify and admin route guards block cross-origin CSRF mutations with 403 FORBIDDEN", async () => {
    const crossOriginReq = new Request("http://localhost:3000/api/store/customers/identify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        host: "localhost:3000",
        origin: "https://evil.attacker.example",
      },
      body: JSON.stringify({ phone: "01012345678", firstName: "زائر" }),
    });
    const res = await identifyPost(crossOriginReq);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");

    // Admin route guard CSRF protection:
    mocks.headersMap = { host: "localhost:3000", origin: "https://evil.attacker.example" };
    mocks.checkPermission.mockResolvedValue({
      ok: true,
      admin: { user: { id: "u1", name: "Admin", email: "a@b.c" }, roles: ["SUPER_ADMIN"], permissions: ["products.update"] },
    });
    const denied = await denyUnless("products.update");
    expect(denied?.status).toBe(403);
    const gate = await adminOrDeny("products.update");
    expect("denied" in gate && gate.denied.status).toBe(403);
  });

  it("BUG-05: rate-limit bucket helpers isolate null-IP requests by target/session scope instead of one global 'unknown' bucket", () => {
    const b1 = guestOrderCreateBucket(null, "cart-session-hash-A");
    const b2 = guestOrderCreateBucket(null, "cart-session-hash-B");
    expect(b1).not.toBe("guest-order:ip:unknown");
    expect(b1).not.toBe(b2);

    const r1 = guestOrderReadBucket(null, "11111111-1111-4111-8111-111111111111");
    const r2 = guestOrderReadBucket(null, "22222222-2222-4222-8222-222222222222");
    expect(r1).not.toBe("guest-order:read-ip:unknown");
    expect(r1).not.toBe(r2);

    expect(ipBucket(null, "admin1@example.com")).not.toBe(ipBucket(null, "admin2@example.com"));
    expect(customerIpBucket(null, "201011111111")).not.toBe(customerIpBucket(null, "201022222222"));
    expect(customerRegIpBucket(null, "201011111111")).not.toBe(customerRegIpBucket(null, "201022222222"));
  });
});
