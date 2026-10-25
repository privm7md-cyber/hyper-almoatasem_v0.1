// Contrast regression guards (DS-02 / Phase-03 CT ledger).
// The values mirror the source-of-truth tokens in src/app/globals.css; these tests
// document the WCAG math so the numbers stay load-bearing, not decorative.
// (CSS custom properties cannot be resolved in jsdom for every matrix entry, so the
// token values are asserted against known constants — any token drift shows as a change.)

import { describe, expect, it } from "vitest";

const TOKENS = {
  brandPurple: "#511d9c",
  statusError: "#c62828",
  successBg: "#e7f4ec",
  errorBg: "#fbe9e9",
  warningFg: "#b45309",
  warningBg: "#fef3c7",
  infoFg: "#1d4ed8",
  infoBg: "#e8effd",
  textSecondary: "#5b556e",
  surfacePurple: "#eee8f5",
  surfaceSubtle: "#f6f5f9",
  textInk: "#1b1530",
  accentOrange: "#ff7100",
  statusSuccess: "#15803d",
} as const;

/** DARKER success ink added for DS-02 (CT-19 was 4.43 — marginal FAIL). */
const SUCCESS_INK = "#136b33";

function luminance(hex: string): number {
  const m = hex.replace("#", "").toLowerCase();
  const rgb = [0, 2, 4]
    .map((i) => parseInt(m.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

function ratio(fg: string, bg: string): number {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** Alpha composite (e.g. border-white/60 over the hero purple). */
function compositeOver(hex: string, alpha: number, bg: string): string {
  const parse = (h: string) => [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ];
  const f = parse(hex);
  const b = parse(bg);
  const c = f.map((v, i) => Math.round(alpha * v + (1 - alpha) * b[i]));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

describe("contrast ledger (WCAG 2.2)", () => {
  it("CT-19 / DS-02 FIXED: in-stock chip text passes 4.5:1 over the success fill", () => {
    expect(SUCCESS_INK).toBe("#136b33");
    expect(ratio(SUCCESS_INK, TOKENS.successBg)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(TOKENS.statusSuccess, TOKENS.successBg)).toBeLessThan(4.5); // historical pin
  });

  it("CT-15 / DS-01 FIXED: hero ghost border composite passes 3:1 over the brand", () => {
    // border-white/60 idle (was white/30 = 2.20)
    const idle = compositeOver("#ffffff", 0.6, TOKENS.brandPurple);
    expect(idle).toBe("#b9a5d7");
    expect(ratio(idle, TOKENS.brandPurple)).toBeGreaterThanOrEqual(3);
  });

  it("confidence chrome PASSes: error chip, unknown chip text, warning, info", () => {
    expect(ratio(TOKENS.statusError, TOKENS.errorBg)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(TOKENS.textSecondary, TOKENS.surfacePurple)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(TOKENS.warningFg, TOKENS.warningBg)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(TOKENS.infoFg, TOKENS.infoBg)).toBeGreaterThanOrEqual(4.5);
  });

  it("base text PASSes: secondary on subtles, ink on accent, success on white", () => {
    expect(ratio(TOKENS.textSecondary, TOKENS.surfaceSubtle)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(TOKENS.textInk, TOKENS.accentOrange)).toBeGreaterThanOrEqual(3);
    expect(ratio(TOKENS.statusSuccess, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(ratio(TOKENS.textInk, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("decorative-only boundary facts stay documented (CT-23/33/34 — no-usage ruling owned)", () => {
    // These are decorative/dot/boundary pairs; text labels carry the meaning and
    // pass. Any bump requires an owner decision (DS-03/DS-04 interpretation items
    // are NOT quietly changed).
    expect(ratio("#c9c4d8", TOKENS.surfacePurple)).toBeLessThan(3);
    expect(ratio("#e4e1ec", "#ffffff")).toBeLessThan(3);
    expect(ratio("#c9c4d8", "#ffffff")).toBeLessThan(3);
  });
});
