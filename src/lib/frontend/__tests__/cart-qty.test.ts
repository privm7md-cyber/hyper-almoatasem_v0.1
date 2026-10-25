// FE-4 quantity math unit tests (display/UX pre-checks; server decides authoritatively).
// Phase 07 (D01/D04): the WEIGHT price is a price per KILOGRAM, so a chosen
// weight is priced as price/kg × grams/1000 — grams are never multiplied by a
// per-kg price.
import { describe, expect, it } from "vitest";
import {
  WEIGHT_PRESETS_GRAMS,
  estimatePiastres,
  gramsToQtyText,
  isStepValid,
  isWholePacks,
  saleBasisFor,
  weightEstimatePiastres,
} from "../cart-qty";

describe("cart-qty", () => {
  it("accepts canonical presets only where the step allows", () => {
    expect(WEIGHT_PRESETS_GRAMS).toEqual([125, 250, 500, 1000, 1250]);
    expect(isStepValid(125, 125)).toBe(true);
    expect(isStepValid(500, 250)).toBe(true);
    expect(isStepValid(137, 250)).toBe(false);
    expect(isStepValid(0, 250)).toBe(false);
    expect(isStepValid(250, null)).toBe(false);
  });

  it("maps grams to the variant sizeUnit wire shape", () => {
    expect(gramsToQtyText("KG", 500)).toBe("0.5");
    expect(gramsToQtyText("KG", 125)).toBe("0.125");
    expect(gramsToQtyText("GRAM", 500)).toBe("500");
    expect(gramsToQtyText("GRAM", 137.5)).toBeNull();
    expect(gramsToQtyText("LITER", 500)).toBeNull();
    expect(gramsToQtyText(null, 500)).toBeNull();
  });

  it("keeps whole-pack rule for PIECE", () => {
    expect(isWholePacks(2)).toBe(true);
    expect(isWholePacks(0)).toBe(false);
    expect(isWholePacks(-1)).toBe(false);
    expect(isWholePacks(1.5)).toBe(false);
  });

  it("estimates with integer piastres (no float drift), display-only", () => {
    expect(estimatePiastres("0.125", "320.00")).toBe(4000);
    expect(estimatePiastres("2", "42.00")).toBe(8400);
    expect(estimatePiastres("abc", "42.00")).toBeNull();
    expect(estimatePiastres("2", "nope")).toBeNull();
    expect(estimatePiastres("0", "42.00")).toBeNull();
  });

  it("derives the price basis from the sale type and the variant unit (D01)", () => {
    // A WEIGHT product sold in kilograms: the price IS a per-kilogram price.
    expect(saleBasisFor("WEIGHT", "KG")).toBe("PER_KG");
    // A pack-priced product (PIECE, or a WEIGHT row whose variant carries the
    // pack's own unit) keeps its pack price — it is never presented per kg.
    expect(saleBasisFor("PIECE", "GRAM")).toBe("PACK");
    expect(saleBasisFor("PIECE", "KG")).toBe("PACK");
    expect(saleBasisFor("PIECE", null)).toBe("PACK");
    expect(saleBasisFor("WEIGHT", "GRAM")).toBe("PACK");
    expect(saleBasisFor("WEIGHT", null)).toBe("PACK");
  });

  it("rejects invalid weight inputs instead of guessing an amount", () => {
    expect(weightEstimatePiastres("33.00", 0)).toBeNull();
    expect(weightEstimatePiastres("33.00", -500)).toBeNull();
    expect(weightEstimatePiastres("abc", 500)).toBeNull();
    expect(weightEstimatePiastres("33.00", Number.NaN)).toBeNull();
  });

  it("prices a chosen weight from the per-kilogram price (D01, never grams × price)", () => {
    // 33 EGP/kg × 500 g = 16.50 EGP (1500 g would be 49.50 EGP) — the old
    // grams × price multiplication produced 16,500 EGP for the same choice.
    expect(weightEstimatePiastres("33.00", 500)).toBe(1650);
    expect(weightEstimatePiastres("33.00", 1500)).toBe(4950);
    // 40 EGP/kg × 1.25 kg = 50.00 EGP
    expect(weightEstimatePiastres("40.00", 1250)).toBe(5000);
    // A pack price must never be scaled by a weight.
    expect(weightEstimatePiastres("33.00", 0)).toBeNull();
  });
});
