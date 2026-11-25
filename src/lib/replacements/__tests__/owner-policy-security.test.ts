// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { $transaction: m.transaction } }));
vi.mock("@/lib/api/audit", () => ({ auditInTx: vi.fn() }));

import {
  parseStoredAlternatives,
  parseStoredAlternativesEnvelope,
  proposeInputSchema,
  serializeStoredAlternatives,
  type StoredAlternative,
} from "@/lib/replacements/validation";
import { rejectAllProposedReplacements } from "@/lib/replacements/writes";

const ORDER = "11111111-1111-4111-8111-111111111111";
const ITEM = "22222222-2222-4222-8222-222222222222";
const VARIANT = "33333333-3333-4333-8333-333333333333";

const alternative: StoredAlternative = {
  variantId: VARIANT,
  quantity: "2.000",
  reason: "اقتراح موثق",
  price: "15.50",
  priceDifference: "2.00",
  variantName: "عبوة كبيرة",
  productName: "منتج بديل",
  sizeValue: "500",
  unit: "PIECE",
  productType: "PIECE",
};

describe("replacement JSON compatibility and security", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stores a bounded versioned envelope and retains the chosen alternative index", () => {
    const stored = serializeStoredAlternatives([alternative, { ...alternative, variantId: ORDER }], "رسالة العرض", 1);
    expect(parseStoredAlternativesEnvelope(stored)).toMatchObject({
      version: 1,
      proposalReason: "رسالة العرض",
      chosenIndex: 1,
      alternatives: [{ productName: "منتج بديل" }, { variantId: ORDER }],
    });
  });

  it("keeps historical plain reason strings readable and rejects arbitrary or oversized JSON", () => {
    expect(parseStoredAlternatives("سبب قديم كنص")).toEqual([]);
    expect(parseStoredAlternatives(JSON.stringify([{ variantId: VARIANT, quantity: "2", arbitrary: true }]))).toEqual([]);
    expect(parseStoredAlternatives("x".repeat(32_769))).toEqual([]);
  });

  it("accepts the strictly validated legacy array produced by the prior execution", () => {
    expect(parseStoredAlternatives(JSON.stringify([alternative]))).toEqual([alternative]);
  });

  it("rejects repeated alternative product ids before any write", () => {
    expect(proposeInputSchema.safeParse({
      alternatives: [
        { replacementVariantId: VARIANT, replacementQuantity: "1" },
        { replacementVariantId: VARIANT, replacementQuantity: "2" },
      ],
    }).success).toBe(false);
  });

  it("binds reject-all to both the order-item id and the expected URL order id", async () => {
    const calls: string[] = [];
    const queryRaw = vi.fn((strings: TemplateStringsArray) => {
      calls.push(strings.join("?"));
      return Promise.resolve([]);
    });
    m.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({ $queryRaw: queryRaw }));
    await expect(rejectAllProposedReplacements({
      expectedOrderId: ORDER,
      orderItemId: ITEM,
      deciderType: "GUEST",
      deciderId: null,
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(calls[0]).toContain("o.id =");
    expect(calls[0]).toContain("i.id =");
  });
});
