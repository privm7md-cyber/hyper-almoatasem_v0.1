-- ============================================================================
-- HYPERMARKET STORE — PHASE 2 SCHEMA: CUSTOMERS + CART + ORDERS + REPLACEMENTS
-- ============================================================================
-- APPLY ORDER: db/phase1-schema.sql  THEN  db/phase1-seed-example.sql (optional)
--              THEN this file. Requires Phase 1 objects:
--              set_updated_at(), product_variants(id), inventory, inventory_movements.
-- SCOPE: 8 tables + 1 sequence + transition triggers. NO payments / delivery /
--        auth tables. Phase 1 is FROZEN — this file creates nothing outside
--        Phase 2 scope and alters no Phase 1 object.
-- CONVENTIONS (from frozen architecture): app-generated UUIDv7 ids,
-- gen_random_uuid() backstop (pgcrypto), NUMERIC(10,2) money, NUMERIC(12,3)
-- quantities, RESTRICT-by-default FKs, append-only ledgers.
-- STATE MACHINES (DB-enforced, see triggers/checks below):
--   carts: ACTIVE -> CHECKED_OUT|ABANDONED|EXPIRED|MERGED (terminal)
--   orders (via order_status_history rows): NEW->CONFIRMED->PREPARING->
--     READY_FOR_DELIVERY->OUT_FOR_DELIVERY->DELIVERED; NEW|CONFIRMED|PREPARING->CANCELLED
--   order_items: PENDING->FULFILLED|PARTIALLY_FULFILLED|UNAVAILABLE|REPLACED|CANCELLED
--     + UNAVAILABLE->REPLACED
--   replacements: PROPOSED->CUSTOMER_APPROVED|CUSTOMER_REJECTED|AUTO_ACCEPTED
-- ============================================================================

-- ============================ TRANSITION GUARDS =============================

-- Carts: terminal states have no outgoing transitions.
CREATE OR REPLACE FUNCTION check_cart_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    IF OLD.status <> 'ACTIVE' THEN
      RAISE EXCEPTION 'Cart % is terminal (%) — no further transitions', OLD.id, OLD.status;
    END IF;
    -- ACTIVE -> one of the 4 terminals (domain CHECK already restricts the set).
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Order items: frozen transition table (R2: includes UNAVAILABLE->REPLACED and
-- PENDING->REPLACED for swap-driven approvals).
CREATE OR REPLACE FUNCTION check_order_item_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.item_status IS DISTINCT FROM NEW.item_status THEN
    IF (OLD.item_status, NEW.item_status) IN (
      ('PENDING','FULFILLED'), ('PENDING','PARTIALLY_FULFILLED'),
      ('PENDING','UNAVAILABLE'), ('PENDING','REPLACED'), ('PENDING','CANCELLED'),
      ('UNAVAILABLE','REPLACED')
    ) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Invalid order item transition % → %', OLD.item_status, NEW.item_status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Replacements: PROPOSED -> terminal decision only (R5: withdrawal rides REJECTED).
CREATE OR REPLACE FUNCTION check_replacement_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    IF (OLD.status, NEW.status) IN (
      ('PROPOSED','CUSTOMER_APPROVED'), ('PROPOSED','CUSTOMER_REJECTED'),
      ('PROPOSED','AUTO_ACCEPTED')
    ) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Invalid replacement transition % → %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- orders.status must always be backed by a matching history row.
-- Write order: INSERT order_status_history, THEN UPDATE orders.status (same tx).
-- EXISTS (not "latest") semantics: rows in one tx share now() timestamps, so
-- latest-row detection is unreliable intra-tx; the transition CHECK on the history
-- row itself already proves the step is legal — this trigger proves it EXISTS.
CREATE OR REPLACE FUNCTION check_order_status_audited()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    IF NOT EXISTS (SELECT 1 FROM order_status_history h
                    WHERE h.order_id = NEW.id AND h.new_status = NEW.status) THEN
      RAISE EXCEPTION 'Order % status change to % has no matching history row', NEW.id, NEW.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================= CUSTOMERS ====================================

CREATE TABLE customers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name  VARCHAR(80) NOT NULL CONSTRAINT chk_customers_first_name CHECK (first_name <> ''),
  last_name   VARCHAR(80) NULL,
  -- Canonical Egyptian mobile, digits only (R8: app normalizes to 2010XXXXXXXX
  -- BEFORE write; DB constrains shape + uniqueness, never normalizes).
  phone       VARCHAR(20) NOT NULL UNIQUE
                CONSTRAINT chk_customers_phone_format CHECK (phone ~ '^[0-9]{8,15}$'),
  email       VARCHAR(160) NULL
                CONSTRAINT chk_customers_email_format CHECK (
                  email IS NULL OR (position('@' IN email) > 1 AND position(' ' IN email) = 0)),
  password_hash VARCHAR(255) NULL,   -- NULL = guest; SET on registration/upgrade
  is_registered BOOLEAN NOT NULL DEFAULT FALSE,
  auto_accept_replacements BOOLEAN NOT NULL DEFAULT FALSE,  -- R5 pre-consent flag
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ NULL,
  CONSTRAINT chk_customers_registered CHECK (
    is_registered = FALSE OR password_hash IS NOT NULL),
  CONSTRAINT chk_customers_deleted_consistency CHECK (
    deleted_at IS NULL OR is_active = FALSE)
);
-- Partial UQ: many NULLs allowed, every present email unique.
CREATE UNIQUE INDEX uq_customers_email ON customers (email) WHERE email IS NOT NULL;

-- ========================= CUSTOMER ADDRESSES ===============================
-- Owner-managed book. Hard-deletable (orders carry Option-B snapshots, never FKs here).
-- NO governorate (intentionally excluded). NO deleted_at (DELETE allowed).

CREATE TABLE customer_addresses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     UUID NOT NULL REFERENCES customers (id)
                    ON DELETE RESTRICT
                    ON UPDATE CASCADE,
  label           VARCHAR(30) NULL,   -- home / work …
  city            VARCHAR(80) NOT NULL CONSTRAINT chk_addresses_city CHECK (city <> ''),
  area            VARCHAR(80) NULL,
  village         VARCHAR(80) NULL,
  street          VARCHAR(120) NULL,
  building_number VARCHAR(30) NULL,
  landmark        VARCHAR(160) NULL,
  -- Delivery contact: looser than identity (landline possible); canonicalize when mobile.
  phone           VARCHAR(20) NOT NULL
                    CONSTRAINT chk_addresses_phone_format CHECK (phone ~ '^[0-9]{8,15}$'),
  is_default      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_addresses_customer_id ON customer_addresses (customer_id);
-- At most one default address per customer (R: switch = unset old + set new, one tx).
CREATE UNIQUE INDEX uq_addresses_one_default
  ON customer_addresses (customer_id) WHERE is_default;

-- ================================ CARTS =====================================
-- Draft container. NEVER reserves inventory (decision A7).

CREATE TABLE carts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NULL REFERENCES customers (id)
                 ON DELETE RESTRICT
                 ON UPDATE CASCADE,
  session_id  VARCHAR(64) NULL   -- opaque ≥128-bit server-random guest token, stored hashed
                CONSTRAINT chk_carts_session_format CHECK (
                  session_id IS NULL OR (session_id <> '' AND position(' ' IN session_id) = 0)),
  status      VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
                CONSTRAINT chk_carts_status CHECK (
                  status IN ('ACTIVE','CHECKED_OUT','ABANDONED','EXPIRED','MERGED')),
  expires_at  TIMESTAMPTZ NULL,  -- guest TTL (≈+30d config); registered NULL = persistent
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- R1: XOR ownership — exactly one owner kind; merge NULLs the losing key same-tx.
  CONSTRAINT chk_carts_ownership CHECK ((customer_id IS NULL) <> (session_id IS NULL))
);
-- One ACTIVE cart per customer and per session (also serves the hot lookups).
CREATE UNIQUE INDEX uq_carts_active_customer ON carts (customer_id) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX uq_carts_active_session ON carts (session_id) WHERE status = 'ACTIVE';
-- Sweeper: find stale ACTIVE carts to ABANDON/EXPIRE.
CREATE INDEX idx_carts_sweeper ON carts (status, updated_at);

-- ============================== CART ITEMS ==================================
-- Quote-semantics draft lines. Quantity in the COUNTING unit (frozen A11/A12 pin):
-- 'PIECE' (packs) for PIECE-type lines, variant size_unit for WEIGHT lines.
-- A mismatch against the live counting unit aborts the line at checkout
-- (no silent conversion, e.g. 0.5 KG pack-count reinterpretation).

CREATE TABLE cart_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id             UUID NOT NULL REFERENCES carts (id)
                        ON DELETE CASCADE      -- operational child; retention-purge safe
                        ON UPDATE CASCADE,
  product_variant_id  UUID NOT NULL REFERENCES product_variants (id)
                        ON DELETE RESTRICT
                        ON UPDATE CASCADE,
  quantity            NUMERIC(12,3) NOT NULL CONSTRAINT chk_cart_items_qty CHECK (quantity > 0),
  unit_snapshot       VARCHAR(10) NOT NULL
                        CONSTRAINT chk_cart_items_unit CHECK (
                          unit_snapshot IN ('PIECE','KG','GRAM','LITER','ML')),
  unit_price_snapshot NUMERIC(10,2) NULL
                        CONSTRAINT chk_cart_items_price CHECK (
                          unit_price_snapshot IS NULL OR unit_price_snapshot >= 0),
  price_checked_at    TIMESTAMPTZ NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Re-adding a variant aggregates quantity (service upserts); never duplicate lines.
  CONSTRAINT uq_cart_items_line UNIQUE (cart_id, product_variant_id)
);
CREATE INDEX idx_cart_items_cart_id ON cart_items (cart_id);

-- ================================ ORDERS ====================================
-- Frozen commercial record. Money: DB-balanced estimate CHECKs; finals NULL until
-- picking is terminal. NO payment_status / paid_at / provider columns (R6/R9: Phase 3 owns them).

CREATE SEQUENCE order_number_seq;   -- app formats HM-YYYYMMDD-<nextval, zero-padded 6>; gaps OK

CREATE TABLE orders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number  VARCHAR(24) NOT NULL UNIQUE
                  CONSTRAINT chk_orders_number_format CHECK (
                    order_number ~ '^HM-[0-9]{8}-[0-9]{6}$'),
  customer_id   UUID NOT NULL REFERENCES customers (id)
                  ON DELETE RESTRICT
                  ON UPDATE CASCADE,
  cart_id       UUID NULL REFERENCES carts (id)
                  ON DELETE SET NULL     -- cart operational, order permanent
                  ON UPDATE CASCADE,
  idempotency_key VARCHAR(64) NULL UNIQUE
                  CONSTRAINT chk_orders_idem_format CHECK (
                    idempotency_key IS NULL OR (
                      idempotency_key <> '' AND position(' ' IN idempotency_key) = 0)),
  status        VARCHAR(24) NOT NULL DEFAULT 'NEW'
                  CONSTRAINT chk_orders_status CHECK (status IN (
                    'NEW','CONFIRMED','PREPARING','READY_FOR_DELIVERY',
                    'OUT_FOR_DELIVERY','DELIVERED','CANCELLED')),
  subtotal_estimated NUMERIC(10,2) NOT NULL CONSTRAINT chk_orders_subest CHECK (subtotal_estimated >= 0),
  discount_total     NUMERIC(10,2) NOT NULL DEFAULT 0 CONSTRAINT chk_orders_disc CHECK (discount_total >= 0),
  delivery_fee       NUMERIC(10,2) NOT NULL DEFAULT 0 CONSTRAINT chk_orders_fee CHECK (delivery_fee >= 0),
  total_estimated    NUMERIC(10,2) NOT NULL CONSTRAINT chk_orders_totest CHECK (total_estimated >= 0),
  subtotal_final     NUMERIC(10,2) NULL CONSTRAINT chk_orders_subfin CHECK (
                       subtotal_final IS NULL OR subtotal_final >= 0),
  total_final        NUMERIC(10,2) NULL CONSTRAINT chk_orders_totfin CHECK (
                       total_final IS NULL OR total_final >= 0),
  -- Frozen identity + Option-B address snapshot (survives address edits/deletes).
  customer_name_snapshot  VARCHAR(160) NOT NULL
                            CONSTRAINT chk_orders_cname CHECK (customer_name_snapshot <> ''),
  customer_phone_snapshot VARCHAR(20) NOT NULL
                            CONSTRAINT chk_orders_cphone CHECK (
                              customer_phone_snapshot ~ '^[0-9]{8,15}$'),
  delivery_city      VARCHAR(80) NOT NULL CONSTRAINT chk_orders_dcity CHECK (delivery_city <> ''),
  delivery_area      VARCHAR(80) NULL,
  delivery_village   VARCHAR(80) NULL,
  delivery_street    VARCHAR(120) NULL,
  delivery_building  VARCHAR(30) NULL,
  delivery_landmark  VARCHAR(160) NULL,
  delivery_phone     VARCHAR(20) NOT NULL CONSTRAINT chk_orders_dphone CHECK (
                       delivery_phone ~ '^[0-9]{8,15}$'),
  notes              TEXT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Totals integrity (A24): discount capped at subtotal; both totals DB-balanced.
  CONSTRAINT chk_orders_discount_cap CHECK (discount_total <= subtotal_estimated),
  CONSTRAINT chk_orders_total_estimated CHECK (
    total_estimated = subtotal_estimated - discount_total + delivery_fee),
  CONSTRAINT chk_orders_total_final CHECK (
    total_final IS NULL
    OR (subtotal_final IS NOT NULL
        AND total_final = subtotal_final - LEAST(discount_total, subtotal_final) + delivery_fee))
);
CREATE INDEX idx_orders_customer_time ON orders (customer_id, created_at DESC);
CREATE INDEX idx_orders_status_time ON orders (status, created_at);

-- ============================== ORDER ITEMS =================================
-- Frozen lines. Snapshots render history and price it with zero live-catalog JOINs.

CREATE TABLE order_items (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           UUID NOT NULL REFERENCES orders (id)
                       ON DELETE RESTRICT     -- orders never hard-deleted; fail loud
                       ON UPDATE CASCADE,
  product_variant_id UUID NOT NULL REFERENCES product_variants (id)
                       ON DELETE RESTRICT
                       ON UPDATE CASCADE,
  product_name_snapshot VARCHAR(160) NOT NULL
                          CONSTRAINT chk_items_pname CHECK (product_name_snapshot <> ''),
  variant_name_snapshot VARCHAR(120) NOT NULL
                          CONSTRAINT chk_items_vname CHECK (variant_name_snapshot <> ''),
  brand_name_snapshot  VARCHAR(120) NULL,   -- NULL for loose/unbranded goods
  product_code_snapshot VARCHAR(64) NULL,   -- primary code at order time (else NULL)
  code_type_snapshot    VARCHAR(20) NULL
                          CONSTRAINT chk_items_ctype CHECK (
                            code_type_snapshot IS NULL
                            OR code_type_snapshot IN ('BARCODE','INTERNAL_CODE')),
  unit_snapshot         VARCHAR(10) NOT NULL   -- frozen COUNTING unit (see cart_items note)
                          CONSTRAINT chk_items_unit CHECK (
                            unit_snapshot IN ('PIECE','KG','GRAM','LITER','ML')),
  product_type_snapshot VARCHAR(10) NOT NULL   -- interprets quantity (A13)
                          CONSTRAINT chk_items_ptype CHECK (
                            product_type_snapshot IN ('PIECE','WEIGHT')),
  sale_step_snapshot    INTEGER NULL,          -- offer rule at order time
  unit_price            NUMERIC(10,2) NOT NULL -- FROZEN price (Phase 1 §A15)
                          CONSTRAINT chk_items_price CHECK (unit_price >= 0),
  requested_quantity    NUMERIC(12,3) NOT NULL
                          CONSTRAINT chk_items_req CHECK (requested_quantity > 0),
  actual_quantity       NUMERIC(12,3) NULL     -- NULL until picked; PREPARING-only writes
                          CONSTRAINT chk_items_act CHECK (
                            actual_quantity IS NULL OR actual_quantity > 0),
  estimated_total       NUMERIC(10,2) NOT NULL
                          CONSTRAINT chk_items_est CHECK (estimated_total >= 0),
  final_total           NUMERIC(10,2) NULL
                          CONSTRAINT chk_items_fin CHECK (
                            final_total IS NULL OR final_total >= 0),
  discount_amount       NUMERIC(10,2) NOT NULL DEFAULT 0
                          CONSTRAINT chk_items_disc CHECK (discount_amount >= 0),
  item_status           VARCHAR(24) NOT NULL DEFAULT 'PENDING'
                          CONSTRAINT chk_items_status CHECK (item_status IN (
                            'PENDING','FULFILLED','PARTIALLY_FULFILLED',
                            'UNAVAILABLE','REPLACED','CANCELLED')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_items_code_pair CHECK (
    (product_code_snapshot IS NULL) = (code_type_snapshot IS NULL)),
  -- Step mirror rule (same shape as Phase 1 product rule, frozen at order time).
  CONSTRAINT chk_items_step_mirror CHECK (
    (product_type_snapshot = 'WEIGHT' AND sale_step_snapshot IS NOT NULL
       AND sale_step_snapshot > 0)
    OR (product_type_snapshot = 'PIECE' AND sale_step_snapshot IS NULL)),
  -- Money math, DB-verified (A21): single ROUND(qty × price, 2) rule.
  CONSTRAINT chk_items_estimated_math CHECK (
    estimated_total = round(requested_quantity * unit_price, 2)),
  CONSTRAINT chk_items_final_math CHECK (
    final_total IS NULL
    OR (actual_quantity IS NOT NULL
        AND final_total = round(actual_quantity * unit_price, 2))),
  CONSTRAINT chk_items_discount_cap CHECK (discount_amount <= estimated_total),
  -- Status ↔ actual linkage.
  CONSTRAINT chk_items_pending_no_actual CHECK (
    item_status <> 'PENDING' OR actual_quantity IS NULL),
  CONSTRAINT chk_items_fulfilled_actual CHECK (
    item_status <> 'FULFILLED' OR actual_quantity IS NOT NULL),
  CONSTRAINT chk_items_partial_actual CHECK (
    item_status <> 'PARTIALLY_FULFILLED'
    OR (actual_quantity IS NOT NULL AND actual_quantity <> requested_quantity))
);
CREATE INDEX idx_order_items_order_id ON order_items (order_id);
CREATE INDEX idx_order_items_variant_id ON order_items (product_variant_id);

-- ========================== ORDER STATUS HISTORY ============================
-- Append-only lifecycle audit. Transition whitelist incl. creation pair (A26).

CREATE TABLE order_status_history (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   UUID NOT NULL REFERENCES orders (id)
               ON DELETE RESTRICT
               ON UPDATE CASCADE,
  old_status VARCHAR(24) NULL,   -- NULL only on the creation row
  new_status VARCHAR(24) NOT NULL
               CONSTRAINT chk_history_new CHECK (new_status IN (
                 'NEW','CONFIRMED','PREPARING','READY_FOR_DELIVERY',
                 'OUT_FOR_DELIVERY','DELIVERED','CANCELLED')),
  actor_type VARCHAR(10) NOT NULL
               CONSTRAINT chk_history_actor_type CHECK (
                 actor_type IN ('SYSTEM','CUSTOMER','STAFF')),
  actor_id   UUID NULL,   -- FKs land with the staff model (later phase); pairing enforced now
  note       TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- SYSTEM acts anonymously; humans are always identified (A25).
  CONSTRAINT chk_history_actor CHECK (
    (actor_type = 'SYSTEM' AND actor_id IS NULL)
    OR (actor_type <> 'SYSTEM' AND actor_id IS NOT NULL)),
  -- Invalid transitions die at INSERT (NULL-safe formulation).
  CONSTRAINT chk_history_transition CHECK (
    (old_status IS NULL AND new_status = 'NEW')
    OR (old_status IS NOT NULL AND (old_status, new_status) IN (
      ('NEW','CONFIRMED'), ('CONFIRMED','PREPARING'),
      ('PREPARING','READY_FOR_DELIVERY'),
      ('READY_FOR_DELIVERY','OUT_FOR_DELIVERY'), ('OUT_FOR_DELIVERY','DELIVERED'),
      ('NEW','CANCELLED'), ('CONFIRMED','CANCELLED'), ('PREPARING','CANCELLED')))
  )
  -- Immutable by convention: no updated_at/deleted_at (mirrors Phase 1 ledgers).
);
CREATE INDEX idx_status_history_order_time ON order_status_history (order_id, created_at);

-- ======================== ORDER ITEM REPLACEMENTS ===========================
-- Proposal + decision + materialization link. Original line is NEVER edited here.

CREATE TABLE order_item_replacements (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id            UUID NOT NULL REFERENCES order_items (id)
                             ON DELETE RESTRICT
                             ON UPDATE CASCADE,
  replacement_variant_id   UUID NOT NULL REFERENCES product_variants (id)
                             ON DELETE RESTRICT
                             ON UPDATE CASCADE,
  replacement_quantity     NUMERIC(12,3) NOT NULL
                             CONSTRAINT chk_repl_qty CHECK (replacement_quantity > 0),
  replacement_unit_price   NUMERIC(10,2) NOT NULL   -- frozen substitute price
                             CONSTRAINT chk_repl_price CHECK (replacement_unit_price >= 0),
  -- Agreed signed delta vs original estimate. No cross-row CHECK is expressible;
  -- service computes AND verifies (reconciliation report); stored to freeze the agreement.
  price_difference         NUMERIC(10,2) NOT NULL,
  reason                   TEXT NULL,
  status                   VARCHAR(24) NOT NULL DEFAULT 'PROPOSED'
                             CONSTRAINT chk_repl_status CHECK (status IN (
                               'PROPOSED','CUSTOMER_APPROVED',
                               'CUSTOMER_REJECTED','AUTO_ACCEPTED')),
  proposed_by_type         VARCHAR(10) NOT NULL
                             CONSTRAINT chk_repl_proposer_type CHECK (
                               proposed_by_type IN ('SYSTEM','STAFF')),
  proposed_by_id           UUID NULL,
  decided_by_type          VARCHAR(10) NULL
                             CONSTRAINT chk_repl_decider_type CHECK (
                               decided_by_type IS NULL
                               OR decided_by_type IN ('SYSTEM','CUSTOMER','STAFF')),
  decided_by_id            UUID NULL,
  -- Filled on approval with the materialized line id (R10: strictly after INSERT).
  replacement_order_item_id UUID NULL REFERENCES order_items (id)
                               ON DELETE RESTRICT
                               ON UPDATE CASCADE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Decision completeness: terminal states carry decider; PROPOSED carries none.
  CONSTRAINT chk_repl_decided CHECK (
    (status = 'PROPOSED'
       AND decided_by_type IS NULL AND decided_by_id IS NULL
       AND replacement_order_item_id IS NULL)
    OR (status IN ('CUSTOMER_APPROVED','CUSTOMER_REJECTED','AUTO_ACCEPTED')
       AND decided_by_type IS NOT NULL AND decided_by_id IS NOT NULL)),
  -- Link discipline (R10): approved ⇒ line exists; otherwise no line.
  CONSTRAINT chk_repl_materialized CHECK (
    (status IN ('CUSTOMER_APPROVED','AUTO_ACCEPTED')
       AND replacement_order_item_id IS NOT NULL)
    OR (status IN ('PROPOSED','CUSTOMER_REJECTED')
       AND replacement_order_item_id IS NULL))
  -- Terminal rows immutable by policy: decisions are new states, never UPDATEs
  -- (enforced by check_replacement_transition + review).
);
CREATE INDEX idx_replacements_item_id ON order_item_replacements (order_item_id);
-- One live proposal per line; sequential re-proposals after terminal decisions allowed.
CREATE UNIQUE INDEX uq_replacements_one_proposed
  ON order_item_replacements (order_item_id) WHERE status = 'PROPOSED';

-- ================================ TRIGGERS ==================================

CREATE TRIGGER trg_customers_updated_at
  BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_addresses_updated_at
  BEFORE UPDATE ON customer_addresses FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_carts_updated_at
  BEFORE UPDATE ON carts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_carts_transition
  BEFORE UPDATE OF status ON carts FOR EACH ROW EXECUTE FUNCTION check_cart_transition();
CREATE TRIGGER trg_cart_items_updated_at
  BEFORE UPDATE ON cart_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- History-first write order: INSERT order_status_history, THEN UPDATE orders.status.
CREATE TRIGGER trg_orders_status_audited
  BEFORE UPDATE OF status ON orders FOR EACH ROW EXECUTE FUNCTION check_order_status_audited();
CREATE TRIGGER trg_order_items_updated_at
  BEFORE UPDATE ON order_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_order_items_transition
  BEFORE UPDATE OF item_status ON order_items FOR EACH ROW EXECUTE FUNCTION check_order_item_transition();
CREATE TRIGGER trg_replacements_transition
  BEFORE UPDATE OF status ON order_item_replacements
  FOR EACH ROW EXECUTE FUNCTION check_replacement_transition();
