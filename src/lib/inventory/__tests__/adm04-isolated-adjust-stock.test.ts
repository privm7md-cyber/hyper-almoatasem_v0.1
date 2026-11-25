// @vitest-environment node
// SQL/transaction contract doubles only: no client, DB or live concurrency.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";

const m = vi.hoisted(() => ({
  transaction: vi.fn(), query: vi.fn(), execute: vi.fn(), audit: vi.fn(),
  context: vi.fn(), preview: vi.fn(), completed: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: { $transaction: m.transaction } }));
vi.mock("@/lib/api/audit", () => ({ auditInTx: m.audit, serializeAuditValue: vi.fn() }));
vi.mock("@/lib/inventory/queries", () => ({ getVariantStockContext: m.context }));
vi.mock("@/lib/auth/admin-read-only-preview", () => ({ assertAdminPreviewWritesAllowed: m.preview }));
import { adjustStock, type AdjustArgs } from "../service";
import { isStepMultiple } from "../quantities";

type Safe = NonNullable<Parameters<typeof adjustStock>[1]>;
const VARIANT = "abcdefab-1234-4000-8000-000000000001";
const REQUEST = "abcdefab-1234-4000-8000-000000000002";
const ACTOR = "abcdefab-1234-4000-8000-000000000003";
const INVENTORY = "abcdefab-1234-4000-8000-000000000004";
const MOVEMENT = "abcdefab-1234-4000-8000-000000000005";
const args: AdjustArgs = {
  variantId: VARIANT, delta: "2.000", movementType: "ADJUSTMENT",
  referenceType: "MANUAL", referenceId: REQUEST, reason: "Stock count", actorId: ACTOR,
};
const safe: Safe = { requestId: REQUEST, expectedQuantity: "10.000", confirmed: true };
const tx = { $queryRaw: m.query, $executeRaw: m.execute };
const lock = (quantity = "10.000", reserved = "3.000") => [{ id: INVENTORY, quantity, reserved_quantity: reserved }];
const prior = () => ({
  id: MOVEMENT, quantity: "2.000", previous_quantity: "10.000", new_quantity: "12.000",
  movement_type: "ADJUSTMENT", reason: "Stock count", created_by: ACTOR,
});
const sql = (call: unknown[]) => (call[0] as TemplateStringsArray).join("?").replace(/\s+/g, " ").trim();
function noEffects() {
  expect(m.query.mock.calls.map(sql).some(text => /^UPDATE|^INSERT/.test(text))).toBe(false);
  expect(m.execute).not.toHaveBeenCalled();
  expect(m.audit).not.toHaveBeenCalled();
}
function plan(...responses: unknown[]) {
  m.query.mockReset().mockImplementation(() => { throw new Error("Unexpected SQL query"); });
  for (const response of responses) m.query.mockResolvedValueOnce(response);
}
function context(productType = "PIECE", sizeUnit: string | null = "PIECE", saleStepGrams: number | null = null) {
  return {
    id: VARIANT, isActive: true, deletedAt: null, sizeUnit,
    product: { productType, saleStepGrams, isActive: true, deletedAt: null },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  m.context.mockResolvedValue(context());
  plan(lock(), [], [{ nq: "12.000" }]);
  m.execute.mockResolvedValue(1);
  m.audit.mockResolvedValue(undefined);
  // Completion means the entire callback resolved, including audit. It is not
  // a simulation/proof of PostgreSQL commit or rollback behavior.
  m.transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => {
    const result = await callback(tx);
    m.completed();
    return result;
  });
});

describe("ADM04 safe adjustment SQL and audit pairing", () => {
  it("locks, checks the same variant/key, conditionally updates and pairs one movement/audit", async () => {
    const result = await adjustStock(args, safe);
    expect(result).toEqual({ movementId: expect.any(String), previousQuantity: "10.000", newQuantity: "12.000" });
    expect(result.movementId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(m.preview).toHaveBeenCalledOnce();
    expect(m.context).toHaveBeenCalledExactlyOnceWith(VARIANT);
    expect(m.preview.mock.invocationCallOrder[0]).toBeLessThan(m.context.mock.invocationCallOrder[0]);
    expect(m.context.mock.invocationCallOrder[0]).toBeLessThan(m.transaction.mock.invocationCallOrder[0]);
    expect(m.transaction).toHaveBeenCalledExactlyOnceWith(expect.any(Function));
    expect(m.query).toHaveBeenCalledTimes(3);
    expect(sql(m.query.mock.calls[0])).toMatch(/FROM inventory WHERE product_variant_id = \?::uuid FOR UPDATE$/);
    expect(m.query.mock.calls[0].slice(1)).toEqual([VARIANT]);
    expect(sql(m.query.mock.calls[1])).toContain("FROM inventory_movements WHERE product_variant_id = ?::uuid AND reference_type = 'MANUAL' AND reference_id = ?::varchar");
    expect(m.query.mock.calls[1].slice(1)).toEqual([VARIANT, REQUEST]);
    expect(sql(m.query.mock.calls[2])).toBe("UPDATE inventory SET quantity = quantity + ?::numeric WHERE product_variant_id = ?::uuid AND quantity + ?::numeric >= 0 AND reserved_quantity <= quantity + ?::numeric RETURNING quantity::text AS nq");
    expect(m.query.mock.calls[2].slice(1)).toEqual(["2.000", VARIANT, "2.000", "2.000"]);
    expect(m.execute).toHaveBeenCalledOnce();
    expect(sql(m.execute.mock.calls[0])).toContain("INSERT INTO inventory_movements (id, product_variant_id, movement_type, quantity, previous_quantity, new_quantity, reference_type, reference_id, reason, created_by)");
    expect(m.execute.mock.calls[0].slice(1)).toEqual([
      result.movementId, VARIANT, "ADJUSTMENT", "2.000", "10.000", "12.000", "MANUAL", REQUEST, "Stock count", ACTOR,
    ]);
    expect(m.audit).toHaveBeenCalledExactlyOnceWith(tx, {
      action: "inventory.adjust", userId: ACTOR, entityType: "inventory", entityId: INVENTORY,
      oldValues: { quantity: "10.000" },
      newValues: { delta: "2.000", quantity: "12.000", movementType: "ADJUSTMENT", referenceType: "MANUAL", requestId: REQUEST },
      reason: "Stock count",
    });
    expect(m.query.mock.invocationCallOrder[2]).toBeLessThan(m.execute.mock.invocationCallOrder[0]);
    expect(m.execute.mock.invocationCallOrder[0]).toBeLessThan(m.audit.mock.invocationCallOrder[0]);
    expect(m.audit.mock.invocationCallOrder[0]).toBeLessThan(m.completed.mock.invocationCallOrder[0]);
  });

  it.each(["12.000", "7.000"])("same-key replay at current balance %s returns the original outcome without effects", async (current) => {
    const first = await adjustStock(args, safe);
    m.query.mockResolvedValueOnce(lock(current)).mockResolvedValueOnce([{ ...prior(), id: first.movementId }]);
    const replay = await adjustStock(args, safe);
    expect(replay).toEqual(first);
    expect(replay.newQuantity).toBe("12.000");
    expect(m.query).toHaveBeenCalledTimes(5);
    expect(sql(m.query.mock.calls[3])).toContain("FOR UPDATE");
    expect(sql(m.query.mock.calls[4])).toContain("FROM inventory_movements");
    expect(m.execute).toHaveBeenCalledOnce();
    expect(m.audit).toHaveBeenCalledOnce();
    expect(m.transaction).toHaveBeenCalledTimes(2);
  });

  it("replays numerically identical terms, UUID case and trimmed reason", async () => {
    plan(lock("7.000"), [prior()]);
    expect(await adjustStock({
      ...args, variantId: VARIANT.toUpperCase(), referenceId: REQUEST.toUpperCase(),
      actorId: ACTOR.toUpperCase(), delta: "02", reason: "  Stock count  ",
    }, { ...safe, requestId: REQUEST.toUpperCase(), expectedQuantity: "010" })).toEqual({
      movementId: MOVEMENT, previousQuantity: "10.000", newQuantity: "12.000",
    });
    expect(m.context).toHaveBeenCalledWith(VARIANT);
    expect(m.query.mock.calls[1].slice(1)).toEqual([VARIANT, REQUEST]);
    noEffects();
  });

  it.each([
    { label: "delta", patch: { delta: "3" } },
    { label: "movement type", patch: { movementType: "RETURN" as const } },
    { label: "reason", patch: { reason: "Different count" } },
    { label: "actor", patch: { actorId: INVENTORY } },
  ])("same key with changed $label conflicts before the stale-balance check", async ({ patch }) => {
    plan(lock("7.000"), [prior()]);
    await expect(adjustStock({ ...args, ...patch }, safe)).rejects.toMatchObject({
      code: "CONFLICT", message: "Request key already used with different terms.", retryable: true,
    });
    expect(m.query).toHaveBeenCalledTimes(2);
    noEffects();
  });

  it("same key with a different expected previous quantity conflicts even when it matches current stock", async () => {
    plan(lock("7.000"), [prior()]);
    await expect(adjustStock(args, { ...safe, expectedQuantity: "7" })).rejects.toMatchObject({
      code: "CONFLICT", message: "Request key already used with different terms.",
    });
    noEffects();
  });

  it.each(["duplicate key", "missing actor"])("does not replay ambiguous history: %s", async (kind) => {
    plan(lock(), kind === "duplicate key" ? [prior(), prior()] : [{ ...prior(), created_by: null }]);
    await expect(adjustStock(args, safe)).rejects.toMatchObject({ code: "CONFLICT" });
    noEffects();
  });

  it("a fresh key with stale expected quantity conflicts without mutation", async () => {
    plan(lock("9.000"), []);
    await expect(adjustStock(args, safe)).rejects.toMatchObject({ code: "CONFLICT", message: "Balance changed; re-read before adjusting." });
    expect(m.query).toHaveBeenCalledTimes(2);
    noEffects();
  });

  it("missing inventory returns NOT_FOUND and never creates a balance or movement", async () => {
    plan([]);
    await expect(adjustStock(args, safe)).rejects.toMatchObject({ code: "NOT_FOUND", message: "Inventory not found." });
    expect(m.query).toHaveBeenCalledOnce();
    noEffects();
    expect(m.completed).not.toHaveBeenCalled();
  });

  it("missing variant fails before opening a transaction", async () => {
    m.context.mockResolvedValue(null);
    await expect(adjustStock(args, safe)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(m.transaction).not.toHaveBeenCalled();
    noEffects();
  });

  it.each([
    { label: "reserved breach", reserved: "9.000", delta: "-2" },
    { label: "negative balance", reserved: "0.000", delta: "-11" },
  ])("a failed conditional UPDATE for $label is 409 with no movement/audit", async ({ reserved, delta }) => {
    plan(lock("10.000", reserved), [], []);
    await expect(adjustStock({ ...args, delta }, safe)).rejects.toMatchObject({ code: "CONFLICT", details: { productVariantId: VARIANT } });
    expect(sql(m.query.mock.calls[2])).toContain("AND quantity + ?::numeric >= 0 AND reserved_quantity <= quantity + ?::numeric");
    expect(m.query.mock.calls[2].slice(1)).toEqual([delta, VARIANT, delta, delta]);
    expect(m.execute).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
    expect(m.completed).not.toHaveBeenCalled();
  });

  it.each(["movement", "audit"])("%s failure rejects the same transaction callback", async (stage) => {
    (stage === "movement" ? m.execute : m.audit).mockRejectedValue(new Error(`${stage} unavailable`));
    await expect(adjustStock(args, safe)).rejects.toThrow(`${stage} unavailable`);
    expect(m.completed).not.toHaveBeenCalled();
    if (stage === "movement") expect(m.audit).not.toHaveBeenCalled();
    else expect(m.audit.mock.calls[0][0]).toBe(tx);
  });

  it.each(["23514", "40P01", "40001"])("maps PostgreSQL guard %s to a conflict without retry", async (code) => {
    m.query.mockReset().mockRejectedValue({ code: "P2010", meta: { driverAdapterError: { cause: { originalCode: code } } } });
    await expect(adjustStock(args, safe)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(m.transaction).toHaveBeenCalledOnce();
    expect(m.execute).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
  });
});

describe("ADM04 safe service facts and before-DB gates", () => {
  it("preview rejection precedes validation, variant lookup, transaction and audit", async () => {
    m.preview.mockImplementation(() => { throw new ApiError("FORBIDDEN", "Admin read-only preview."); });
    await expect(adjustStock({ ...args, delta: "invalid" }, safe)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(m.context).not.toHaveBeenCalled();
    expect(m.transaction).not.toHaveBeenCalled();
    expect(m.query).not.toHaveBeenCalled();
    noEffects();
  });

  it.each([
    { delta: "0" }, { delta: "1000000000" }, { delta: "-1000000000" }, { delta: "0.0001" },
    { reason: " " }, { referenceType: "ORDER" }, { referenceId: INVENTORY }, { referenceId: null },
  ])("rejects invalid direct arguments before DB: %j", async (patch) => {
    await expect(adjustStock({ ...args, ...patch }, safe)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(m.context).not.toHaveBeenCalled();
    expect(m.transaction).not.toHaveBeenCalled();
    noEffects();
  });

  it.each([{ confirmed: false }, { expectedQuantity: "-1" }, { expectedQuantity: "1000000000" }, { requestId: "invalid" }])(
    "revalidates direct safe terms: %j", async (patch) => {
      await expect(adjustStock(args, { ...safe, ...patch } as Safe)).rejects.toMatchObject({ code: "VALIDATION" });
      expect(m.context).not.toHaveBeenCalled();
      expect(m.transaction).not.toHaveBeenCalled();
      noEffects();
    },
  );

  it.each([
    { delta: "0.500", expectedQuantity: "10" },
    { delta: "2", expectedQuantity: "10.500" },
  ])("PIECE rejects fractional delta or expected balance: %j", async ({ delta, expectedQuantity }) => {
    await expect(adjustStock({ ...args, delta }, { ...safe, expectedQuantity })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    expect(m.transaction).not.toHaveBeenCalled();
    noEffects();
  });

  it("PIECE accepts negative whole-pack decimal facts", async () => {
    plan(lock(), [], [{ nq: "8.000" }]);
    await expect(adjustStock({ ...args, delta: "-2.000" }, safe)).resolves.toMatchObject({ newQuantity: "8.000" });
    expect(m.execute.mock.calls[0][4]).toBe("-2.000");
  });

  it.each([
    { unit: "KG", delta: "0.475", next: "10.475" },
    { unit: "KG", delta: "-0.475", next: "9.525" },
    { unit: "GRAM", delta: "124.999", next: "134.999" },
  ])("WEIGHT $unit permits non-step counted fact $delta", async ({ unit, delta, next }) => {
    m.context.mockResolvedValue(context("WEIGHT", unit, 125));
    expect(isStepMultiple(delta, 125, unit)).toBe(false);
    plan(lock(), [], [{ nq: next }]);
    await expect(adjustStock({ ...args, delta }, safe)).resolves.toMatchObject({ previousQuantity: "10.000", newQuantity: next });
    expect(m.execute).toHaveBeenCalledOnce();
    expect(m.audit).toHaveBeenCalledOnce();
  });

  it("resulting balance above NUMERIC(12,3) is rejected before UPDATE", async () => {
    m.context.mockResolvedValue(context("WEIGHT", "KG", 125));
    plan(lock("999999999.999"), []);
    await expect(adjustStock({ ...args, delta: "0.001" }, { ...safe, expectedQuantity: "999999999.999" })).rejects.toMatchObject({
      code: "BUSINESS_RULE", message: "Resulting balance exceeds quantity bounds.",
    });
    noEffects();
  });

  it("permits a resulting balance exactly at the NUMERIC(12,3) maximum", async () => {
    m.context.mockResolvedValue(context("WEIGHT", "KG", 125));
    plan(lock("999999999.998"), [], [{ nq: "999999999.999" }]);
    await expect(adjustStock({ ...args, delta: "0.001" }, { ...safe, expectedQuantity: "999999999.998" })).resolves.toMatchObject({ newQuantity: "999999999.999" });
    expect(m.audit).toHaveBeenCalledOnce();
  });
});
