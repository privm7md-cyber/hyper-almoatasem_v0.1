// @vitest-environment node
// P12-08 D01 — Hardened Design H2 Unit & Activation-Boundary Verification Suite.
//
// Proves:
//   1. H2 is DISABLED by default (`CUSTOMER_AUDIT_REDACTION_MODE` unset):
//      - `isCustomerAuditRedactionH2Enabled()` returns `false`.
//      - `getCustomerAnonymizeStatus()` returns `null` with ZERO DB queries.
//      - `anonymizeCustomer()` preserves legacy synchronous behavior and never
//        queries `customer_audit_redaction_tasks` or `pg_notify`.
//   2. When `CUSTOMER_AUDIT_REDACTION_MODE=H2` is explicitly enabled:
//      - `anonymizeCustomer()` NEVER calls `tx.auditLog.update()`.
//      - Never-edited & `changedFields`-only customers complete synchronously (`200`).
//      - Customers with historical audit PII enqueue a durable task, cast
//        `pg_notify(...)::text AS notified`, and return `PENDING_AUDIT_REDACTION`
//        or `FAILED` (`anonymized: false`).
//      - `hasUnredactedCustomerAuditPii` enforces the strict 5-key allowlist.
//      - `getCustomerAnonymizeStatus` never exposes raw PII in any state.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  transaction: vi.fn(),
  raw: vi.fn(),
  customerFindUnique: vi.fn(),
  customerUpdate: vi.fn(),
  addressDeleteMany: vi.fn(),
  sessionDeleteMany: vi.fn(),
  orderFindMany: vi.fn(),
  orderUpdate: vi.fn(),
  orderCount: vi.fn(),
  auditFindMany: vi.fn(),
  auditUpdate: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: m.transaction,
    $queryRaw: m.raw,
    customer: { findUnique: m.customerFindUnique },
    order: { count: m.orderCount },
    auditLog: { findMany: m.auditFindMany },
  },
}));
vi.mock("@/lib/api/audit", () => ({ auditInTx: m.audit }));
vi.mock("@/lib/auth/admin-read-only-preview", () => ({
  assertAdminPreviewWritesAllowed: vi.fn(),
  isAdminReadOnlyPreviewConfigured: () => false,
}));

import {
  ANONYMIZED_DISPLAY_NAME,
  PRIVACY_REMOVED_TEXT,
  anonymizeCustomer,
  anonymousPhonePlaceholder,
  getCustomerAnonymizeStatus,
  hasUnredactedCustomerAuditPii,
  isCustomerAuditRedactionH2Enabled,
  type AnonymizeInput,
} from "../anonymize";

const ID = "00000000-0000-4000-8000-000000000001";
const ACTOR = "00000000-0000-4000-8000-0000000000aa";
const SESSION_ID = "00000000-0000-4000-8000-0000000000bb";
const TASK_ID = "00000000-0000-4000-8000-0000000000cc";
const ANON_AUDIT_ID = "00000000-0000-4000-8000-0000000000dd";
const TOKEN = "2026-11-12T10:00:00.000Z";

const input: AnonymizeInput = {
  confirmed: true,
  reason: "طلب رسمي لإخفاء هوية العميل",
  expectedUpdatedAt: TOKEN,
};

function tx() {
  return {
    $queryRaw: m.raw,
    customer: { findUnique: m.customerFindUnique, update: m.customerUpdate },
    customerAddress: { deleteMany: m.addressDeleteMany },
    customerSession: { deleteMany: m.sessionDeleteMany },
    order: { findMany: m.orderFindMany, update: m.orderUpdate },
    auditLog: { findMany: m.auditFindMany, update: m.auditUpdate },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  delete process.env.CUSTOMER_AUDIT_REDACTION_MODE;
  m.transaction.mockImplementation((fn: (t: unknown) => unknown) => fn(tx()));
  m.raw.mockImplementation(async (strings: TemplateStringsArray) => {
    const sql = strings.join(" ").replace(/\s+/g, " ");
    if (sql.includes("customer_auth_rate_limits")) return [{ count: 1 }];
    if (sql.includes("FROM audit_logs") && sql.includes("customers.anonymize")) {
      return [{ id: ANON_AUDIT_ID }];
    }
    if (sql.includes("INSERT INTO customer_audit_redaction_tasks")) {
      return [
        {
          id: TASK_ID,
          status: "PENDING",
          attempt_count: 0,
          redacted_audit_rows: null,
          last_error_code: null,
        },
      ];
    }
    if (sql.includes("pg_notify")) return [{ notified: "" }];
    return [{ id: ID }];
  });
  m.customerFindUnique.mockResolvedValue({
    id: ID,
    firstName: "أحمد",
    lastName: "علي",
    phone: "201000000000",
    email: "ahmed@example.test",
    passwordHash: "hash",
    isRegistered: true,
    lockedUntil: null,
    isActive: true,
    deletedAt: null,
    updatedAt: new Date(TOKEN),
  });
  m.customerUpdate.mockResolvedValue({});
  m.addressDeleteMany.mockResolvedValue({ count: 1 });
  m.sessionDeleteMany.mockResolvedValue({ count: 1 });
  m.orderFindMany.mockImplementation(async (args: { where?: { status?: { in?: string[] } } }) =>
    args.where?.status?.in ? [] : [{ id: "order-1", notes: null }],
  );
  m.orderUpdate.mockResolvedValue({});
  m.orderCount.mockResolvedValue(1);
  m.auditFindMany.mockResolvedValue([
    { id: "audit-1", action: "customers.update", oldValues: null, newValues: { email: "ahmed@example.test" } },
  ]);
  m.auditUpdate.mockResolvedValue({});
  m.audit.mockResolvedValue(undefined);
});

afterEach(() => {
  delete process.env.CUSTOMER_AUDIT_REDACTION_MODE;
});

describe("P12-08 D01 — Default-Disabled Activation Boundary", () => {
  it("is disabled by default and rejects unknown mode values", () => {
    expect(isCustomerAuditRedactionH2Enabled({})).toBe(false);
    expect(isCustomerAuditRedactionH2Enabled({ CUSTOMER_AUDIT_REDACTION_MODE: "LEGACY" })).toBe(false);
    expect(isCustomerAuditRedactionH2Enabled({ CUSTOMER_AUDIT_REDACTION_MODE: "true" })).toBe(false);
    expect(isCustomerAuditRedactionH2Enabled({ CUSTOMER_AUDIT_REDACTION_MODE: "H2" })).toBe(true);
  });

  it("when disabled by default, getCustomerAnonymizeStatus returns null with zero DB contact", async () => {
    const status = await getCustomerAnonymizeStatus(ID);
    expect(status).toBeNull();
    expect(m.customerFindUnique).not.toHaveBeenCalled();
    expect(m.raw).not.toHaveBeenCalled();
  });

  it("when disabled by default, anonymizeCustomer uses the legacy path and never touches H2 queue tables", async () => {
    const result = await anonymizeCustomer(ID, input, ACTOR);
    expect(result.anonymized).toBe(true);
    expect(m.auditUpdate).toHaveBeenCalledTimes(1);
    const allSql = m.raw.mock.calls.map((c) => c[0].join(" ")).join(" | ");
    expect(allSql).not.toContain("customer_audit_redaction_tasks");
    expect(allSql).not.toContain("pg_notify");
  });

  it("when disabled by default, skips unnecessary audit_logs UPDATE when historical rows contain only minimized changedFields", async () => {
    m.auditFindMany.mockResolvedValue([
      { id: "audit-min-1", action: "customers.update", oldValues: null, newValues: { changedFields: ["firstName"] } },
    ]);
    const result = await anonymizeCustomer(ID, input, ACTOR);
    expect(result.anonymized).toBe(true);
    expect(m.auditUpdate).not.toHaveBeenCalled();
  });

  it("when unmigrated immutable audit_logs trigger blocks legacy scrub, fails safely with 422 BUSINESS_RULE (AUDIT_REDACTION_MIGRATION_REQUIRED) instead of 500", async () => {
    m.auditUpdate.mockRejectedValueOnce(
      Object.assign(new Error("audit_logs is append-only: UPDATE is not permitted"), { code: "23000" }),
    );
    await expect(anonymizeCustomer(ID, input, ACTOR)).rejects.toMatchObject({
      code: "BUSINESS_RULE",
      details: {
        reasonCode: "AUDIT_REDACTION_MIGRATION_REQUIRED",
        anonymized: false,
      },
    });
  });
});

describe("P12-08 D01 — Opt-In Hardened Design H2 (`CUSTOMER_AUDIT_REDACTION_MODE=H2`)", () => {
  beforeEach(() => {
    process.env.CUSTOMER_AUDIT_REDACTION_MODE = "H2";
  });

  it("completes synchronously (anonymized: true) when customer has zero unredacted historical audit rows", async () => {
    m.auditFindMany.mockResolvedValueOnce([
      {
        id: "audit-clean",
        action: "customers.update",
        oldValues: null,
        newValues: { changedFields: ["firstName", "email"], correlation_id: "corr-1" },
      },
    ]);
    const result = await anonymizeCustomer(ID, input, ACTOR, SESSION_ID);
    expect(result.anonymized).toBe(true);
    expect(result.outcome).toBe("COMPLETED_WITH_LEGAL_REVIEW");
    expect(result.redactionTaskId).toBeNull();
    expect(m.auditUpdate).not.toHaveBeenCalled();
  });

  it("never calls tx.auditLog.update when historical PII exists; enqueues durable task with pg_notify::text cast", async () => {
    const result = await anonymizeCustomer(ID, input, ACTOR, SESSION_ID);
    expect(m.auditUpdate).not.toHaveBeenCalled();
    expect(result.anonymized).toBe(false);
    expect(result.outcome).toBe("PENDING_AUDIT_REDACTION");
    expect(result.auditRedactionPending).toBe(true);
    expect(result.redactionTaskId).toBe(TASK_ID);
    expect(result.removed.auditRows).toBe(0);

    const notifyCall = m.raw.mock.calls.find((c) => c[0].join(" ").includes("pg_notify"));
    expect(notifyCall).toBeDefined();
    expect(notifyCall![0].join(" ")).toContain("::text AS notified");
  });

  it("refuses with UNAUTHENTICATED when historical PII exists and adminSessionId is absent", async () => {
    await expect(anonymizeCustomer(ID, input, ACTOR)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("reports outcome FAILED (`anonymized: false`) when an active task is in FAILED state", async () => {
    m.raw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join(" ").replace(/\s+/g, " ");
      if (sql.includes("customer_auth_rate_limits")) return [{ count: 0 }];
      if (sql.includes("FROM audit_logs") && sql.includes("customers.anonymize")) return [{ id: ANON_AUDIT_ID }];
      if (sql.includes("INSERT INTO customer_audit_redaction_tasks")) return [];
      if (sql.includes("FROM customer_audit_redaction_tasks")) {
        return [
          {
            id: TASK_ID,
            status: "FAILED",
            attempt_count: 4,
            redacted_audit_rows: null,
            last_error_code: "PG_40001",
          },
        ];
      }
      return [{ id: ID }];
    });

    const result = await anonymizeCustomer(ID, input, ACTOR, SESSION_ID);
    expect(result.anonymized).toBe(false);
    expect(result.outcome).toBe("FAILED");
    expect(result.attemptCount).toBe(4);
    expect(result.lastErrorCode).toBe("PG_40001");
  });

  it("enforces the fail-closed 5-key allowlist in hasUnredactedCustomerAuditPii", () => {
    expect(
      hasUnredactedCustomerAuditPii({
        isRegistered: true,
        isActive: false,
        autoAcceptReplacements: true,
        changedFields: ["firstName", "lastName", "email"],
        correlation_id: "req-abc-123",
      }),
    ).toBe(false);
    expect(hasUnredactedCustomerAuditPii({ email: PRIVACY_REMOVED_TEXT, lastName: null })).toBe(false);
    expect(hasUnredactedCustomerAuditPii({ unexpectedKey: "alias" })).toBe(true);
    expect(hasUnredactedCustomerAuditPii({ changedFields: ["firstName", "raw_pii_injected"] })).toBe(true);
    expect(hasUnredactedCustomerAuditPii({ correlation_id: "user@example.test" })).toBe(true);
  });

  it("getCustomerAnonymizeStatus reports states accurately and never leaks historical PII", async () => {
    m.customerFindUnique.mockResolvedValue({
      id: ID,
      firstName: ANONYMIZED_DISPLAY_NAME,
      lastName: null,
      phone: anonymousPhonePlaceholder(ID),
      email: null,
      passwordHash: null,
      isRegistered: false,
      isActive: false,
      deletedAt: new Date(TOKEN),
    });
    m.raw.mockResolvedValueOnce([
      {
        id: TASK_ID,
        status: "FAILED",
        attempt_count: 2,
        redacted_audit_rows: null,
        last_error_code: "WORKER_EXECUTION_ERROR",
      },
    ]);

    const status = await getCustomerAnonymizeStatus(ID);
    expect(status?.state).toBe("FAILED");
    expect(status?.anonymized).toBe(false);
    expect(JSON.stringify(status)).not.toContain("ahmed@example.test");
  });
});
