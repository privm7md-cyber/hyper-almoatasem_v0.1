// @vitest-environment node
// ADM-OWNER G3 — customer ANONYMIZATION (contract of the closed implementation).
//
// The acceptance list of the owner's decision:
//   • the direct identity data is gone from the customer file
//   • the removed contact data cannot be searched for any more
//   • the historical orders stay and keep their technical link, without
//     revealing the identity from the fields that were removed
//   • prices, quantities, discounts and totals of past orders do not change
//   • inventory, financial and audit records are not deleted by anonymization
//   • no unintended copy of the identity survives in notes or other copies
//   • the new audit row contains NO copy of the original name/phone/email
//   • the removed data cannot be restored through the application
//   • repeating the operation is safe
//   • guest orders are never attached to the customer
//   • the retained PII is marked as restricted, not as fully anonymous
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
  ANONYMIZATION_MODE,
  CUSTOMER_DATA_RETENTION_MATRIX,
  PRIVACY_REMOVED_TEXT,
  anonymizeCustomer,
  anonymousPhonePlaceholder,
  phoneScopeHash,
  scrubAuditValues,
  type AnonymizeInput,
} from "../anonymize";

const ID = "00000000-0000-4000-8000-000000000001";
const ACTOR = "00000000-0000-4000-8000-0000000000aa";
const TOKEN = "2026-11-12T10:00:00.000Z";

const input: AnonymizeInput = { confirmed: true, reason: "طلب من صاحب المتجر لإخفاء هوية العميل", expectedUpdatedAt: TOKEN };

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
  m.transaction.mockImplementation((fn: (t: unknown) => unknown) => fn(tx()));
  m.raw.mockImplementation(async (strings: TemplateStringsArray) => {
    const sql = strings.join(" ").replace(/\s+/g, " ");
    if (sql.includes("customer_auth_rate_limits")) return [{ count: 3 }];
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
  m.addressDeleteMany.mockResolvedValue({ count: 2 });
  m.sessionDeleteMany.mockResolvedValue({ count: 3 });
  // No open order by default; the closed ones carry the history. The mock
  // answers by the query shape (the open-order probe filters on the status).
  m.orderFindMany.mockImplementation(async (args: { where?: { status?: { in?: string[] } } }) =>
    args.where?.status?.in ? [] : [{ id: "order-1", notes: "الاتصال قبل التوصيل" }],
  );
  m.orderUpdate.mockResolvedValue({});
  m.auditFindMany.mockResolvedValue([
    { id: "audit-1", oldValues: { phone: "201000000000" }, newValues: { email: "ahmed@example.test" } },
  ]);
  m.auditUpdate.mockResolvedValue({});
  m.audit.mockResolvedValue(undefined);
});

describe("G3 — customer anonymization", () => {
  it("removes the direct identity and replaces it with a generic label", async () => {
    const result = await anonymizeCustomer(ID, input, ACTOR);
    expect(result.anonymized).toBe(true);
    const update = m.customerUpdate.mock.calls[0][0].data as Record<string, unknown>;
    expect(update.firstName).toBe(ANONYMIZED_DISPLAY_NAME);
    expect(update.lastName).toBeNull();
    expect(update.email).toBeNull();
    expect(update.passwordHash).toBeNull();
    expect(update.phone).toBe(anonymousPhonePlaceholder(ID));
    expect(update.isRegistered).toBe(false);
    expect(update.isActive).toBe(false);
    expect(update.deletedAt).toBeInstanceOf(Date);
  });

  it("the placeholder is derived from the technical id, never from the phone, and satisfies DB phone CHECK ^[0-9]{8,15}$ (P1208-D03)", async () => {
    const { isIdentityPhone } = await import("../phone");
    const placeholder = anonymousPhonePlaceholder(ID);
    expect(placeholder).not.toContain("201000000000");
    expect(placeholder).toMatch(/^000[0-9]{12}$/);
    expect(placeholder).toMatch(/^[0-9]{8,15}$/);
    expect(isIdentityPhone(placeholder)).toBe(false);
    expect(anonymousPhonePlaceholder(ID)).toBe(placeholder);
    expect(anonymousPhonePlaceholder("22222222-2222-4222-8222-222222222222")).not.toBe(placeholder);
    // Same-millisecond UUIDv7s (identical first 12 hex digits) still get distinct placeholders:
    expect(anonymousPhonePlaceholder("018f0000-0000-7000-8000-000000000001")).not.toBe(
      anonymousPhonePlaceholder("018f0000-0000-7000-8000-000000000002"),
    );
  });

  it("removes the address book, revokes the sessions and clears the phone-derived rate-limit buckets", async () => {
    const result = await anonymizeCustomer(ID, input, ACTOR);
    expect(m.addressDeleteMany).toHaveBeenCalledWith({ where: { customerId: ID } });
    expect(m.sessionDeleteMany).toHaveBeenCalledWith({ where: { customerId: ID } });
    expect(result.removed.addresses).toBe(2);
    expect(result.removed.sessions).toBe(3);
    expect(result.removed.rateLimitBuckets).toBe(3);
    // The bucket keys are the phone-derived ones (raw phone + the scope hash).
    // The bucket keys are VALUES (interpolated), not SQL text: the raw phone
    // and the scope hash.
    const bucketCall = m.raw.mock.calls.find((call) => call[0].join(" ").includes("customer_auth_rate_limits"));
    expect(bucketCall).toBeDefined();
    const values = bucketCall!.slice(1).map((value) => String(value));
    expect(values.some((value) => value.startsWith("login:cust-acct:"))).toBe(true);
    expect(values.some((value) => value.startsWith("identify:cust-phone:"))).toBe(true);
    expect(values.some((value) => value.startsWith("identify:cust-ip:target:"))).toBe(true);
    expect(values.some((value) => value.startsWith("reg:cust-ip:target:"))).toBe(true);
    expect(values.some((value) => value.includes("201000000000"))).toBe(true);
    expect(phoneScopeHash("201000000000")).toHaveLength(24);
  });

  it("keeps the orders and their money, and only replaces the identity snapshots", async () => {
    const result = await anonymizeCustomer(ID, input, ACTOR);
    expect(m.orderFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { customerId: ID } }));
    const update = m.orderUpdate.mock.calls[0][0].data as Record<string, unknown>;
    expect(update.customerNameSnapshot).toBe(ANONYMIZED_DISPLAY_NAME);
    expect(update.customerPhoneSnapshot).toBe(anonymousPhonePlaceholder(ID));
    expect(update.totalFinal).toBeUndefined();
    expect(update.totalEstimated).toBeUndefined();
    expect(update.subtotalFinal).toBeUndefined();
    expect(update.items).toBeUndefined();
    expect(result.removed.orderRows).toBe(1);
  });

  it("scrubs the customer's own audit trail without deleting it", async () => {
    await anonymizeCustomer(ID, input, ACTOR);
    expect(m.auditFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { entityType: "customers", entityId: ID } }),
    );
    expect(m.auditUpdate).toHaveBeenCalledTimes(1);
    const update = m.auditUpdate.mock.calls[0][0].data as Record<string, unknown>;
    expect(JSON.stringify(update)).not.toContain("201000000000");
    expect(JSON.stringify(update)).not.toContain("ahmed@example.test");
  });

  it("the new audit row carries WHO/WHEN/WHY and not one copy of the removed data", async () => {
    await anonymizeCustomer(ID, input, ACTOR);
    const auditRow = m.audit.mock.calls[0][1] as Record<string, unknown>;
    expect(auditRow.action).toBe("customers.anonymize");
    expect(auditRow.userId).toBe(ACTOR);
    expect(auditRow.reason).toBe(input.reason);
    const serialized = JSON.stringify(auditRow);
    expect(serialized).not.toContain("201000000000");
    expect(serialized).not.toContain("ahmed@example.test");
    expect(serialized).not.toContain("أحمد");
    expect(serialized).not.toContain("علي");
  });

  it("never links guest orders to the customer", async () => {
    await anonymizeCustomer(ID, input, ACTOR);
    expect(m.orderFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { customerId: ID } }));
    const sql = m.raw.mock.calls.map((call) => call[0].join("?")).join(" | ");
    expect(sql).toMatch(/FROM customers WHERE id = \?::uuid FOR UPDATE/);
  });

  it("free text is REPLACED entirely — a regex would not be trustworthy on free Arabic text", async () => {
    await anonymizeCustomer(ID, input, ACTOR);
    const update = m.orderUpdate.mock.calls[0][0].data as Record<string, unknown>;
    expect(update.notes).toBe(PRIVACY_REMOVED_TEXT);
    expect(String(update.notes)).not.toContain("الاتصال");
  });

  it("scrubs the identifying values out of audit payloads by field name", () => {
    const scrubbed = scrubAuditValues({ phone: "201000000000", email: "a@b.test", other: "kept" }) as Record<string, unknown>;
    expect(scrubbed.phone).not.toContain("201000000000");
    expect(scrubbed.email).not.toContain("a@b.test");
    expect(scrubbed.other).toBe("kept");
  });

  it("marks the retained personal data as restricted, not as fully anonymous", async () => {
    const result = await anonymizeCustomer(ID, input, ACTOR);
    expect(result.restrictedRetained.length).toBeGreaterThan(0);
    const matrix = CUSTOMER_DATA_RETENTION_MATRIX.filter((entry) => entry.restricted);
    expect(matrix.length).toBeGreaterThan(0);
    for (const entry of matrix) {
      expect(entry.action).toBe("LEGAL_REVIEW_REQUIRED");
      expect(entry.accessScope?.length ?? 0).toBeGreaterThan(3);
      expect(entry.requiredPermission?.length ?? 0).toBeGreaterThan(3);
    }
    for (const retained of result.restrictedRetained) {
      expect(retained.accessScope.length).toBeGreaterThan(3);
      expect(retained.requiredPermission.length).toBeGreaterThan(3);
    }
  });

  it("reports the mode honestly: the technical link stays, so it is pseudonymized", async () => {
    const result = await anonymizeCustomer(ID, input, ACTOR);
    expect(result.mode).toBe("PSEUDONYMIZED");
    expect(ANONYMIZATION_MODE).toBe("PSEUDONYMIZED");
  });

  it("repeating the operation is safe and does not damage anything", async () => {
    const first = await anonymizeCustomer(ID, input, ACTOR);
    expect(first.alreadyAnonymized).toBe(false);
    m.customerFindUnique.mockResolvedValue({
      id: ID,
      firstName: ANONYMIZED_DISPLAY_NAME,
      lastName: null,
      phone: anonymousPhonePlaceholder(ID),
      email: null,
      passwordHash: null,
      isRegistered: false,
      lockedUntil: null,
      isActive: false,
      deletedAt: new Date(TOKEN),
      updatedAt: new Date(TOKEN),
    });
    const second = await anonymizeCustomer(ID, input, ACTOR);
    expect(second.anonymized).toBe(true);
    expect(second.alreadyAnonymized).toBe(true);
  });

  it("a stale concurrency token is refused, and nothing is changed", async () => {
    await expect(
      anonymizeCustomer(ID, { ...input, expectedUpdatedAt: "2020-01-01T00:00:00.000Z" }, ACTOR),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(m.customerUpdate).not.toHaveBeenCalled();
    expect(m.addressDeleteMany).not.toHaveBeenCalled();
  });

  it("requires a reason and an explicit confirmation", async () => {
    await expect(anonymizeCustomer(ID, { ...input, reason: " " }, ACTOR)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      anonymizeCustomer(ID, { ...input, confirmed: false } as unknown as AnonymizeInput, ACTOR),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(m.customerUpdate).not.toHaveBeenCalled();
  });

  it("the retention matrix covers every copy the operation touches", () => {
    const locations = CUSTOMER_DATA_RETENTION_MATRIX.map((entry) => entry.location);
    for (const expected of [
      "customers.first_name",
      "customers.last_name",
      "customers.phone",
      "customers.email",
      "customer_addresses.street",
      "customer_addresses.phone",
      "customer_sessions.token_hash",
      "customer_auth_rate_limits.bucket_key",
      "orders.customer_name_snapshot",
      "orders.customer_phone_snapshot",
      "orders.delivery_phone",
      "orders.delivery_street",
      "orders.delivery_area",
      "orders.delivery_city",
      "orders.notes",
    ]) {
      expect(locations).toContain(expected);
    }
    for (const entry of CUSTOMER_DATA_RETENTION_MATRIX) {
      expect(entry.reason.length).toBeGreaterThan(10);
      expect(entry.label.length).toBeGreaterThan(3);
    }
  });
});
