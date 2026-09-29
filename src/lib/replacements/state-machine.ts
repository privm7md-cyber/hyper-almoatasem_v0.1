// BA-7 replacement state machine + R2 READY gate (pure, no DB).
//
// Exact frozen names from db/phase2-schema.sql (chk_repl_status +
// check_replacement_transition): PROPOSED → CUSTOMER_APPROVED |
// CUSTOMER_REJECTED | AUTO_ACCEPTED. The DB trigger/CHECKs stay
// authoritative — this module fails fast with 409 before SQL. Original
// lines move PENDING→REPLACED (swap) or UNAVAILABLE→REPLACED (OOS);
// both pairs are trigger-whitelisted in frozen SQL.

export const REPLACEMENT_STATUSES = [
  "PROPOSED",
  "CUSTOMER_APPROVED",
  "CUSTOMER_REJECTED",
  "AUTO_ACCEPTED",
] as const;

export type ReplacementStatus = (typeof REPLACEMENT_STATUSES)[number];

const TERMINAL: Record<ReplacementStatus, readonly ReplacementStatus[]> = {
  PROPOSED: ["CUSTOMER_APPROVED", "CUSTOMER_REJECTED", "AUTO_ACCEPTED"],
  CUSTOMER_APPROVED: [],
  CUSTOMER_REJECTED: [],
  AUTO_ACCEPTED: [],
};

export function canTransitionReplacement(from: string, to: string): boolean {
  const next = (TERMINAL as Record<string, readonly string[]>)[from];
  return next !== undefined && next.includes(to);
}

export function isReplacementTerminal(status: string): boolean {
  return status !== "PROPOSED" && (REPLACEMENT_STATUSES as readonly string[]).includes(status);
}

/**
 * R2 READY gate, discipline definition for fulfillment (no BA-7 transition
 * targets READY — this helper exists so the future READY writer evaluates
 * the exact frozen rule instead of inventing one): READY ⟺ zero
 * PENDING-pickable lines AND zero live PROPOSED replacements.
 */
export function evaluateReadyGate(pendingPickable: number, liveProposed: number): {
  ready: boolean;
  pendingPickable: number;
  liveProposed: number;
} {
  return {
    ready: pendingPickable === 0 && liveProposed === 0,
    pendingPickable,
    liveProposed,
  };
}

/**
 * R5 pre-consent spend check (exact integer piastres): covered ⟺ consent
 * AND (no extra spend OR (within 10% of the original estimate AND within
 * 50 EGP)). Base = original line estimate (the only frozen-agreement
 * figure the signed delta is computed against).
 */
export function preConsentCovers(
  consent: boolean,
  diffCents: number,
  originalEstimateCents: number,
): boolean {
  if (!consent) return false;
  if (diffCents <= 0) return true;
  return 10 * diffCents <= originalEstimateCents && diffCents <= 5000;
}
