import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MOTION_CSS_VARS,
  MOTION_DURATIONS_MS,
  MOTION_DURATIONS_SEC,
  MOTION_EASINGS,
  MOTION_SPRINGS,
  MOTION_TIERS,
  getEnterExitVariants,
  getMotionTransition,
  type MotionTierName,
} from "../motion-tokens";

describe("motion-tokens foundation", () => {
  it("keeps millisecond and second duration scales aligned and within speed caps", () => {
    for (const key of Object.keys(MOTION_DURATIONS_MS) as Array<keyof typeof MOTION_DURATIONS_MS>) {
      expect(MOTION_DURATIONS_MS[key] / 1000).toBeCloseTo(MOTION_DURATIONS_SEC[key], 5);
    }
    expect(MOTION_DURATIONS_MS.micro).toBeLessThanOrEqual(120);
    expect(MOTION_DURATIONS_MS.hero).toBeLessThanOrEqual(640);
  });

  it("defines valid cubic-bezier tuples, springs, and CSS variable mappings", () => {
    for (const curve of Object.values(MOTION_EASINGS)) {
      expect(curve).toHaveLength(4);
      expect(curve[0]).toBeGreaterThanOrEqual(0);
      expect(curve[0]).toBeLessThanOrEqual(1);
      expect(curve[2]).toBeGreaterThanOrEqual(0);
      expect(curve[2]).toBeLessThanOrEqual(1);
    }
    expect(MOTION_SPRINGS.drawer.type).toBe("spring");
    expect(MOTION_CSS_VARS.easeStandard).toBe("var(--ease-standard)");
    expect(MOTION_CSS_VARS.durationSurface).toBe("var(--motion-surface)");
  });

  it("enforces zero duration under reduced motion for all tiers", () => {
    for (const tier of Object.keys(MOTION_TIERS) as MotionTierName[]) {
      expect(MOTION_TIERS[tier].reducedMotionDurationMs).toBe(0);
      expect(getMotionTransition(tier, true)).toEqual({ duration: 0 });
      const normal = getMotionTransition(tier, false);
      expect(normal.duration).toBeGreaterThan(0);
      expect(normal.ease).toBeDefined();
    }
  });

  it("builds RTL-aware enter/exit variants and collapses displacement when reducedMotion is true", () => {
    const rtlSurface = getEnterExitVariants("surface", false, "x-rtl");
    expect(rtlSurface.initial.x).toBeGreaterThan(0);
    expect(rtlSurface.animate.x).toBe(0);
    expect(rtlSurface.exit.x).toBeGreaterThan(0);

    const ltrSurface = getEnterExitVariants("surface", false, "x-ltr");
    expect(ltrSurface.initial.x).toBeLessThan(0);

    const reduced = getEnterExitVariants("surface", true, "x-rtl");
    expect(reduced.initial).toEqual({ opacity: 1, x: 0, y: 0, scale: 1 });
    expect(reduced.animate).toEqual({ opacity: 1, x: 0, y: 0, scale: 1 });
    expect(reduced.exit).toEqual({ opacity: 1, x: 0, y: 0, scale: 1 });
  });

  it("keeps globals.css aligned with unified P12-01 tokens and free of dead .pn14-*/.adx-* CSS", () => {
    const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).toContain("--brand-purple: #511d9c;");
    expect(css).toContain("--brand-orange: #ff7100;");
    expect(css).toContain("--text-orange: #c2410c;");
    expect(css).toContain("--text-ink: #1b1530;");
    expect(css).toContain("--surface-purple: #eee8f5;");
    expect(css).toContain("--surface-orange: #fff1e6;");
    expect(css).toContain("--radius-control: 10px;");
    expect(css).toContain("--radius-card: 14px;");
    expect(css).toContain("--radius-dialog: 18px;");
    expect(css).toContain("--radius-panel: 18px;");
    expect(css).toContain("--motion-surface: 340ms;");
    expect(css).toContain("--ease-standard: cubic-bezier(0.22, 1, 0.36, 1);");
    expect(css).toContain(".vxp-shimmer");
    expect(css).toContain("[data-reveal]");
    expect(css).not.toMatch(/\.pn14-|--pn14-|\.adx-/);
  });
});
