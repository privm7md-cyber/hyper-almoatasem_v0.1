// BA-7 replacement input validation (boundary layer, Zod only).
//
// Mirrors frozen CHECK shapes without re-owning them: the database remains
// the sole enforcer; these schemas reject malformed input early with 400.
// Quantity/step/pack rules, lifecycle gates, and caps live in writes.ts.
import { z } from "zod";
import { uuidSchema } from "../api/validation";
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

export const proposeInputSchema = z
  .object({
    replacementVariantId: uuidSchema,
    replacementQuantity: replacementQuantitySchema,
    reason: z.string().trim().max(2000).nullish(),
    /** OOS-driven (default true): original PENDING→UNAVAILABLE same-tx.
     * False = swap proposal: original stays PENDING (frozen by R2). */
    markUnavailable: z.boolean().nullish(),
  })
  .strict();

export const decideInputSchema = z
  .object({
    customerId: uuidSchema,
    action: decideActionSchema,
  })
  .strict();

export type ProposeInput = z.infer<typeof proposeInputSchema>;
export type DecideAction = z.infer<typeof decideActionSchema>;
