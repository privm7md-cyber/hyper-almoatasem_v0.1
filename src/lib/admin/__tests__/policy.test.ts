// Admin policy (pure): settings value-type mirror + the money-valued setting
// shape used by delivery.default_fee. The database CHECK remains the enforcer;
// these pin the boundary rules that reject values the CHECK would accept but
// checkout cannot safely consume.
import { describe, expect, it } from "vitest";
import {
  MONEY_SETTING_KEYS,
  MONEY_SETTING_TEXT_RE,
  isSettingValueValid,
} from "../policy";

describe("isSettingValueValid (chk_settings_typed mirror)", () => {
  it("accepts the typed shapes the database accepts", () => {
    expect(isSettingValueValid("BOOLEAN", "true")).toBe(true);
    expect(isSettingValueValid("BOOLEAN", "false")).toBe(true);
    expect(isSettingValueValid("INTEGER", "30")).toBe(true);
    expect(isSettingValueValid("NUMERIC", "20.00")).toBe(true);
    expect(isSettingValueValid("TEXT", "anything at all")).toBe(true);
    expect(isSettingValueValid("JSON", '{"a":1}')).toBe(true);
  });

  it("rejects the typed shapes the database rejects", () => {
    expect(isSettingValueValid("BOOLEAN", "1")).toBe(false);
    expect(isSettingValueValid("INTEGER", "3.5")).toBe(false);
    expect(isSettingValueValid("NUMERIC", "abc")).toBe(false);
    expect(isSettingValueValid("JSON", "{")).toBe(false);
    expect(isSettingValueValid("UNKNOWN", "x")).toBe(false);
  });
});

describe("money-valued settings", () => {
  it("targets exactly the delivery default fee", () => {
    expect(MONEY_SETTING_KEYS.has("delivery.default_fee")).toBe(true);
    expect(MONEY_SETTING_KEYS.has("orders.auto_cancel_minutes")).toBe(false);
  });

  it("accepts non-negative amounts with at most two decimals", () => {
    for (const value of ["0", "0.00", "20", "20.5", "20.50", "99999999.99"]) {
      expect(MONEY_SETTING_TEXT_RE.test(value)).toBe(true);
    }
  });

  it("rejects negatives, extra decimals, signs, and out-of-range text", () => {
    for (const value of ["-1", "-0.01", "20.000", "1e3", "+5", " 20.00", "20,00", "999999999.00"]) {
      expect(MONEY_SETTING_TEXT_RE.test(value)).toBe(false);
    }
  });
});
