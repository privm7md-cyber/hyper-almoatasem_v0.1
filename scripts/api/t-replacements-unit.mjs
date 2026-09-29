// BA-7 replacements unit tests (no database, no server, no secrets).
// Run: node scripts/api/t-replacements-unit.mjs
// Covers: exact frozen replacement states/transitions, R2 READY gate
// truth table, R5 pre-consent caps math (exact integers), Zod boundaries
// (strict, enums, no invented states).
import { register } from "node:module";
register("./ts-resolve-hook.mjs", import.meta.url);
const [{ REPLACEMENT_STATUSES, canTransitionReplacement, isReplacementTerminal, evaluateReadyGate, preConsentCovers }] = await Promise.all([
  import("../../src/lib/replacements/state-machine.ts"),
]);
const validation = await import("../../src/lib/replacements/validation.ts");

const results = [];
const t = (name, pass, detail = "") => results.push({ name, pass: pass === true, detail });
const done = (code) => {
  const failures = results.filter((r) => !r.pass);
  console.log(JSON.stringify({ suite: "replacements-unit", total: results.length, failures: failures.length, failed: failures.map((f) => f.name), passed: results.filter((r) => r.pass).map((r) => r.name) }, null, 2));
  process.exitCode = code ?? (failures.length === 0 ? 0 : 2);
};

// --- exact frozen states (verbatim, never renamed) ---
t("four-states", REPLACEMENT_STATUSES.length === 4
  && ["PROPOSED", "CUSTOMER_APPROVED", "CUSTOMER_REJECTED", "AUTO_ACCEPTED"].every((s) => REPLACEMENT_STATUSES.includes(s)));
t("no-invented-states", !REPLACEMENT_STATUSES.includes("APPROVED") && !REPLACEMENT_STATUSES.includes("REJECTED")
  && !REPLACEMENT_STATUSES.includes("PENDING") && !REPLACEMENT_STATUSES.includes("WITHDRAWN"));

// --- frozen transition table (PROPOSED -> terminal only) ---
t("proposed-paths", canTransitionReplacement("PROPOSED", "CUSTOMER_APPROVED")
  && canTransitionReplacement("PROPOSED", "CUSTOMER_REJECTED")
  && canTransitionReplacement("PROPOSED", "AUTO_ACCEPTED")
  && !canTransitionReplacement("PROPOSED", "PROPOSED"));
t("terminals-closed", !canTransitionReplacement("CUSTOMER_APPROVED", "PROPOSED")
  && !canTransitionReplacement("CUSTOMER_APPROVED", "CUSTOMER_REJECTED")
  && !canTransitionReplacement("CUSTOMER_REJECTED", "AUTO_ACCEPTED")
  && !canTransitionReplacement("AUTO_ACCEPTED", "CUSTOMER_APPROVED"));
t("unknown-states", !canTransitionReplacement("PROPOSED", "BOGUS") && !canTransitionReplacement("BOGUS", "PROPOSED"));
t("is-terminal", isReplacementTerminal("CUSTOMER_APPROVED") && isReplacementTerminal("CUSTOMER_REJECTED")
  && isReplacementTerminal("AUTO_ACCEPTED") && !isReplacementTerminal("PROPOSED")
  && !isReplacementTerminal("BOGUS"));

// --- R2 READY gate truth table ---
t("ready-open", evaluateReadyGate(0, 0).ready === true);
t("ready-blocked-pending", evaluateReadyGate(2, 0).ready === false);
t("ready-blocked-proposed", evaluateReadyGate(0, 1).ready === false);
t("ready-blocked-both", evaluateReadyGate(1, 1).ready === false);
t("ready-echoes-counts", (() => {
  const r = evaluateReadyGate(3, 2);
  return r.pendingPickable === 3 && r.liveProposed === 2 && r.ready === false;
})());

// --- R5 caps (piastres, exact): consent + (no spend | <=10% & <=50 EGP) ---
t("caps-no-consent", preConsentCovers(false, 0, 10000) === false && preConsentCovers(false, -500, 10000) === false);
t("caps-no-spend", preConsentCovers(true, 0, 10000) === true && preConsentCovers(true, -1500, 10000) === true);
t("caps-within-both", preConsentCovers(true, 1000, 10000) === true);
t("caps-rel-breach", preConsentCovers(true, 1500, 10000) === false);
t("caps-abs-breach", preConsentCovers(true, 6000, 100000) === false);
t("caps-rel-edge", preConsentCovers(true, 1000, 10000) === true && preConsentCovers(true, 1001, 10000) === false);
t("caps-abs-edge", preConsentCovers(true, 5000, 200000) === true && preConsentCovers(true, 5001, 200000) === false);

// --- boundaries ---
const { proposeInputSchema, decideInputSchema, replacementQuantitySchema, replacementStatusSchema } = validation;
const CID = "04800000-0000-7000-8000-000000000001";
t("qty-wire", replacementQuantitySchema.safeParse("0.500").success && replacementQuantitySchema.safeParse("2").success
  && !replacementQuantitySchema.safeParse("0").success && !replacementQuantitySchema.safeParse("-1").success
  && !replacementQuantitySchema.safeParse("0.1234").success && !replacementQuantitySchema.safeParse(0.5).success);
t("status-enum-frozen", replacementStatusSchema.safeParse("CUSTOMER_APPROVED").success
  && !replacementStatusSchema.safeParse("APPROVED").success
  && !replacementStatusSchema.safeParse("REJECTED").success);
t("propose-shape", proposeInputSchema.safeParse({ replacementVariantId: CID, replacementQuantity: "1" }).success
  && proposeInputSchema.safeParse({ replacementVariantId: CID, replacementQuantity: "1", markUnavailable: false }).success);
t("propose-rejects", !proposeInputSchema.safeParse({ replacementQuantity: "1" }).success
  && !proposeInputSchema.safeParse({ replacementVariantId: CID, replacementQuantity: "0" }).success
  && !proposeInputSchema.safeParse({ replacementVariantId: CID, replacementQuantity: "1", governorate: "x" }).success
  && !proposeInputSchema.safeParse({ replacementVariantId: CID, replacementQuantity: "1", markUnavailable: "yes" }).success);
t("decide-shape", decideInputSchema.safeParse({ customerId: CID, action: "approve" }).success
  && decideInputSchema.safeParse({ customerId: CID, action: "reject" }).success);
t("decide-rejects", !decideInputSchema.safeParse({ customerId: CID }).success
  && !decideInputSchema.safeParse({ customerId: CID, action: "withdraw" }).success
  && !decideInputSchema.safeParse({ customerId: CID, action: "approve", note: "x" }).success);

done();
