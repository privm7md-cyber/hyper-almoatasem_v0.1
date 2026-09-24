-- ============================================================================
-- HYPERMARKET STORE — PHASE 4 SCHEMA: PROMOTIONS + COUPONS
-- ============================================================================
-- APPLY ORDER: db/phase1-schema.sql → db/phase1-seed-example.sql (optional) →
--              db/phase2-schema.sql → db/phase2-seed-example.sql (optional) →
--              THEN this file. Requires Phase 1/2 objects incl. set_updated_at(),
--              product_variants(id), customers(id), orders(id), order_items(id).
-- SCOPE: 7 tables, no sequences, no new views. NO payments / delivery / auth /
--        roles tables. Phase 1 + Phase 2 are FROZEN — this file alters no frozen
--        object and adds no column to any frozen table.
-- CONVENTIONS (frozen): app-generated UUIDv7 ids, gen_random_uuid() backstop
-- (pgcrypto), NUMERIC(10,2) money, NUMERIC(12,3) quantities, RESTRICT-by-default
-- FKs, append-only histories, READ COMMITTED + row locks (no isolation change).
-- FROZEN RULES (implemented here as CHECKs; engine semantics live in the
-- application layer per architecture):
--   * BASE PRICE NEVER MOVES — discounts live in order_discounts + mirrors only.
--   * EFFECTIVE promotion ⟺ status='ACTIVE' AND in [start_at, end_at]
--     (NULL bounds = open). EXPIRED/SCHEDULED derived, never stored.
--   * Targets are OR-matched; CATEGORY matches subtree-inclusive.
--   * Evaluation order: priority DESC → specificity VARIANT>PRODUCT>BRAND>CATEGORY
--     → created_at ASC. Sequential compounding on current net, never additive.
--   * Layers: line-autos → order-autos → ONE coupon. Coupon minimum on merchandise
--     GROSS pre-discount (excl. delivery); coupon base = NET after line promos.
--   * Counters tx-maintained (conditional bump + rowcount); cancelled excluded.
-- ============================================================================

-- ============================== PROMOTIONS ==================================
-- Discount definition header. Value columns are TYPE-GATED: exactly the columns
-- belonging to the row's type are NOT NULL, the rest NULL (meaningless combos
-- rejected at INSERT/UPDATE, not in application code).

CREATE TABLE promotions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(160) NOT NULL CONSTRAINT chk_promos_name CHECK (name <> ''),
  description TEXT NULL,
  type        VARCHAR(20) NOT NULL
                CONSTRAINT chk_promos_type CHECK (
                  type IN ('PERCENTAGE','FIXED_AMOUNT','BUY_X_GET_Y','FIXED_PRICE')),
  scope       VARCHAR(10) NOT NULL
                CONSTRAINT chk_promos_scope CHECK (scope IN ('LINE','ORDER')),
  -- Administrative status only (A4). Temporal validity from start_at/end_at.
  status      VARCHAR(10) NOT NULL DEFAULT 'DRAFT'
                CONSTRAINT chk_promos_status CHECK (status IN ('DRAFT','ACTIVE','DISABLED')),
  start_at    TIMESTAMPTZ NULL,   -- NULL = no lower bound
  end_at      TIMESTAMPTZ NULL,   -- NULL = no upper bound
  -- Value payload (exactly one shape per type — see chk_promos_values).
  discount_percent NUMERIC(5,2) NULL
                     CONSTRAINT chk_promos_pct CHECK (
                       discount_percent IS NULL
                       OR (discount_percent > 0 AND discount_percent <= 100)),
  discount_amount  NUMERIC(10,2) NULL
                     CONSTRAINT chk_promos_amt CHECK (
                       discount_amount IS NULL OR discount_amount > 0),
  fixed_price      NUMERIC(10,2) NULL
                     CONSTRAINT chk_promos_fix CHECK (
                       fixed_price IS NULL OR fixed_price >= 0),
  priority    INTEGER NOT NULL DEFAULT 0,   -- application ORDER (not "best")
  is_stackable BOOLEAN NOT NULL DEFAULT FALSE,
  usage_limit INTEGER NULL CONSTRAINT chk_promos_limit CHECK (
                usage_limit IS NULL OR usage_limit > 0),   -- NULL = unlimited
  used_count  INTEGER NOT NULL DEFAULT 0 CONSTRAINT chk_promos_used CHECK (used_count >= 0),
  created_by  UUID NULL,   -- FK lands with staff model (later phase); matches frozen pattern
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ NULL,
  -- Type × scope × value gating (A3 + scope rules).
  CONSTRAINT chk_promos_values CHECK (
    (type = 'PERCENTAGE' AND discount_percent IS NOT NULL
       AND discount_amount IS NULL AND fixed_price IS NULL)
    OR (type = 'FIXED_AMOUNT' AND discount_amount IS NOT NULL
       AND discount_percent IS NULL AND fixed_price IS NULL)
    OR (type = 'FIXED_PRICE' AND scope = 'LINE' AND fixed_price IS NOT NULL
       AND discount_percent IS NULL AND discount_amount IS NULL)
    OR (type = 'BUY_X_GET_Y' AND scope = 'LINE'
       AND discount_percent IS NULL AND discount_amount IS NULL AND fixed_price IS NULL)),
  -- ORDER scope allows PERCENTAGE + FIXED_AMOUNT only (BXGY/FIXED_PRICE are LINE-only).
  CONSTRAINT chk_promos_scope_types CHECK (
    scope = 'LINE' OR type IN ('PERCENTAGE','FIXED_AMOUNT')),
  CONSTRAINT chk_promos_window CHECK (
    start_at IS NULL OR end_at IS NULL OR end_at > start_at),
  -- Backstop: counter can never exceed its limit through ANY writer.
  CONSTRAINT chk_promos_counter_cap CHECK (
    usage_limit IS NULL OR used_count <= usage_limit),
  CONSTRAINT chk_promos_deleted_consistency CHECK (
    deleted_at IS NULL OR status = 'DISABLED')
);
-- Candidate scan: effective-state filter (admin + window) for evaluation.
CREATE INDEX idx_promos_effective ON promotions (status, start_at, end_at);

-- ========================== PROMOTION TARGETS ===============================
-- OR-matched targeting. Polymorphic (target_type + target_id) with NO real FK —
-- deliberate trade-off (A2): existence + liveness validated at activation time,
-- orphan reconciliation via report; mirrors the frozen actor_id precedent.

CREATE TABLE promotion_targets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id UUID NOT NULL REFERENCES promotions (id)
                 ON DELETE CASCADE      -- targets die with their promo (only when
                 ON UPDATE CASCADE,     -- promo itself is deletable, i.e. unreferenced)
  target_type  VARCHAR(10) NOT NULL
                 CONSTRAINT chk_targets_type CHECK (
                   target_type IN ('VARIANT','PRODUCT','BRAND','CATEGORY')),
  target_id    UUID NOT NULL,   -- NO FK (see above); validated at activation
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Same target never twice on one promotion.
  CONSTRAINT uq_promo_target UNIQUE (promotion_id, target_type, target_id)
);
-- Evaluation probes: (1) lines → promos via target identity; (2) promo → its targets.
CREATE INDEX idx_targets_lookup ON promotion_targets (target_type, target_id);
CREATE INDEX idx_targets_promo ON promotion_targets (promotion_id);

-- =========================== PROMOTION RULES ================================
-- At most ONE row per promotion (UQ); missing row = unconstrained.
-- All present conditions are AND-conjunct (A6). Bases are estimate-time gross.

CREATE TABLE promotion_rules (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id     UUID NOT NULL UNIQUE REFERENCES promotions (id)
                     ON DELETE CASCADE
                     ON UPDATE CASCADE,
  -- Sum over ELIGIBLE lines (WEIGHT normalized to grams, PIECE in packs).
  minimum_quantity NUMERIC(12,3) NULL CONSTRAINT chk_rules_minqty CHECK (
                     minimum_quantity IS NULL OR minimum_quantity > 0),
  -- Eligible-lines GROSS pre-discount, excl. delivery and excl. other promos.
  minimum_amount   NUMERIC(10,2) NULL CONSTRAINT chk_rules_minamt CHECK (
                     minimum_amount IS NULL OR minimum_amount > 0),
  -- Cap on TOTAL discount granted by this promotion per order (A12).
  maximum_discount NUMERIC(10,2) NULL CONSTRAINT chk_rules_maxdisc CHECK (
                     maximum_discount IS NULL OR maximum_discount > 0),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ======================== PROMOTION BUY_GET RULES ===========================
-- 1:1 params for BUY_X_GET_Y (pairing with type enforced at activation, same tx).
-- Quantities in COUNTING units (packs / variant unit; WEIGHT step-multiples
-- validated at activation). free_variant_id NULL = same as triggering line.

CREATE TABLE promotion_buy_get_rules (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id       UUID NOT NULL UNIQUE REFERENCES promotions (id)
                       ON DELETE CASCADE
                       ON UPDATE CASCADE,
  buy_quantity       NUMERIC(12,3) NOT NULL CONSTRAINT chk_bxg_buy CHECK (buy_quantity > 0),
  get_quantity       NUMERIC(12,3) NOT NULL CONSTRAINT chk_bxg_get CHECK (get_quantity > 0),
  -- Case A (buy 2 get 1 free) => 100; Case B (get 1 at 50%) => 50.
  discount_percent   NUMERIC(5,2) NOT NULL CONSTRAINT chk_bxg_pct CHECK (
                       discount_percent > 0 AND discount_percent <= 100),
  free_variant_id    UUID NULL REFERENCES product_variants (id)
                       ON DELETE RESTRICT     -- a referenced free variant is protected
                       ON UPDATE CASCADE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ================================ COUPONS ===================================
-- Code access keys onto promotions (1 promo → N coupons). Codes stored NORMALIZED
-- (upper/trimmed/no-inner-space enforced below AND by the single writer path).

CREATE TABLE coupons (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id   UUID NOT NULL REFERENCES promotions (id)
                   ON DELETE CASCADE      -- coupons die with their promo (only when
                   ON UPDATE CASCADE,     -- promo itself is deletable, i.e. unreferenced)
  code           VARCHAR(64) NOT NULL UNIQUE
                   CONSTRAINT chk_coupons_code CHECK (
                     code <> '' AND code = upper(code) AND code = btrim(code)
                     AND position(' ' IN code) = 0),
  usage_limit    INTEGER NULL CONSTRAINT chk_coupons_limit CHECK (
                   usage_limit IS NULL OR usage_limit > 0),   -- NULL = unlimited
  used_count     INTEGER NOT NULL DEFAULT 0 CONSTRAINT chk_coupons_used CHECK (used_count >= 0),
  per_customer_limit INTEGER NULL CONSTRAINT chk_coupons_percust CHECK (
                   per_customer_limit IS NULL OR per_customer_limit >= 1),
  -- Order merchandise GROSS pre-discount, excl. delivery (A13/A24).
  minimum_order_amount NUMERIC(10,2) NULL CONSTRAINT chk_coupons_min CHECK (
                   minimum_order_amount IS NULL OR minimum_order_amount >= 0),
  start_at       TIMESTAMPTZ NULL,
  end_at         TIMESTAMPTZ NULL,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ NULL,
  CONSTRAINT chk_coupons_window CHECK (
    start_at IS NULL OR end_at IS NULL OR end_at > start_at),
  CONSTRAINT chk_coupons_counter_cap CHECK (
    usage_limit IS NULL OR used_count <= usage_limit),
  CONSTRAINT chk_coupons_deleted_consistency CHECK (
    deleted_at IS NULL OR is_active = FALSE)
);

-- ============================= COUPON USAGES =================================
-- Immutable redemption audit. NO is_revoked flag: liveness derives from
-- orders.status (cancelled orders excluded at count/reconciliation time).

CREATE TABLE coupon_usages (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id                 UUID NOT NULL REFERENCES coupons (id)
                              ON DELETE RESTRICT   -- usages are permanent history
                              ON UPDATE CASCADE,
  customer_id               UUID NOT NULL REFERENCES customers (id)
                              ON DELETE RESTRICT   -- guests included (unified model)
                              ON UPDATE CASCADE,
  order_id                  UUID NOT NULL UNIQUE REFERENCES orders (id)
                              ON DELETE RESTRICT   -- one coupon per order (A24)
                              ON UPDATE CASCADE,
  estimated_discount_amount NUMERIC(10,2) NOT NULL
                              CONSTRAINT chk_uses_est CHECK (estimated_discount_amount >= 0),
  final_discount_amount     NUMERIC(10,2) NULL   -- set exactly once at finalize
                              CONSTRAINT chk_uses_fin CHECK (
                                final_discount_amount IS NULL OR final_discount_amount >= 0),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
  -- Immutable by convention: no updated_at/deleted_at (mirrors frozen ledgers).
);
-- Per-customer limit accounting base: COUNT active usages per (coupon, customer).
CREATE INDEX idx_usages_coupon_customer ON coupon_usages (coupon_id, customer_id);

-- ============================ ORDER DISCOUNTS ===============================
-- Frozen application + allocation rows with FULL snapshots (A17/A20).
-- kinds: PROMOTION_LINE (item set) / PROMOTION_ORDER (item NULL) /
--        COUPON (coupon set, item NULL) / ALLOCATION (item + parent set).
-- promotion_id ALWAYS NOT NULL (no promotion-less/manual discounts — out of scope).
-- Estimated pairs written at checkout; final pairs set exactly once at finalize
-- from ROW data only (never re-reads live promotions — A19).

CREATE TABLE order_discounts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           UUID NOT NULL REFERENCES orders (id)
                       ON DELETE RESTRICT     -- discount history never deleted
                       ON UPDATE CASCADE,
  order_item_id      UUID NULL REFERENCES order_items (id)
                       ON DELETE RESTRICT
                       ON UPDATE CASCADE,
  promotion_id       UUID NOT NULL REFERENCES promotions (id)
                       ON DELETE RESTRICT
                       ON UPDATE CASCADE,
  coupon_id          UUID NULL REFERENCES coupons (id)
                       ON DELETE RESTRICT
                       ON UPDATE CASCADE,
  kind               VARCHAR(16) NOT NULL
                       CONSTRAINT chk_od_kind CHECK (
                         kind IN ('PROMOTION_LINE','PROMOTION_ORDER','COUPON','ALLOCATION')),
  -- Frozen commercial snapshot (minimal per A20).
  promotion_name_snapshot VARCHAR(160) NOT NULL
                            CONSTRAINT chk_od_pname CHECK (promotion_name_snapshot <> ''),
  type_snapshot           VARCHAR(20) NOT NULL
                            CONSTRAINT chk_od_type CHECK (
                              type_snapshot IN ('PERCENTAGE','FIXED_AMOUNT','BUY_X_GET_Y','FIXED_PRICE')),
  scope_snapshot          VARCHAR(10) NOT NULL
                            CONSTRAINT chk_od_scope CHECK (scope_snapshot IN ('LINE','ORDER')),
  applied_percent         NUMERIC(5,2) NULL,
  applied_amount          NUMERIC(10,2) NULL
                            CONSTRAINT chk_od_applied_amt CHECK (
                              applied_amount IS NULL OR applied_amount >= 0),
  applied_fixed_price     NUMERIC(10,2) NULL
                            CONSTRAINT chk_od_applied_fix CHECK (
                              applied_fixed_price IS NULL OR applied_fixed_price >= 0),
  cap_amount              NUMERIC(10,2) NULL
                            CONSTRAINT chk_od_cap CHECK (
                              cap_amount IS NULL OR cap_amount >= 0),
  base_estimated          NUMERIC(10,2) NOT NULL
                            CONSTRAINT chk_od_base_est CHECK (base_estimated >= 0),
  discount_estimated      NUMERIC(10,2) NOT NULL
                            CONSTRAINT chk_od_disc_est CHECK (discount_estimated >= 0),
  base_final              NUMERIC(10,2) NULL
                            CONSTRAINT chk_od_base_fin CHECK (
                              base_final IS NULL OR base_final >= 0),
  discount_final          NUMERIC(10,2) NULL
                            CONSTRAINT chk_od_disc_fin CHECK (
                              discount_final IS NULL OR discount_final >= 0),
  -- Allocation linkage: ALLOCATION rows point at their application row (no nesting).
  parent_discount_id      UUID NULL REFERENCES order_discounts (id)
                            ON DELETE RESTRICT
                            ON UPDATE CASCADE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Kind shape discipline (A17).
  CONSTRAINT chk_od_kind_shape CHECK (
    (kind = 'PROMOTION_LINE' AND order_item_id IS NOT NULL AND coupon_id IS NULL
       AND parent_discount_id IS NULL)
    OR (kind = 'PROMOTION_ORDER' AND order_item_id IS NULL AND coupon_id IS NULL
       AND parent_discount_id IS NULL)
    OR (kind = 'COUPON' AND coupon_id IS NOT NULL AND order_item_id IS NULL
       AND parent_discount_id IS NULL)
    OR (kind = 'ALLOCATION' AND order_item_id IS NOT NULL
       AND parent_discount_id IS NOT NULL)),
  -- Applied-value shape mirrors the promotions type gate (frozen at apply time).
  -- ALLOCATION children carry NO applied values by design (the parent application
  -- row owns the snapshot); they carry only the split base/discount + parent link.
  CONSTRAINT chk_od_applied_shape CHECK (
    (kind = 'ALLOCATION' AND applied_percent IS NULL AND applied_amount IS NULL
       AND applied_fixed_price IS NULL AND cap_amount IS NULL)
    OR (kind <> 'ALLOCATION' AND (
      (type_snapshot = 'PERCENTAGE' AND applied_percent IS NOT NULL
         AND applied_amount IS NULL AND applied_fixed_price IS NULL)
      OR (type_snapshot = 'FIXED_AMOUNT' AND applied_amount IS NOT NULL
         AND applied_percent IS NULL AND applied_fixed_price IS NULL)
      OR (type_snapshot = 'FIXED_PRICE' AND applied_fixed_price IS NOT NULL
         AND applied_percent IS NULL AND applied_amount IS NULL)
      OR (type_snapshot = 'BUY_X_GET_Y' AND applied_percent IS NOT NULL
         AND applied_amount IS NULL AND applied_fixed_price IS NULL)))),
  -- Money guardrails (A11/A37): never negative, never above eligible base.
  CONSTRAINT chk_od_est_bound CHECK (discount_estimated <= base_estimated),
  CONSTRAINT chk_od_fin_bound CHECK (
    discount_final IS NULL
    OR (base_final IS NOT NULL AND discount_final <= base_final))
  -- Immutable by convention: no updated_at/deleted_at. Final pairs are set once
  -- at finalize as part of order completion (same lifecycle as
  -- order_items.final_total), never revised afterwards.
);
CREATE INDEX idx_od_order_id ON order_discounts (order_id);
CREATE INDEX idx_od_order_item_id ON order_discounts (order_item_id);
CREATE INDEX idx_od_promotion_id ON order_discounts (promotion_id);
CREATE INDEX idx_od_coupon_id ON order_discounts (coupon_id);

-- ================================ TRIGGERS ==================================
-- Reuses the frozen set_updated_at() (no new functions needed — no ordered state
-- machines exist in Phase 4 scope; admin status flips are unordered SETs).

CREATE TRIGGER trg_promos_updated_at
  BEFORE UPDATE ON promotions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_coupons_updated_at
  BEFORE UPDATE ON coupons FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================ FROZEN CONTRACT NOTES =========================
-- The following are ENFORCED BY WRITER DISCIPLINE + review (inexpressible as
-- same-row CHECKs); each has a reconciliation query for audit:
--  1. promotion_rules pairing: a BUY_X_GET_Y promotion owns exactly one
--     promotion_buy_get_rules row (created in the same activation tx).
--  2. order_items.discount_amount mirror = SUM of line-attributed rows
--     (PROMOTION_LINE + ALLOCATION) for that item; updated at checkout AND finalize.
--  3. orders.discount_total = SUM of all application rows (PROMOTION_LINE +
--     PROMOTION_ORDER + COUPON) on estimate basis at checkout, recomputed on
--     final basis at finalize; ALLOCATION rows never counted (children).
--  4. Value/target/rule columns of a promotion become immutable once ANY
--     order_discounts row references it (disable/schedule/soft-delete stay allowed).
--  5. ALLOCATION parent must be a non-ALLOCATION row (no nesting).
--  6. Counter maintenance: conditional bump (used_count+1 WHERE limit open) +
--     rowcount check, same tx as the consuming order; decrement in cancel tx.
--     Cancelled/refunded orders excluded from limit math via orders.status.
