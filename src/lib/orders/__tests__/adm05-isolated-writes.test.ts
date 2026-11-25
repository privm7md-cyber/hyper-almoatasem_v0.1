// @vitest-environment node
// Real domain code, transaction/reads/audit mocked; no DB or network.
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), items: vi.fn(), audit: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { $transaction: m.transaction } }));
vi.mock("@/lib/api/audit", () => ({ auditInTx: m.audit }));
vi.mock("@/lib/orders/queries", () => ({ findOrderByCart: vi.fn(), findOrderByIdempotencyKey: vi.fn() }));
vi.mock("@/lib/promotions/checkout", () => ({ applyPromotions: vi.fn(), persistPromoRows: vi.fn() }));
vi.mock("@/lib/orders/guest-access", () => ({ issueGuestOrderCredential: vi.fn() }));
vi.mock("@/lib/orders/delivery-fee", () => ({ resolveDeliveryFee: vi.fn() }));
vi.mock("@/lib/orders/guest-checkout-session", () => ({ bindGuestCheckoutSessionToOrder: vi.fn() }));
import { advanceOrder, finishPreparation, markLineUnavailable, pickOrderLine } from "../fulfillment";
import { cancelOrder } from "../writes";
import { adminCancelSchema, orderCancelSchema } from "../validation";

const orderId = "00000000-0000-4000-8000-000000000001";
const itemId = "00000000-0000-4000-8000-000000000002";
const actorId = "00000000-0000-4000-8000-000000000003";
const tx = { $queryRaw: m.query, $executeRaw: m.execute, orderItem: { findMany: m.items } };
const args = { orderId, itemId, actorId };
const order = (status: string) => [{ id: orderId, status }];
const line = (item_status = "PENDING", actual_quantity: string | null = null) => [{
  id: itemId, product_variant_id: itemId, requested_quantity: "1.000", actual_quantity,
  unit_price: "100.00", product_type_snapshot: "WEIGHT", sale_step_snapshot: 125,
  unit_snapshot: "KG", item_status,
}];
const sql = (call: unknown[]) => (call[0] as TemplateStringsArray).join("?");
function noEffects() { expect(m.execute).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled(); expect(m.items).not.toHaveBeenCalled(); }

beforeEach(() => {
  vi.resetAllMocks();
  m.transaction.mockImplementation(async (callback) => callback(tx));
  m.query.mockImplementation(() => { throw new Error("Unexpected mocked SQL read"); });
  m.execute.mockResolvedValue(1);
  m.audit.mockResolvedValue(undefined);
});

describe("ADM05 natural-state retries", () => {
  it.each(["PREPARING", "OUT_FOR_DELIVERY", "DELIVERED"] as const)("replays exact advance target %s with one lock, no effects", async (to) => {
    m.query.mockResolvedValueOnce(order(to));
    expect(await advanceOrder({ orderId, actorId, to })).toBe(orderId);
    expect(m.query).toHaveBeenCalledTimes(1);
    expect(sql(m.query.mock.calls[0])).toContain("FOR UPDATE");
    noEffects();
  });
  it("advances once then replays without a second history or audit", async () => {
    m.query.mockResolvedValueOnce(order("CONFIRMED")).mockResolvedValueOnce(order("PREPARING"));
    await advanceOrder({ orderId, actorId, to: "PREPARING" });
    await advanceOrder({ orderId, actorId, to: "PREPARING" });
    expect(m.execute).toHaveBeenCalledTimes(2);
    expect(sql(m.execute.mock.calls[0])).toContain("order_status_history");
    expect(m.audit).toHaveBeenCalledTimes(1);
    expect(m.audit.mock.calls[0][0]).toBe(tx);
  });
  it.each(["CANCELLED", "DELIVERED", "READY_FOR_DELIVERY"])("does not reopen %s by replaying prepare", async (status) => {
    m.query.mockResolvedValueOnce(order(status));
    await expect(advanceOrder({ orderId, actorId, to: "PREPARING" })).rejects.toMatchObject({ code: "CONFLICT" });
    noEffects();
  });
  it("READY replay skips all line, reservation and money writes", async () => {
    m.query.mockResolvedValueOnce(order("READY_FOR_DELIVERY"));
    expect(await finishPreparation(args)).toBe(orderId);
    expect(m.query).toHaveBeenCalledTimes(1);
    noEffects();
  });
  it.each(["OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"])("cannot ready an order now %s", async (status) => {
    m.query.mockResolvedValueOnce(order(status));
    await expect(finishPreparation(args)).rejects.toMatchObject({ code: "CONFLICT" });
    noEffects();
  });
  it("unavailable repeats under order+line locks without releasing stock", async () => {
    m.query.mockResolvedValueOnce(order("PREPARING")).mockResolvedValueOnce(line())
      .mockResolvedValueOnce(order("PREPARING")).mockResolvedValueOnce(line("UNAVAILABLE"));
    await markLineUnavailable(args);
    await markLineUnavailable(args);
    expect(m.execute).toHaveBeenCalledTimes(1);
    expect(m.audit).toHaveBeenCalledTimes(1);
    expect(m.query.mock.calls.every((call) => sql(call).includes("FOR UPDATE"))).toBe(true);
  });
  it.each(["FULFILLED", "PARTIALLY_FULFILLED"])("same actual quantity on %s is a no-effect replay", async (status) => {
    m.query.mockResolvedValueOnce(order("PREPARING")).mockResolvedValueOnce(line(status, "0.750"));
    expect(await pickOrderLine({ ...args, actualQuantity: "00.75" })).toBe(itemId);
    expect(m.query).toHaveBeenCalledTimes(2);
    noEffects();
  });
  it("different actual quantity conflicts without touching inventory", async () => {
    m.query.mockResolvedValueOnce(order("PREPARING")).mockResolvedValueOnce(line("FULFILLED", "1.000"));
    await expect(pickOrderLine({ ...args, actualQuantity: "0.999" })).rejects.toMatchObject({ code: "CONFLICT" });
    noEffects();
  });
  it.each(["READY_FOR_DELIVERY", "DELIVERED", "CANCELLED"])("pick/unavailable cannot mutate or replay after PREPARING (%s)", async (status) => {
    m.query.mockResolvedValue(order(status));
    await expect(pickOrderLine({ ...args, actualQuantity: "1" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(markLineUnavailable(args)).rejects.toMatchObject({ code: "CONFLICT" });
    noEffects();
  });
  it.each(["1.0001", "1000000000", "1e2", "NaN"])("rejects unsafe actual %s before any transaction", async (actualQuantity) => {
    await expect(pickOrderLine({ ...args, actualQuantity })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(m.transaction).not.toHaveBeenCalled();
  });
  it("picks once then repeats: single stock commit, movement and audit; snapshot price preserved", async () => {
    m.query.mockResolvedValueOnce(order("PREPARING")).mockResolvedValueOnce(line())
      .mockResolvedValueOnce([{ id: itemId, quantity: "10.000" }]).mockResolvedValueOnce([{ nq: "9.250" }])
      .mockResolvedValueOnce(order("PREPARING")).mockResolvedValueOnce(line("PARTIALLY_FULFILLED", "0.750"));
    await pickOrderLine({ ...args, actualQuantity: "0.750" });
    await pickOrderLine({ ...args, actualQuantity: "0.75" });
    expect(m.query.mock.calls.filter((call) => sql(call).includes("UPDATE inventory"))).toHaveLength(1);
    expect(m.execute).toHaveBeenCalledTimes(2);
    expect(m.audit).toHaveBeenCalledTimes(1);
    expect(m.audit.mock.calls[0][1].newValues).toEqual({ itemStatus: "PARTIALLY_FULFILLED", actualQuantity: "0.750", finalTotal: "75.00" });
    expect(m.query.mock.calls.some((call) => /FROM products|FROM product_variants/.test(sql(call)))).toBe(false);
  });
  it("keeps R7 envelope refusal effect-free", async () => {
    m.query.mockResolvedValueOnce(order("PREPARING")).mockResolvedValueOnce(line());
    await expect(pickOrderLine({ ...args, actualQuantity: "1.126" })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    noEffects();
  });
  it.each(["pending", "proposal"])("readiness refuses unresolved %s", async (kind) => {
    m.query.mockResolvedValueOnce(order("PREPARING")).mockResolvedValueOnce(kind === "pending" ? line() : []);
    if (kind === "proposal") m.query.mockResolvedValueOnce([{ one: 1 }]);
    await expect(finishPreparation(args)).rejects.toMatchObject({ code: "CONFLICT" });
    noEffects();
  });
  it("R19 clamps frozen discount, charges delivery and releases unavailable holds once", async () => {
    m.query.mockResolvedValueOnce(order("PREPARING"))
      .mockResolvedValueOnce([{ ...line("FULFILLED", "1")[0], final_total: "10.00" },
        { ...line("UNAVAILABLE")[0], id: actorId, final_total: null }])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([{ one: 1 }]).mockResolvedValueOnce([{ one: 1 }])
      .mockResolvedValueOnce([{ discount_total: "20.00", delivery_fee: "7.00" }])
      .mockResolvedValueOnce(order("READY_FOR_DELIVERY"));
    await finishPreparation(args);
    await finishPreparation(args);
    expect(m.audit).toHaveBeenCalledTimes(1);
    expect(m.audit.mock.calls[0][1].newValues).toMatchObject({ subtotalFinal: "10.00", totalFinal: "7.00" });
    expect(m.query.mock.calls.filter((call) => sql(call).includes("UPDATE inventory"))).toHaveLength(1);
    expect(m.execute.mock.calls.some((call) => /SET discount_total/.test(sql(call)))).toBe(false);
  });
});

describe("ADM05 staff cancellation terms", () => {
  const cancelArgs = { orderId, actorId, actorType: "STAFF" as const, reason: "Customer requested cancellation" };
  it("same staff/reason replays recorded cancellation before item/reservation reads", async () => {
    m.query.mockResolvedValueOnce(order("CANCELLED")).mockResolvedValueOnce([{ actor_type: "STAFF", actor_id: actorId, note: cancelArgs.reason }]);
    expect(await cancelOrder(cancelArgs)).toBe(orderId);
    expect(sql(m.query.mock.calls[1])).toContain("a.new_values ? 'reason'");
    noEffects();
  });
  it.each([
    [{ actor_type: "STAFF", actor_id: itemId, note: cancelArgs.reason }],
    [{ actor_type: "STAFF", actor_id: actorId, note: "different" }],
    [{ actor_type: "CUSTOMER", actor_id: actorId, note: cancelArgs.reason }], [],
  ].map((original) => ({ original })))("different or absent original terms cannot replay (%j)", async ({ original }) => {
    m.query.mockResolvedValueOnce(order("CANCELLED")).mockResolvedValueOnce(original);
    await expect(cancelOrder(cancelArgs)).rejects.toMatchObject({ code: "CONFLICT" });
    noEffects();
  });
  it.each(["CUSTOMER", "GUEST"] as const)("%s repeat retains 409", async (actorType) => {
    m.query.mockResolvedValueOnce(order("CANCELLED"));
    await expect(cancelOrder({ orderId, actorId, actorType })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(m.query).toHaveBeenCalledTimes(1);
    noEffects();
  });
  it("records reason/history and audit in the same transaction; repeat cannot release twice", async () => {
    m.query.mockResolvedValueOnce(order("PREPARING"))
      .mockResolvedValueOnce([{ one: 1 }]).mockResolvedValueOnce([{ one: 1 }])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([])
      .mockResolvedValueOnce(order("CANCELLED"))
      .mockResolvedValueOnce([{ actor_type: "STAFF", actor_id: actorId, note: cancelArgs.reason }]);
    m.items.mockResolvedValue([{ actualQuantity: null, itemStatus: "PENDING", productVariantId: itemId, requestedQuantity: "1.000" }]);
    await cancelOrder(cancelArgs);
    await cancelOrder(cancelArgs);
    expect(m.items).toHaveBeenCalledTimes(1);
    expect(m.query.mock.calls.filter((call) => sql(call).includes("UPDATE inventory"))).toHaveLength(1);
    expect(m.execute).toHaveBeenCalledTimes(2);
    expect(m.execute.mock.calls[0]).toContain(cancelArgs.reason);
    expect(m.audit).toHaveBeenCalledExactlyOnceWith(tx, expect.objectContaining({ newValues: { status: "CANCELLED", reason: cancelArgs.reason } }));
    expect(m.execute.mock.calls.some((call) => sql(call).includes("inventory_movements"))).toBe(false);
  });
  it("customer empty contract remains unchanged while admin normalizes a reason", () => {
    expect(orderCancelSchema.parse({})).toEqual({});
    expect(orderCancelSchema.safeParse({ reason: "x" }).success).toBe(false);
    expect(adminCancelSchema.parse({ reason: "  x  ", confirmed: true })).toEqual({ reason: "x", confirmed: true });
  });
  it.each([{}, { reason: "x" }, { reason: " " , confirmed: true }, { reason: "x", confirmed: false },
    { reason: "x", confirmed: "true" }, { reason: "x".repeat(2001), confirmed: true },
    { reason: "x", confirmed: true, actorId }, null])("rejects unconfirmed/missing/forged admin terms %j", (body) => {
    expect(adminCancelSchema.safeParse(body).success).toBe(false);
  });
});
