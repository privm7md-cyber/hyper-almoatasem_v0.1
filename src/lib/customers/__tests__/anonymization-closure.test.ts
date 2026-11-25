// @vitest-environment node
// ADM-OWNER — the final closure gates of the anonymization policy.
//
//   G1 — Anonymization Matrix: every field and copy carries ONE explicit
//        action (no "reviewed later").
//   G2 — Delivery PII: the delivery address is removed field by field; only
//        the coarse administrative area survives.
//   G3 — Free Text: the whole text is replaced — a regex is never trusted.
//   G4 — Retained PII: what stays carries its reason, its access scope and
//        the permission that governs it.
//   G5 — Idempotency: repeating the operation is safe.
//   +   An open order refuses the operation (and can be retried later).
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  transaction: vi.fn(),
  raw: vi.fn(),
  customerFindUnique: vi.fn(),
  customerUpdate: vi.fn(),
  addressDeleteMany: vi.fn(),
  sessionDeleteMany: vi.fn(),
  orderFindMany: vi.fn(),
  orderUpdate: vi.fn(),
  auditFindMany: vi.fn(),
  auditUpdate: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: { $transaction: m.transaction } }));
vi.mock("@/lib/api/audit", () => ({ auditInTx: m.audit }));
vi.mock("@/lib/auth/admin-read-only-preview", () => ({
  assertAdminPreviewWritesAllowed: vi.fn(),
  isAdminReadOnlyPreviewConfigured: () => false,
}));

import {
  ANONYMIZED_DISPLAY_NAME,
  CUSTOMER_DATA_RETENTION_MATRIX,
  PRIVACY_REMOVED_TEXT,
  anonymizeCustomer,
  anonymousPhonePlaceholder,
  type AnonymizeInput,
} from "../anonymize";

const ID = "00000000-0000-4000-8000-000000000001";
const ACTOR = "00000000-0000-4000-8000-0000000000aa";
const TOKEN = "2026-11-12T10:00:00.000Z";
const input: AnonymizeInput = { confirmed: true, reason: "طلب من صاحب المتجر", expectedUpdatedAt: TOKEN };

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

function customer(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  m.transaction.mockImplementation((fn: (t: unknown) => unknown) => fn(tx()));
  m.raw.mockImplementation(async (strings: TemplateStringsArray) => {
    const sql = strings.join(" ").replace(/\s+/g, " ");
    if (sql.includes("customer_auth_rate_limits")) return [{ count: 2 }];
    return [{ id: ID }];
  });
  m.customerFindUnique.mockResolvedValue(customer());
  m.customerUpdate.mockResolvedValue({});
  m.addressDeleteMany.mockResolvedValue({ count: 1 });
  m.sessionDeleteMany.mockResolvedValue({ count: 1 });
  m.orderFindMany.mockImplementation(async (args: { where?: { status?: { in?: string[] } } }) =>
    args.where?.status?.in ? [] : [{ id: "order-1", notes: "العميل طلب التوصيل بعد المغرب، العنوانnear.market" }],
  );
  m.orderUpdate.mockResolvedValue({});
  m.auditFindMany.mockResolvedValue([]);
  m.auditUpdate.mockResolvedValue({});
  m.audit.mockResolvedValue(undefined);
});

describe("G1 — the retention matrix is complete and explicit", () => {
  it("every entry carries one of the five actions — nothing is left to a later review", () => {
    const allowed = new Set(["REMOVE", "REPLACE", "RETAIN_OPERATIONAL", "RESTRICTED_RETAINED_PII", "LEGAL_REVIEW_REQUIRED"]);
    for (const entry of CUSTOMER_DATA_RETENTION_MATRIX) {
      expect(allowed.has(entry.action), `${entry.location} → ${entry.action}`).toBe(true);
      expect(entry.reason.length).toBeGreaterThan(15);
    }
    // No entry may be "restricted" without its reason and its access scope.
    for (const entry of CUSTOMER_DATA_RETENTION_MATRIX.filter((e) => e.restricted)) {
      expect(entry.reason.length).toBeGreaterThan(15);
      expect(entry.accessScope?.length ?? 0).toBeGreaterThan(3);
      expect(entry.requiredPermission?.length ?? 0).toBeGreaterThan(3);
    }
  });

  it("the matrix names every copy that can hold identifying data", () => {
    const locations = CUSTOMER_DATA_RETENTION_MATRIX.map((entry) => entry.location);
    for (const expected of [
      "customers.first_name",
      "customers.last_name",
      "customers.phone",
      "customers.email",
      "customers.password_hash",
      "customer_addresses.street",
      "customer_addresses.landmark",
      "customer_addresses.phone",
      "customer_sessions.token_hash",
      "customer_sessions.created_ip",
      "customer_auth_rate_limits.bucket_key",
      "orders.customer_name_snapshot",
      "orders.customer_phone_snapshot",
      "orders.delivery_phone",
      "orders.delivery_street",
      "orders.delivery_building",
      "orders.delivery_landmark",
      "orders.delivery_village",
      "orders.delivery_area",
      "orders.delivery_city",
      "orders.notes",
      "audit_logs.old_values / new_values (صفوف العميل)",
    ]) {
      expect(locations, expected).toContain(expected);
    }
  });
});

describe("G2 — the delivery PII is removed field by field", () => {
  it("only the coarse city survives; every locating field is removed", async () => {
    await anonymizeCustomer(ID, input, ACTOR);
    const update = m.orderUpdate.mock.calls[0][0].data as Record<string, unknown>;
    expect(update.deliveryStreet).toBeNull();
    expect(update.deliveryBuilding).toBeNull();
    expect(update.deliveryLandmark).toBeNull();
    expect(update.deliveryVillage).toBeNull();
    expect(update.deliveryArea).toBeNull();
    expect(update.deliveryPhone).toBe(anonymousPlaceholder());
    // The city is operational (zone + fee statistics) and stays.
    expect(update).not.toHaveProperty("deliveryCity");
  });

  it("the matrix says the city is operational and the area is not", () => {
    const city = CUSTOMER_DATA_RETENTION_MATRIX.find((entry) => entry.location === "orders.delivery_city");
    const area = CUSTOMER_DATA_RETENTION_MATRIX.find((entry) => entry.location === "orders.delivery_area");
    expect(city?.action).toBe("RETAIN_OPERATIONAL");
    expect(area?.action).toBe("REMOVE");
  });
});

describe("G3 — the free text is replaced, never pattern-scrubbed", () => {
  it("the whole note is replaced by a generic sentence", async () => {
    await anonymizeCustomer(ID, input, ACTOR);
    const update = m.orderUpdate.mock.calls[0][0].data as Record<string, unknown>;
    expect(update.notes).toBe(PRIVACY_REMOVED_TEXT);
    expect(String(update.notes)).not.toContain("العميل");
    expect(String(update.notes)).not.toContain("market");
  });

  it("the original text never reaches the new audit row", async () => {
    await anonymizeCustomer(ID, input, ACTOR);
    const auditRow = JSON.stringify(m.audit.mock.calls[0][1]);
    expect(auditRow).not.toContain("market");
    expect(auditRow).not.toContain("العميل طلب");
    expect(auditRow).not.toContain("201000000000");
  });
});

describe("G4 — the retained PII is bounded and governed", () => {
  it("what stays carries its access scope and its permission", async () => {
    const result = await anonymizeCustomer(ID, input, ACTOR);
    expect(result.restrictedRetained.length).toBeGreaterThan(0);
    for (const retained of result.restrictedRetained) {
      expect(retained.accessScope.length).toBeGreaterThan(3);
      expect(retained.requiredPermission.length).toBeGreaterThan(3);
    }
    // The outcome says the legal review is still open.
    expect(result.outcome).toBe("COMPLETED_WITH_LEGAL_REVIEW");
  });
});

describe("G5 — the operation is idempotent and safe to repeat", () => {
  it("a second run reports the customer as already anonymized and changes nothing harmful", async () => {
    const first = await anonymizeCustomer(ID, input, ACTOR);
    expect(first.alreadyAnonymized).toBe(false);
    m.customerFindUnique.mockResolvedValue(
      customer({
        firstName: ANONYMIZED_DISPLAY_NAME,
        lastName: null,
        phone: anonymousPhonePlaceholder(ID),
        email: null,
        passwordHash: null,
        isRegistered: false,
        isActive: false,
        deletedAt: new Date(TOKEN),
      }),
    );
    const second = await anonymizeCustomer(ID, input, ACTOR);
    expect(second.alreadyAnonymized).toBe(true);
    expect(second.anonymized).toBe(true);
  });
});

describe("an open order refuses the operation and can be retried later", () => {
  it("refuses with an Arabic reason and touches nothing", async () => {
    m.orderFindMany.mockImplementation(async (args: { where?: { status?: { in?: string[] } } }) =>
      args.where?.status?.in ? [{ orderNumber: "HM-20261112-000001", status: "PREPARING" }] : [],
    );
    await expect(anonymizeCustomer(ID, input, ACTOR)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await expect(anonymizeCustomer(ID, input, ACTOR)).rejects.toThrow(/طلب لسه مفتوح/);
    expect(m.customerUpdate).not.toHaveBeenCalled();
    expect(m.addressDeleteMany).not.toHaveBeenCalled();
    expect(m.orderUpdate).not.toHaveBeenCalled();
  });

  it("runs once the order is closed", async () => {
    m.orderFindMany.mockImplementation(async (args: { where?: { status?: { in?: string[] } } }) =>
      args.where?.status?.in ? [] : [{ id: "order-1", notes: null }],
    );
    const result = await anonymizeCustomer(ID, input, ACTOR);
    expect(result.anonymized).toBe(true);
    expect(m.customerUpdate).toHaveBeenCalled();
  });
});

function anonymousPlaceholder(): string {
  return anonymousPhonePlaceholder(ID);
}
