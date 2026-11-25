// Unit tests for the R5 pre-consent decision that guards the AUTO_ACCEPTED
// branch (R-10 remediation).
//
// The branch under test: `autoAcceptReplacement` looks up the replacement
// joined to the ORDER'S CUSTOMER row. A guest order (customer_id IS NULL)
// produces no row at all, so the lookup must be treated as "not covered"
// (explicit approval required) instead of being dereferenced.
import { describe, expect, it } from "vitest";
import {
  preConsentCovers,
  preConsentCovered,
} from "@/lib/replacements/state-machine";

describe("preConsentCovers (R5 spend caps, exact piastres)", () => {
  it("never covers without consent", () => {
    expect(preConsentCovers(false, 0, 10000)).toBe(false);
    expect(preConsentCovers(false, -500, 10000)).toBe(false);
  });

  it("covers a delta that does not increase the price", () => {
    expect(preConsentCovers(true, 0, 10000)).toBe(true);
    expect(preConsentCovers(true, -2500, 10000)).toBe(true);
  });

  it("covers a delta within 10% AND within 50 EGP", () => {
    // 5.00 EGP on a 100.00 EGP estimate.
    expect(preConsentCovers(true, 500, 10000)).toBe(true);
    // 10.00 EGP on a 100.00 EGP estimate — exactly at the 10% edge.
    expect(preConsentCovers(true, 1000, 10000)).toBe(true);
  });

  it("does not cover a delta above 10% of the original estimate", () => {
    // 11.00 EGP on a 100.00 EGP estimate.
    expect(preConsentCovers(true, 1100, 10000)).toBe(false);
  });

  it("does not cover a delta above 50 EGP", () => {
    // 60.00 EGP on a 1000.00 EGP estimate — inside 10% but above the cap.
    expect(preConsentCovers(true, 6000, 100000)).toBe(false);
  });
});

describe("preConsentCovered (the AUTO_ACCEPTED lookup)", () => {
  it("treats a missing row (a guest order) as not covered", () => {
    expect(preConsentCovered(undefined)).toBe(false);
  });

  it("covers a consenting registered customer within the caps", () => {
    expect(preConsentCovered({ consent: true, diff: "5.00", est: "100.00" })).toBe(true);
    expect(preConsentCovered({ consent: true, diff: "0.00", est: "100.00" })).toBe(true);
  });

  it("does not cover a customer who never consented", () => {
    expect(preConsentCovered({ consent: false, diff: "0.00", est: "100.00" })).toBe(false);
  });

  it("does not cover a consenting customer outside the spend caps", () => {
    expect(preConsentCovered({ consent: true, diff: "11.00", est: "100.00" })).toBe(false);
    expect(preConsentCovered({ consent: true, diff: "60.00", est: "1000.00" })).toBe(false);
  });
});
