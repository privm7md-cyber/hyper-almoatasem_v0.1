// ADM-OWNER — the integration review of the three policies against
// ADM-03 … ADM-07 (owner checklist, 12 Nov 2026).
//
// The ten checks are pinned here. Where a check is about the wiring between
// two modules (the selector is the SAME function in checkout and preview; the
// tie-break order; the frozen Phase-4 evaluator), the assertion is made on
// the source AND on the behaviour, and the source-level part is labelled as
// such — it is not a claim about a running system.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
  inventoryMovementDeleteMany: vi.fn(),
  orderDiscountDeleteMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: { $transaction: m.transaction } }));
vi.mock("@/lib/api/audit", () => ({ auditInTx: m.audit }));
vi.mock("@/lib/auth/admin-read-only-preview", () => ({
  assertAdminPreviewWritesAllowed: vi.fn(),
  isAdminReadOnlyPreviewConfigured: () => false,
}));

import { anonymizeCustomer, ANONYMIZATION_MODE } from "@/lib/customers/anonymize";
import { comparePromoCandidates, evaluateLines, selectWinningOffer, winningOfferSet, type EvalLine, type EvalPromo } from "@/lib/promotions/engine";
import { NON_BLOCKING_AUDIT_ACTIONS, classifyAuditAction } from "@/lib/catalog/hard-delete";
import { PERMISSION_GROUPS } from "@/lib/admin/terminology";

const ROOT = resolve(__dirname, "../../../..");
const ID = "00000000-0000-4000-8000-000000000001";
const ACTOR = "00000000-0000-4000-8000-0000000000aa";
const TOKEN = "2026-11-12T10:00:00.000Z";
const input = { confirmed: true, reason: "سبب", expectedUpdatedAt: TOKEN };

function tx() {
  return {
    $queryRaw: m.raw,
    customer: { findUnique: m.customerFindUnique, update: m.customerUpdate },
    customerAddress: { deleteMany: m.addressDeleteMany },
    customerSession: { deleteMany: m.sessionDeleteMany },
    order: { findMany: m.orderFindMany, update: m.orderUpdate },
    auditLog: { findMany: m.auditFindMany, update: m.auditUpdate },
    inventoryMovement: { deleteMany: m.inventoryMovementDeleteMany },
    orderDiscount: { deleteMany: m.orderDiscountDeleteMany },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  m.transaction.mockImplementation((fn: (t: unknown) => unknown) => fn(tx()));
  m.raw.mockImplementation(async (strings: TemplateStringsArray) => {
    const sql = strings.join(" ").replace(/\s+/g, " ");
    if (sql.includes("customer_auth_rate_limits")) return [{ count: 1 }];
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
    args.where?.status?.in ? [] : [{ id: "order-1", notes: "ملاحظة" }],
  );
  m.orderUpdate.mockResolvedValue({});
  m.auditFindMany.mockResolvedValue([]);
  m.auditUpdate.mockResolvedValue({});
  m.audit.mockResolvedValue(undefined);
});

function offer(overrides: Partial<EvalPromo> = {}): EvalPromo {
  return {
    id: "offer-1",
    type: "PERCENTAGE",
    scope: "LINE",
    priority: 10,
    isStackable: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    targets: [{ tt: "PRODUCT", tid: "product-1" }],
    discountPercentH: 2000,
    discountAmountC: null,
    fixedPriceC: null,
    minimumQuantityT: null,
    minimumAmountC: null,
    maximumDiscountC: null,
    buyQtyT: null,
    getQtyT: null,
    buyPctH: null,
    freeVariantId: null,
    usageLimit: null,
    inSubtree: () => false,
    ...overrides,
  };
}

function line(): EvalLine {
  return {
    key: "variant-1",
    ctx: { vid: "variant-1", pid: "product-1", bid: null, cid: "cat-1", pt: "PIECE", pu: "PIECE", su: null },
    qtyT: 1000,
    grossC: 10000,
    netC: 10000,
    unitPriceC: 10000,
  };
}

describe("integration review of the three policies (owner checklist)", () => {
  it("1 — anonymization does not change any past order's value", async () => {
    await anonymizeCustomer(ID, input as never, ACTOR);
    const update = m.orderUpdate.mock.calls[0][0].data as Record<string, unknown>;
    for (const money of ["totalFinal", "totalEstimated", "subtotalFinal", "subtotalEstimated", "discountTotal", "deliveryFee"]) {
      expect(update[money], money).toBeUndefined();
    }
    expect(update.items).toBeUndefined();
    // Only the identity, the delivery contact details and the free text change.
    expect(Object.keys(update).sort()).toEqual(
      ["customerNameSnapshot", "customerPhoneSnapshot", "deliveryArea", "deliveryBuilding", "deliveryLandmark", "deliveryPhone", "deliveryStreet", "deliveryVillage", "notes"].sort(),
    );
  });

  it("2 — anonymization does not delete a stock movement or a financial record", async () => {
    await anonymizeCustomer(ID, input as never, ACTOR);
    expect(m.inventoryMovementDeleteMany).not.toHaveBeenCalled();
    expect(m.orderDiscountDeleteMany).not.toHaveBeenCalled();
    // The service has no delete path for them at all.
    const source = readFileSync(resolve(ROOT, "src/lib/customers/anonymize.ts"), "utf8");
    expect(source).not.toMatch(/inventoryMovement\.deleteMany/);
    expect(source).not.toMatch(/orderDiscount\.deleteMany/);
  });

  it("3 — deleting an unreferenced product does not delete the audit trail", () => {
    const source = readFileSync(resolve(ROOT, "src/lib/catalog/hard-delete.ts"), "utf8");
    // No audit delete anywhere in the delete path.
    expect(source).not.toMatch(/auditLog\.deleteMany/);
    expect(source).toMatch(/auditInTx\(tx, \{\s*\n?\s*action: "products\.hard_delete"/);
  });

  it("4 — a product with protected history is classified as blocking", () => {
    expect(classifyAuditAction("variants.price")).toBe("PROTECTED");
    expect(classifyAuditAction("inventory.adjust")).toBe("PROTECTED");
    expect(classifyAuditAction("products.archive")).toBe("METADATA");
    expect(NON_BLOCKING_AUDIT_ACTIONS.length).toBeGreaterThan(5);
  });

  it("5 — the customer capabilities stay separate: manage never implies anonymize", () => {
    const keys = PERMISSION_GROUPS.flatMap((group) => group.permissions.map((p) => p.key));
    expect(keys).toContain("customers.manage");
    expect(keys).toContain("customers.anonymize");
    const route = readFileSync(resolve(ROOT, "src/app/api/admin/customers/[id]/anonymize/route.ts"), "utf8");
    expect(route).toContain('adminOrDeny("customers.anonymize")');
    expect(route).not.toContain('adminOrDeny("customers.manage")');
  });

  it("6 — the SAME selector backs the checkout and the preview (source-level)", () => {
    const checkout = readFileSync(resolve(ROOT, "src/lib/promotions/checkout.ts"), "utf8");
    const preview = readFileSync(resolve(ROOT, "src/lib/promotions/admin-preview.ts"), "utf8");
    const engine = readFileSync(resolve(ROOT, "src/lib/promotions/engine.ts"), "utf8");
    expect(engine).toContain("export function selectWinningOffer");
    expect(engine).toContain("export function winningOfferSet");
    expect(checkout).toContain("winningOfferSet(evalLines, live)");
    expect(preview).toContain("selectWinningOffer([work], promos)");
  });

  it("7 — the tie-break order is fixed: priority → specificity → created_at → id", () => {
    const a = { promo: offer({ id: "a", priority: 10, createdAt: "2026-01-01T00:00:00.000Z" }), layer: "LINE" as const, spec: 1, eligible: true, reason: null };
    const b = { promo: offer({ id: "b", priority: 10, createdAt: "2026-01-01T00:00:00.000Z" }), layer: "LINE" as const, spec: 2, eligible: true, reason: null };
    // Same priority → the more specific target wins.
    expect(comparePromoCandidates(a, b)).toBeGreaterThan(0);
    const older = { ...a, promo: offer({ id: "c", createdAt: "2020-01-01T00:00:00.000Z" }) };
    const newer = { ...a, promo: offer({ id: "d", createdAt: "2026-06-01T00:00:00.000Z" }) };
    // Same priority and specificity → the older offer wins (created_at ASC).
    expect(comparePromoCandidates(older, newer)).toBeLessThan(0);
    const engine = readFileSync(resolve(ROOT, "src/lib/promotions/engine.ts"), "utf8");
    expect(engine).toContain("b.promo.priority - a.promo.priority");
    expect(engine).toContain("b.spec - a.spec");
  });

  it("8 — there is no automatic stacking: only the winner reaches the evaluator", () => {
    const high = offer({ id: "high", priority: 50, discountPercentH: 2000 });
    const low = offer({ id: "low", priority: 5, discountPercentH: 5000 });
    const work = [line()];
    const offered = winningOfferSet(work, [low, high]);
    expect(offered).toHaveLength(1);
    expect(offered[0].id).toBe("high");
    const rows = evaluateLines(work, offered).rows;
    // One line, one discount — the 50% offer never adds a second discount.
    expect(rows).toHaveLength(1);
    expect(work[0].netC).toBe(8000);
    expect(selectWinningOffer([line()], [low, high]).winner?.promo.id).toBe("high");
  });

  it("9 — the coupon layer is a separate instrument with an explicit combination rule", () => {
    const checkout = readFileSync(resolve(ROOT, "src/lib/promotions/checkout.ts"), "utf8");
    const engine = readFileSync(resolve(ROOT, "src/lib/promotions/engine.ts"), "utf8");
    const evaluator = readFileSync(resolve(ROOT, "src/lib/promotions/coupon-eligibility.ts"), "utf8");
    // The rule is named, single-sourced, and used by BOTH price paths. ADM-08
    // moved the two former copies into ONE evaluator, so the rule is called
    // exactly once there and the evaluator is called by checkout + estimate.
    expect(engine).toContain("COUPON_COMBINATION_POLICY");
    expect(engine).toContain("combinesWithAutomaticWinner: false");
    expect((evaluator.match(/couponCombinationAllowed\(/g) ?? []).length).toBe(1);
    expect((checkout.match(/evaluateCouponEligibility\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
    // The coupon still runs after the automatic layers (its own layer).
    const autoLayer = checkout.indexOf("const offered = winningOfferSet");
    const couponLayer = checkout.indexOf("couponApp = await applyCoupon(");
    expect(autoLayer).toBeGreaterThan(-1);
    expect(couponLayer).toBeGreaterThan(autoLayer);
  });

  it("10 — the frozen Phase-4 evaluator is unchanged: the policy lives one layer above", () => {
    const engine = readFileSync(resolve(ROOT, "src/lib/promotions/engine.ts"), "utf8");
    // The pure evaluator keeps its stacking capability (the frozen doubles
    // pin it); the one-winner rule is applied by the selection layer.
    expect(engine).toContain("if (!(acc.length === 0 || (p.isStackable && acc.every((a) => a.stackable)))) continue;");
    expect(engine).toContain("PROMOTION_POLICY");
    // The frozen Phase-4 test file is untouched by the policy.
    const frozen = readFileSync(resolve(ROOT, "db/tests/run-phase4-tests.js"), "utf8");
    expect(frozen).toContain("STACK sequential 30→24→22.80");
  });

  it("the anonymization reports its mode honestly", async () => {
    const result = await anonymizeCustomer(ID, input as never, ACTOR);
    expect(result.mode).toBe(ANONYMIZATION_MODE);
    expect(ANONYMIZATION_MODE).toBe("PSEUDONYMIZED");
  });
});
