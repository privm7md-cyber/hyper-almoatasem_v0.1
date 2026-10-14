// FE-4 quantity math unit tests (display/UX pre-checks; server decides authoritatively).
import { describe, expect, it } from "vitest";
import {
  WEIGHT_PRESETS_GRAMS,
  estimatePiastres,
  gramsToQtyText,
  isStepValid,
  isWholePacks,
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
});
