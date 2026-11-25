// D3 — the operational event log is ALLOWLISTED.
//
// The point of these tests is not "the logger prints something" but "the
// logger cannot print something it should not": an unknown event, a field
// outside the event's allowlist, an address, a credential or a payload must
// never reach a log line.
import { afterEach, describe, expect, it, vi } from "vitest";
import { bucketScope, logOperationalEvent } from "@/lib/api/log-events";

const lines: string[] = [];
const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
  lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
});

afterEach(() => {
  lines.length = 0;
  spy.mockClear();
});

function lastLine(): Record<string, unknown> {
  const raw = lines[lines.length - 1] ?? "{}";
  return JSON.parse(raw) as Record<string, unknown>;
}

describe("operational event allowlist", () => {
  it("emits only the allowlisted fields of an event", () => {
    logOperationalEvent("rate_limit.exceeded", {
      scope: "guest-order-create",
      limit: 10,
      attempts: 11,
      table: "guest_order_rate_limits",
    });
    const line = lastLine();
    expect(line.event).toBe("rate_limit.exceeded");
    expect(line.scope).toBe("guest-order-create");
    expect(line.limit).toBe(10);
    expect(line.attempts).toBe(11);
    expect(line.table).toBe("guest_order_rate_limits");
  });

  it("drops every field that is not on the event's allowlist", () => {
    logOperationalEvent("authz.denied", {
      permission: "orders.update",
      reason: "missing_permission",
      adminId: "11111111-1111-1111-1111-111111111111",
      email: "owner@example.com",
    });
    const line = lastLine();
    expect(line.permission).toBe("orders.update");
    expect(line.reason).toBe("missing_permission");
    expect(line).not.toHaveProperty("adminId");
    expect(line).not.toHaveProperty("email");
    expect(lines[lines.length - 1]).not.toContain("owner@example.com");
  });

  it("drops a field that carries an address even when it is allowlisted elsewhere", () => {
    logOperationalEvent("internal.error", { code: "INTERNAL", surface: "orders" });
    const line = lastLine();
    expect(line.code).toBe("INTERNAL");
    expect(line.surface).toBe("orders");
  });

  it("never emits an address that reached the fields object", () => {
    logOperationalEvent("rate_limit.exceeded", {
      scope: "guest-order-create",
      limit: 10,
      attempts: 11,
      table: "guest_order_rate_limits",
      clientIp: "203.0.113.9",
    });
    expect(lines[lines.length - 1]).not.toContain("203.0.113.9");
  });
});

describe("bucketScope", () => {
  it("maps a bucket key to its family without exposing the identity", () => {
    expect(bucketScope("guest-order:ip:203.0.113.9")).toBe("guest-order-create");
    expect(bucketScope("guest-order:read-ip:203.0.113.9")).toBe("guest-order-read");
    expect(bucketScope("guest-checkout-session:ip:203.0.113.9")).toBe("guest-checkout-session");
    expect(bucketScope("login:ip:203.0.113.9")).toBe("admin-login-ip");
    expect(bucketScope("login:acct:owner@example.com")).toBe("admin-login-account");
    expect(bucketScope("login:cust-ip:203.0.113.9")).toBe("customer-login-ip");
    expect(bucketScope("login:cust-acct:201001234567")).toBe("customer-login-account");
    expect(bucketScope("reg:cust-ip:203.0.113.9")).toBe("customer-register-ip");
    expect(bucketScope("reg:cust-acct:deadbeef")).toBe("customer-register-phone");
  });

  it("does not truncate one family into another", () => {
    expect(bucketScope("login:cust-ip:203.0.113.9")).not.toBe("admin-login-ip");
    expect(bucketScope("reg:cust-acct:deadbeef")).not.toBe("customer-login-account");
    expect(bucketScope("guest-order:read-ip:203.0.113.9")).not.toBe("guest-order-create");
  });

  it("labels an unknown key without echoing it", () => {
    expect(bucketScope("mystery:203.0.113.9")).toBe("unclassified");
  });
});
