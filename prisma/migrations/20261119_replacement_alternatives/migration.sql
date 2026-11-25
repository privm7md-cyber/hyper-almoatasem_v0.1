-- Owner decision update (2026-11-19): multi-alternative replacement proposals.
--
-- ONE proposal (order_item_replacements) may offer MULTIPLE alternatives
-- (order_item_replacement_alternatives). The customer picks ONE alternative
-- (is_chosen); the proposal row itself stays the frozen, singular aggregate
-- row (first alternative mirrored into its singular columns by the app).
--
-- Additive only: new table + FKs + index. No DDL to existing data paths,
-- no constraint changes on order_item_replacements (uq_replacements_one_proposed
-- stays — there is still ONE open proposal per item, as frozen).

CREATE TABLE "order_item_replacement_alternatives" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "replacement_id" uuid NOT NULL,
    "variant_id" uuid NOT NULL,
    "quantity" numeric(12, 3) NOT NULL,
    "seq" smallint NOT NULL,
    "is_chosen" boolean NOT NULL DEFAULT false,
    "status" character varying(24) NOT NULL DEFAULT 'PROPOSED',
    "reason" text,
    "created_at" timestamptz(6) NOT NULL DEFAULT now(),
    "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
    CONSTRAINT "order_item_replacement_alternatives_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "order_item_replacement_alternatives"
    ADD CONSTRAINT "fk_repl_alt_replacement"
    FOREIGN KEY ("replacement_id") REFERENCES "order_item_replacements"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "order_item_replacement_alternatives"
    ADD CONSTRAINT "fk_repl_alt_variant"
    FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "idx_repl_alt_replacement" ON "order_item_replacement_alternatives"("replacement_id");
CREATE INDEX "idx_repl_alt_status" ON "order_item_replacement_alternatives"("replacement_id", "status");
