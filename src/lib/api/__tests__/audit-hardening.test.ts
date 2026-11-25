// BL-01 audit-hardening unit tests (Phase_12_Full_Execution mission).
//
// Contract under test:
//   * correlation id (P3) lands INSIDE new_values when the request context
//     carries one — the frozen audit_logs table is never widened;
//   * payloads are byte-compatible with the pre-hardening shape when no
//     correlation/reason exists (no phantom metadata keys);
//   * the reason is bounded + control-character-free;
//   * the central sanitizer still drops secret-bearing keys at any depth
//     even when metadata keys are attached.
import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

// The request context is mocked with a mutable correlation id so each case
// controls whether metadata keys must (or must not) appear.
let correlationId: string | null = null;
vi.mock("@/lib/api/request-context", () => ({
  resolveRequestContext: async () => ({ ip: null, userAgent: "test-agent", correlationId }),
}));

import { auditInTx } from "@/lib/api/audit";
import { extractCorrelationId, normalizeAuditReason } from "@/lib/api/correlation";

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
const baseEvent = {
  action: "products.update",
  userId: USER,
  entityType: "products",
  entityId: null as string | null,
};

describe("auditInTx correlation + reason envelope (BL-01)", () => {
  it("records the correlation id inside new_values and keeps old_values null", async () => {
    correlationId = "req-abc.123";
    const captured: Captured = { values: [] };
    await auditInTx(fakeTx(captured), {
      ...baseEvent,
      oldValues: { isActive: true },
      newValues: { isActive: false },
    });
    expect(JSON.parse(captured.values[4] as string)).toEqual({ isActive: true }); // old_values untouched by metadata
    const parsed = JSON.parse(captured.values[5] as string);
    expect(parsed).toEqual({ isActive: false, correlation_id: "req-abc.123" });
  });

  it("adds NO metadata keys when the context has no correlation id", async () => {
    correlationId = null;
    const captured: Captured = { values: [] };
    await auditInTx(fakeTx(captured), {
      ...baseEvent,
      oldValues: null,
      newValues: { name: "Ali", price: "10.00" },
    });
    expect(JSON.parse(captured.values[5] as string)).toEqual({ name: "Ali", price: "10.00" });
  });

  it("keeps new_values NULL when there is no payload and no metadata", async () => {
    correlationId = null;
    const captured: Captured = { values: [] };
    await auditInTx(fakeTx(captured), { ...baseEvent, oldValues: null, newValues: null });
    expect(captured.values[5]).toBeNull();
  });

  it("records a sanitized reason inside new_values", async () => {
    correlationId = null;
    const captured: Captured = { values: [] };
    await auditInTx(fakeTx(captured), {
      ...baseEvent,
      oldValues: { name: "old" },
      newValues: { name: "new" },
      reason: "OD-06 approved move; batch #12\u0007",
    });
    const parsed = JSON.parse(captured.values[5] as string);
    expect(parsed.reason).toBe("OD-06 approved move; batch #12"); // trailing control char folded then trimmed
    expect(parsed.reason).not.toContain("\u0007");
  });

  it("still drops secret-bearing payload keys when metadata is attached", async () => {
    correlationId = "c-1";
    const captured: Captured = { values: [] };
    await auditInTx(fakeTx(captured), {
      ...baseEvent,
      oldValues: null,
      newValues: { name: "n", nested: { token: "raw-secret" } },
      reason: "r",
    });
    const text = captured.values[5] as string;
    expect(text).toContain("correlation_id");
    expect(text).toContain("reason");
    expect(text).not.toContain("raw-secret");
    expect(text).not.toContain("token");
  });
});

describe("correlation helpers (pure)", () => {
  const h = (headers: Record<string, string>) => ({ get: (n: string) => headers[n.toLowerCase()] ?? null });

  it("accepts a well-formed x-correlation-id", () => {
    expect(extractCorrelationId(h({ "x-correlation-id": "req-42.test_1" }))).toBe("req-42.test_1");
  });

  it("falls back to x-request-id when the first header is absent", () => {
    expect(extractCorrelationId(h({ "x-request-id": "abcdef123456" }))).toBe("abcdef123456");
  });

  it("rejects an invalid id instead of laundering it", () => {
    expect(extractCorrelationId(h({ "x-correlation-id": "bad id with spaces" }))).toBeNull();
    expect(extractCorrelationId(h({ "x-correlation-id": "x".repeat(65) }))).toBeNull();
  });

  it("returns null without any header", () => {
    expect(extractCorrelationId(h({}))).toBeNull();
  });

  it("bounds and cleans the reason", () => {
    expect(normalizeAuditReason(undefined)).toBeNull();
    expect(normalizeAuditReason("   ")).toBeNull();
    expect(normalizeAuditReason("a\u0000b")).toBe("a b");
    expect(normalizeAuditReason("r".repeat(600))?.length).toBe(500);
  });
});
