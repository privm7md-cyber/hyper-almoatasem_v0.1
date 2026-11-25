// @vitest-environment node
// Pure wire/math contracts; no database, environment changes or network.
import { describe, expect, it } from "vitest";
import { boundedThousandths, countedDelta, isStepMultiple, isWholePacks, thousandthsText } from "../quantities";
import { safeAdjustmentSchema } from "../validation";

const input = {
  productVariantId: "abcdefab-1234-4000-8000-000000000001",
  requestId: "abcdefab-1234-4000-8000-000000000002",
  expectedQuantity: "10.000", delta: "2.000", movementType: "ADJUSTMENT",
  reason: "Stock count", confirmed: true,
};

describe("ADM04 bounded decimal facts", () => {
  it.each([
    ["0", 0], ["0.001", 1], ["1.2", 1200], ["0001.230", 1230],
    ["999999999.999", 999_999_999_999], ["-999999999.999", -999_999_999_999],
  ] as const)("converts %s exactly to integer thousandths", (value, expected) => {
    expect(boundedThousandths(value, true)).toBe(expected);
    expect(boundedThousandths(thousandthsText(expected), true)).toBe(expected);
  });

  it.each([
    "1000000000", "-1000000000", "999999999.9999", "9007199254740993",
    "1.0001", "1e3", "+1", ".5", "1.", "NaN", "Infinity", "", " 1", "1 ", "1\n", "1.234\n",
  ])("rejects malformed or overflowing decimal %j without truncation", (value) => {
    expect(() => boundedThousandths(value, true)).toThrow();
  });

  it.each(["-0", "-0.001", "-1"])("unsigned balances reject %s", (value) => {
    expect(() => boundedThousandths(value)).toThrow();
  });

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY, 1_000_000_000_000, -1_000_000_000_000])(
    "refuses to format invalid thousandths %s", (value) => {
      expect(() => thousandthsText(value)).toThrow();
    },
  );

  it.each([
    ["0.300", "0.100", "0.200"], ["0.100", "0.300", "-0.200"],
    ["10", "10.000", "0.000"], ["999999999.999", "0", "999999999.999"],
    ["0", "999999999.999", "-999999999.999"],
  ])("counted %s minus known %s is %s", (counted, known, delta) => {
    expect(countedDelta(counted, known)).toBe(delta);
  });

  it("PIECE counts whole packs, while a weighed fact need not be a sale step", () => {
    expect(isWholePacks("-2.000")).toBe(true);
    expect(isWholePacks("2.001")).toBe(false);
    expect(isStepMultiple("0.475", 125, "KG")).toBe(false);
    expect(isStepMultiple("0.500", 125, "KG")).toBe(true);
    expect(isStepMultiple("125", 125, "GRAM")).toBe(true);
    expect(isStepMultiple("124.999", 125, "GRAM")).toBe(false);
  });
});

describe("ADM04 safe adjustment boundary", () => {
  it("normalizes UUID case and reason, preserving decimal strings", () => {
    expect(safeAdjustmentSchema.parse({
      ...input, productVariantId: input.productVariantId.toUpperCase(),
      requestId: input.requestId.toUpperCase(), reason: "  Stock count  ",
    })).toEqual(input);
  });

  it.each(["STOCK_IN", "ADJUSTMENT", "WASTE", "RETURN"])("accepts manual movement %s", (movementType) => {
    expect(safeAdjustmentSchema.safeParse({ ...input, movementType }).success).toBe(true);
  });

  it.each(["999999999.999", "-999999999.999", "0.001", "-0.001"])("accepts bounded nonzero delta %s", (delta) => {
    expect(safeAdjustmentSchema.safeParse({ ...input, delta, expectedQuantity: "0" }).success).toBe(true);
  });

  it("accepts a maximum known balance and exactly 2000 reason characters", () => {
    expect(safeAdjustmentSchema.safeParse({
      ...input, expectedQuantity: "999999999.999", reason: "r".repeat(2000),
    }).success).toBe(true);
  });

  it.each([
    { reason: undefined }, { reason: null }, { reason: " \n\t " }, { reason: "r".repeat(2001) },
    { confirmed: undefined }, { confirmed: false }, { confirmed: "true" },
    { expectedQuantity: undefined }, { expectedQuantity: "-0.001" }, { expectedQuantity: "1000000000" },
    { expectedQuantity: 10 }, { requestId: undefined }, { requestId: "not-a-uuid" },
    { productVariantId: "not-a-uuid" }, { delta: 2 }, { delta: "0" }, { delta: "-0.000" },
    { delta: "1000000000" }, { delta: "-1000000000" }, { delta: "0.0001" },
    { movementType: "SALE" }, { movementType: "REPLACEMENT" }, { movementType: "CANCELLED_ORDER" },
    { actorId: "spoof" }, { referenceType: "MANUAL" }, { referenceId: input.requestId },
  ])("rejects missing, malformed or untrusted fields: %j", (patch) => {
    expect(safeAdjustmentSchema.safeParse({ ...input, ...patch }).success).toBe(false);
  });

  it.each(["delta", "expectedQuantity"])("rejects trailing line breaks in %s at the API boundary", (field) => {
    expect(safeAdjustmentSchema.safeParse({ ...input, [field]: "1.000\n" }).success).toBe(false);
  });

  it.each([null, [], {}, "not-an-object"])("rejects non-request body %j", (value) => {
    expect(safeAdjustmentSchema.safeParse(value).success).toBe(false);
  });
});
