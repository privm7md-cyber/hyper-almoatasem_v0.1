// BA-7 replacement input validation (boundary layer, Zod only).
//
// Mirrors frozen CHECK shapes without re-owning them: the database remains
// the sole enforcer; these schemas reject malformed input early with 400.
// Quantity/step/pack rules, lifecycle gates, and caps live in writes.ts.
import { z } from "zod";
import { uuidSchema } from "../api/validation";
import { formatPiastres } from "@/lib/cart/totals";
import { REPLACEMENT_STATUSES } from "./state-machine";

/** Quantity wire shape: NUMERIC(12,3) text, strictly > 0 (frozen
 * chk_repl_qty). Never z.coerce — numeric JSON input is rejected. */
export const replacementQuantitySchema = z
  .string()
  .regex(/^\d+(\.\d{1,3})?$/, { message: "Invalid quantity." })
  .refine((s) => Number(s) > 0, { message: "Invalid quantity." });

export const replacementStatusSchema = z.enum(REPLACEMENT_STATUSES);

const DECIDE_ACTIONS = ["approve", "reject"] as const;
export const decideActionSchema = z.enum(DECIDE_ACTIONS);

const multiProposalSchema = z
  .object({
    /** Owner decision update (2026-11-19): MULTI-ALTERNATIVE proposals —
     *  the store sends ONE proposal with N alternatives; alternatives live in
     *  `order_item_replacements.reason` as a JSON array (frozen table keeps
     *  its singular columns + the one-PROPOSED-per-item UQ intact).
     *  The singular columns mirror alternative #1 (the first, default offer). */
    alternatives: z
      .array(
        z.object({
          replacementVariantId: uuidSchema,
          replacementQuantity: replacementQuantitySchema,
          reason: z.string().trim().max(2000).nullish(),
        }),
      )
      .min(1, "Provide at least one alternative.")
      .max(5, "Maximum 5 alternatives."),
    reason: z.string().trim().max(2000).nullish(),
    /** OOS-driven (default true): original PENDING→UNAVAILABLE same-tx.
     * False = swap proposal: original stays PENDING (frozen by R2). */
    markUnavailable: z.boolean().nullish(),
  })
  .strict()
  .refine(
    (value) => new Set(value.alternatives.map((alternative) => alternative.replacementVariantId)).size === value.alternatives.length,
    { message: "Alternative variants must be unique.", path: ["alternatives"] },
  );

const singleProposalSchema = z
  .object({
    replacementVariantId: uuidSchema,
    replacementQuantity: replacementQuantitySchema,
    reason: z.string().trim().max(2000).nullish(),
    markUnavailable: z.boolean().nullish(),
  })
  .strict()
  .transform(({ replacementVariantId, replacementQuantity, reason, markUnavailable }) => ({
    alternatives: [{ replacementVariantId, replacementQuantity, reason: null }],
    reason,
    markUnavailable,
  }));

export const proposeInputSchema = z.union([multiProposalSchema, singleProposalSchema]);

export const decideInputSchema = z
  .object({
    action: decideActionSchema,
    /** Owner decision update: customer picks ONE alternative out of the
     *  multi-alternative proposal — server validates it against the stored
     *  alternatives (must be in PROPOSED, index in range, variant sellable). */
    alternativeIndex: z.number().int().min(0).max(4).nullish(),
  })
  .strict();

export type ProposeInput = z.infer<typeof proposeInputSchema>;
export type DecideInput = z.infer<typeof decideInputSchema>;
export type AlternativeInput = ProposeInput["alternatives"][number];

/** Serialized alternatives list embedded in OrderItemReplacement.reason (JSON). */
export interface StoredAlternative {
  variantId: string;
  quantity: string;
  reason: string | null;
  /** Server-computed price at proposal time (v1 cards show it). */
  price: string;
  /** Server-computed price difference vs the original line estimate. */
  priceDifference: string;
  variantName?: string;
  productName?: string;
  sizeValue?: string | null;
  unit?: string;
  productType?: string;
}

export interface StoredAlternativesEnvelope {
  version: 1;
  proposalReason: string | null;
  chosenIndex: number | null;
  alternatives: StoredAlternative[];
}

const storedAlternativeSchema = z.object({
  variantId: uuidSchema,
  quantity: replacementQuantitySchema,
  reason: z.string().max(2000).nullable(),
  price: z.string().regex(/^\d+(?:\.\d{1,2})?$/).refine((value) => Number(value) > 0),
  priceDifference: z.string().regex(/^-?\d+(?:\.\d{1,2})?$/),
  variantName: z.string().max(120).optional(),
  productName: z.string().max(160).optional(),
  sizeValue: z.string().max(32).nullable().optional(),
  unit: z.string().max(10).optional(),
  productType: z.enum(["PIECE", "WEIGHT"]).optional(),
}).strict();

const storedEnvelopeSchema = z.object({
  version: z.literal(1),
  proposalReason: z.string().max(2000).nullable(),
  chosenIndex: z.number().int().min(0).max(4).nullable(),
  alternatives: z.array(storedAlternativeSchema).min(1).max(5),
}).strict().superRefine((value, ctx) => {
  if (value.chosenIndex !== null && value.chosenIndex >= value.alternatives.length) {
    ctx.addIssue({ code: "custom", message: "chosenIndex is outside alternatives.", path: ["chosenIndex"] });
  }
});

export function serializeAlternatives(
  inputs: ProposeInput["alternatives"],
  snapshots: Array<{
    priceText: string;
    variantName: string;
    productName: string;
    sizeValue: string | null;
    unit: string;
    productType: string;
  }>,
  diffCentsList: number[],
): StoredAlternative[] {
  return inputs.map((a, i) => ({
    variantId: a.replacementVariantId,
    quantity: a.replacementQuantity,
    reason: a.reason ?? null,
    price: snapshots[i]?.priceText ?? "",
    priceDifference: formatPiastres(diffCentsList[i] ?? 0),
    variantName: snapshots[i]?.variantName ?? "",
    productName: snapshots[i]?.productName ?? "",
    sizeValue: snapshots[i]?.sizeValue ?? null,
    unit: snapshots[i]?.unit ?? "",
    productType: snapshots[i]?.productType ?? "PIECE",
  }));
}

export function serializeStoredAlternatives(
  alternatives: StoredAlternative[],
  proposalReason: string | null,
  chosenIndex: number | null = null,
): string {
  return JSON.stringify({ version: 1, proposalReason: proposalReason ?? null, chosenIndex, alternatives } satisfies StoredAlternativesEnvelope);
}

export function parseStoredAlternativesEnvelope(reason: string | null | undefined): StoredAlternativesEnvelope | null {
  if (!reason || reason.length > 32_768) return null;
  try {
    const parsed = JSON.parse(reason);
    const v1 = storedEnvelopeSchema.safeParse(parsed);
    if (v1.success) return v1.data;
    const legacy = z.array(storedAlternativeSchema).min(1).max(5).safeParse(parsed);
    return legacy.success
      ? { version: 1, proposalReason: null, chosenIndex: null, alternatives: legacy.data }
      : null;
  } catch {
    return null;
  }
}

export function parseStoredAlternatives(reason: string | null | undefined): StoredAlternative[] {
  return parseStoredAlternativesEnvelope(reason)?.alternatives ?? [];
}
