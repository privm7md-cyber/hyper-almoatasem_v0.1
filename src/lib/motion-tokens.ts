/**
 * Unified Motion Token System (P12-01 foundation).
 *
 * Mirrors `--motion-*` and `--ease-*` custom properties in `src/app/globals.css`
 * for TypeScript consumers (`motion/react` components, helpers, and tests).
 * All transitions respect RTL horizontal flow and `prefers-reduced-motion`.
 */

export const MOTION_DURATIONS_MS = {
  instant: 0,
  micro: 110,
  fast: 170,
  short: 200,
  normal: 250,
  med: 320,
  surface: 340,
  enter: 460,
  section: 520,
  hero: 640,
} as const;

export const MOTION_DURATIONS_SEC = {
  instant: 0,
  micro: 0.11,
  fast: 0.17,
  short: 0.2,
  normal: 0.25,
  med: 0.32,
  surface: 0.34,
  enter: 0.46,
  section: 0.52,
  hero: 0.64,
} as const;

export const MOTION_CSS_VARS = {
  durationMicro: "var(--motion-micro)",
  durationFast: "var(--motion-fast)",
  durationShort: "var(--motion-short)",
  durationNormal: "var(--motion-normal)",
  durationMed: "var(--motion-med)",
  durationSurface: "var(--motion-surface)",
  durationEnter: "var(--motion-enter)",
  durationSection: "var(--motion-section)",
  durationHero: "var(--motion-hero)",
  easeLegacy: "var(--motion-ease)",
  easeSoft: "var(--motion-ease-soft)",
  easeStandard: "var(--ease-standard)",
  easeSymmetric: "var(--ease-symmetric)",
  easeExit: "var(--ease-exit)",
} as const;

export const MOTION_EASINGS = {
  standard: [0.22, 1, 0.36, 1] as const,
  legacy: [0.2, 0, 0, 1] as const,
  soft: [0.16, 1, 0.3, 1] as const,
  symmetric: [0.65, 0, 0.35, 1] as const,
  exit: [0.4, 0, 1, 1] as const,
} as const;

export const MOTION_SPRINGS = {
  drawer: { type: "spring", stiffness: 420, damping: 38, mass: 0.9 } as const,
  snappy: { type: "spring", stiffness: 500, damping: 35, mass: 0.8 } as const,
  gentle: { type: "spring", stiffness: 300, damping: 30, mass: 1 } as const,
} as const;

export type MotionTierName = "micro" | "control" | "disclosure" | "surface" | "section" | "hero";
export type MotionEasingCurve = readonly [number, number, number, number];

export interface MotionTierDescriptor {
  durationMs: number;
  durationSec: number;
  ease: MotionEasingCurve;
  enterOffsetPx: number;
  scaleFrom: number;
  reducedMotionDurationMs: number;
}

export const MOTION_TIERS: Record<MotionTierName, MotionTierDescriptor> = {
  micro: {
    durationMs: MOTION_DURATIONS_MS.micro,
    durationSec: MOTION_DURATIONS_SEC.micro,
    ease: MOTION_EASINGS.standard,
    enterOffsetPx: 0,
    scaleFrom: 0.985,
    reducedMotionDurationMs: 0,
  },
  control: {
    durationMs: MOTION_DURATIONS_MS.fast,
    durationSec: MOTION_DURATIONS_SEC.fast,
    ease: MOTION_EASINGS.standard,
    enterOffsetPx: 4,
    scaleFrom: 0.99,
    reducedMotionDurationMs: 0,
  },
  disclosure: {
    durationMs: MOTION_DURATIONS_MS.normal,
    durationSec: MOTION_DURATIONS_SEC.normal,
    ease: MOTION_EASINGS.symmetric,
    enterOffsetPx: 8,
    scaleFrom: 0.98,
    reducedMotionDurationMs: 0,
  },
  surface: {
    durationMs: MOTION_DURATIONS_MS.surface,
    durationSec: MOTION_DURATIONS_SEC.surface,
    ease: MOTION_EASINGS.standard,
    enterOffsetPx: 16,
    scaleFrom: 0.98,
    reducedMotionDurationMs: 0,
  },
  section: {
    durationMs: MOTION_DURATIONS_MS.enter,
    durationSec: MOTION_DURATIONS_SEC.enter,
    ease: MOTION_EASINGS.soft,
    enterOffsetPx: 16,
    scaleFrom: 1,
    reducedMotionDurationMs: 0,
  },
  hero: {
    durationMs: MOTION_DURATIONS_MS.hero,
    durationSec: MOTION_DURATIONS_SEC.hero,
    ease: MOTION_EASINGS.soft,
    enterOffsetPx: 12,
    scaleFrom: 0.98,
    reducedMotionDurationMs: 0,
  },
};

export interface MotionTransitionConfig {
  duration: number;
  ease?: MotionEasingCurve;
}

/**
 * Resolve transition parameters for a semantic tier while enforcing
 * immediate settling (`duration: 0`) under `prefers-reduced-motion`.
 */
export function getMotionTransition(
  tierName: MotionTierName,
  reducedMotion = false,
): MotionTransitionConfig {
  if (reducedMotion) {
    return { duration: 0 };
  }
  const tier = MOTION_TIERS[tierName];
  return {
    duration: tier.durationSec,
    ease: tier.ease,
  };
}

export type MotionEnterAxis = "y" | "x-rtl" | "x-ltr";

export interface EnterExitState {
  opacity: number;
  x?: number;
  y?: number;
  scale?: number;
}

export interface EnterExitVariants {
  initial: EnterExitState;
  animate: EnterExitState;
  exit: EnterExitState;
}

/**
 * Build initial/animate/exit variants for GPU-composited motion (`opacity`,
 * `transform`) with RTL-aware horizontal entrance (`x-rtl` enters from `+x`).
 */
export function getEnterExitVariants(
  tierName: MotionTierName,
  reducedMotion = false,
  axis: MotionEnterAxis = "y",
): EnterExitVariants {
  if (reducedMotion) {
    return {
      initial: { opacity: 1, x: 0, y: 0, scale: 1 },
      animate: { opacity: 1, x: 0, y: 0, scale: 1 },
      exit: { opacity: 1, x: 0, y: 0, scale: 1 },
    };
  }

  const tier = MOTION_TIERS[tierName];
  const offset = tier.enterOffsetPx;

  if (axis === "x-rtl") {
    return {
      initial: { opacity: 0, x: offset, scale: tier.scaleFrom },
      animate: { opacity: 1, x: 0, scale: 1 },
      exit: { opacity: 0, x: offset, scale: tier.scaleFrom },
    };
  }

  if (axis === "x-ltr") {
    return {
      initial: { opacity: 0, x: -offset, scale: tier.scaleFrom },
      animate: { opacity: 1, x: 0, scale: 1 },
      exit: { opacity: 0, x: -offset, scale: tier.scaleFrom },
    };
  }

  return {
    initial: { opacity: 0, y: offset, scale: tier.scaleFrom },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0, y: offset, scale: tier.scaleFrom },
  };
}
