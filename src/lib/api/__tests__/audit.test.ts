// Unit tests for the tx-bound audit trail (R-04 remediation).
//
// The contract under test: the audit trail is the application's log store,
// so the central sanitizer runs on the payload before it is persisted. A
// payload that cannot be sanitized is dropped rather than stored unsanitized.
import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

vi.mock("@/lib/api/request-context", () => ({
  resolveRequestContext: async () => ({ ip: null, userAgent: "test-agent" }),
}));

import { auditInTx } from "@/lib/api/audit";

interface Captured {
  values: unknown[];
}

function fakeTx(captured: Captured): Prisma.TransactionClient {
  return {
    $executeRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      captured.values = values;
      return Promise.resolve(0);
    },
  } as unknown as Prisma.TransactionClient;
}

const USER = "02800000-0000-7000-8000-000000000001";

describe("auditInTx", () => {
  it("drops a secret key nested inside the recorded payload", async () => {
    const captured: Captured = { values: [] };
    await auditInTx(fakeTx(captured), {
      action: "order.update",
      userId: USER,
      entityType: "order",
      entityId: null,
      oldValues: { status: "NEW" },
      newValues: { status: "CONFIRMED", token: "raw-secret-token" },
    });

    const newValues = captured.values[5] as string;
    expect(newValues).toContain("CONFIRMED");
    expect(newValues).not.toContain("raw-secret-token");
    expect(newValues).not.toContain("token");
  });

  it("keeps a legitimate payload intact", async () => {
    const captured: Captured = { values: [] };
    await auditInTx(fakeTx(captured), {
      action: "order.update",
      userId: USER,
      entityType: "order",
      entityId: null,
      oldValues: null,
      newValues: { name: "Ali", price: "10.00", normalizedName: "ali" },
    });

    expect(captured.values[4]).toBeNull();
    expect(JSON.parse(captured.values[5] as string)).toEqual({
      name: "Ali",
      price: "10.00",
      normalizedName: "ali",
    });
  });

  it("cuts a cycle in the payload instead of failing the transaction", async () => {
    const captured: Captured = { values: [] };
    const cyclic: Record<string, unknown> = { name: "Ali" };
    cyclic.self = cyclic;

    await auditInTx(fakeTx(captured), {
      action: "order.update",
      userId: USER,
      entityType: "order",
      entityId: null,
      oldValues: null,
      newValues: cyclic,
    });

    // A cycle is cut, not fatal: the payload is still recorded without the loop.
    expect(captured.values[5]).not.toBeNull();
    expect(JSON.parse(captured.values[5] as string)).toEqual({ name: "Ali", self: "[circular]" });
  });
});
