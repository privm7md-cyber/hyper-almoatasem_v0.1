// @vitest-environment node
// P1208-D01 Task 2 — `patchCustomer` audit payload data minimization.
//
// Contract under test:
//   * `tx.customer.update` still writes exact patched fields to `customers`;
//   * `customers.update` audit rows record `changedFields` + non-PII operational
//     booleans (`autoAcceptReplacements`, `isActive`) — NEVER raw `firstName`,
//     `lastName`, or `email` values;
//   * `scrubAuditValues` preserves `changedFields` and non-PII booleans;
//   * duplicate email (`P2002`) -> 409 CONFLICT; missing row (`P2025`) -> null.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const m = vi.hoisted(() => ({
  transaction: vi.fn(),
  customerUpdate: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: { $transaction: m.transaction } }));
vi.mock("@/lib/api/audit", () => ({ auditInTx: m.audit }));

import { patchCustomer } from "../writes";
import { scrubAuditValues } from "../anonymize";

const CUSTOMER_ID = "00000000-0000-4000-8000-000000000011";
const ACTOR_ID = "00000000-0000-4000-8000-0000000000aa";

beforeEach(() => {
  vi.resetAllMocks();
  const tx = { customer: { update: m.customerUpdate } };
  m.transaction.mockImplementation(async (fn: (client: typeof tx) => unknown) => fn(tx));
  m.audit.mockResolvedValue(undefined);
});

describe("patchCustomer — PII-minimized customers.update audit payload", () => {
  it("persists all patched customer fields while omitting raw firstName/lastName/email from audit newValues", async () => {
    const updatedRow = {
      id: CUSTOMER_ID,
      firstName: "سارة",
      lastName: "محمود",
      email: "sara.synthetic@example.invalid",
      autoAcceptReplacements: true,
      isActive: false,
    };
    m.customerUpdate.mockResolvedValue(updatedRow);

    const res = await patchCustomer(
      CUSTOMER_ID,
      {
        firstName: "سارة",
        lastName: "محمود",
        email: "sara.synthetic@example.invalid",
        autoAcceptReplacements: true,
        isActive: false,
      },
      ACTOR_ID,
    );

    expect(res).toEqual(updatedRow);
    expect(m.customerUpdate).toHaveBeenCalledWith({
      where: { id: CUSTOMER_ID },
      data: {
        firstName: "سارة",
        lastName: "محمود",
        email: "sara.synthetic@example.invalid",
        autoAcceptReplacements: true,
        isActive: false,
      },
    });

    expect(m.audit).toHaveBeenCalledTimes(1);
    const auditEvent = m.audit.mock.calls[0][1] as {
      action: string;
      userId: string;
      entityType: string;
      entityId: string;
      oldValues: unknown;
      newValues: Record<string, unknown>;
    };
    expect(auditEvent.action).toBe("customers.update");
    expect(auditEvent.userId).toBe(ACTOR_ID);
    expect(auditEvent.entityType).toBe("customers");
    expect(auditEvent.entityId).toBe(CUSTOMER_ID);
    expect(auditEvent.oldValues).toBeNull();
    expect(auditEvent.newValues).toEqual({
      changedFields: ["firstName", "lastName", "email", "autoAcceptReplacements", "isActive"],
      autoAcceptReplacements: true,
      isActive: false,
    });

    const serialized = JSON.stringify(auditEvent);
    expect(serialized).not.toContain("سارة");
    expect(serialized).not.toContain("محمود");
    expect(serialized).not.toContain("sara.synthetic@example.invalid");
  });

  it("records only changedFields when editing or clearing identity fields without boolean flags", async () => {
    m.customerUpdate.mockResolvedValue({
      id: CUSTOMER_ID,
      firstName: "خالد",
      lastName: null,
      email: null,
    });

    await patchCustomer(
      CUSTOMER_ID,
      { firstName: "خالد", lastName: null, email: null },
      ACTOR_ID,
    );

    const auditEvent = m.audit.mock.calls[0][1] as { newValues: Record<string, unknown> };
    expect(auditEvent.newValues).toEqual({
      changedFields: ["firstName", "lastName", "email"],
    });
    expect(JSON.stringify(auditEvent)).not.toContain("خالد");

    // Ensure scrubAuditValues keeps changedFields metadata intact if later scrubbed:
    expect(scrubAuditValues(auditEvent.newValues)).toEqual({
      changedFields: ["firstName", "lastName", "email"],
    });
  });

  it("preserves 409 CONFLICT on duplicate email and null on missing customer", async () => {
    m.customerUpdate.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "7.10.0",
      }),
    );
    await expect(
      patchCustomer(CUSTOMER_ID, { email: "dup@example.invalid" }, ACTOR_ID),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    m.customerUpdate.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Record to update not found", {
        code: "P2025",
        clientVersion: "7.10.0",
      }),
    );
    await expect(
      patchCustomer(CUSTOMER_ID, { firstName: "غير موجود" }, ACTOR_ID),
    ).resolves.toBeNull();
  });
});
