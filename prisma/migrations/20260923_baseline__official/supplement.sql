-- OFFICIAL BASELINE supplement — Hyper Al-Moatasem: SQL-only integrity the Prisma part cannot own.
-- Sourced verbatim from the scratch-proven prototype supplement.sql (comment/semicolon cleanup only).
-- Order: extension -> sequence -> CHECKs -> partial indexes -> functions -> triggers -> view.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SEQUENCE order_number_seq;

-- CHECK constraints (ALTER TABLE ADD CONSTRAINT; inline originals get deterministic PG auto-names)
ALTER TABLE categories ADD CONSTRAINT chk_categories_slug_format CHECK ( slug <> '' AND slug = lower(slug) AND position(' ' IN slug) = 0 );
ALTER TABLE categories ADD CONSTRAINT chk_categories_deleted_consistency CHECK ( deleted_at IS NULL OR is_active = FALSE );
ALTER TABLE categories ADD CONSTRAINT categories_sort_order_check CHECK (sort_order >= 0);
ALTER TABLE brands ADD CONSTRAINT chk_brands_slug_format CHECK ( slug <> '' AND slug = lower(slug) AND position(' ' IN slug) = 0 );
ALTER TABLE brands ADD CONSTRAINT chk_brands_deleted_consistency CHECK ( deleted_at IS NULL OR is_active = FALSE );
ALTER TABLE products ADD CONSTRAINT chk_products_type CHECK (product_type IN ('PIECE', 'WEIGHT'));
ALTER TABLE products ADD CONSTRAINT chk_products_unit CHECK (unit IN ('PIECE', 'KG', 'GRAM', 'LITER', 'ML'));
ALTER TABLE products ADD CONSTRAINT chk_products_weight_rule CHECK ( (product_type = 'WEIGHT' AND unit IN ('KG', 'GRAM') AND sale_step_grams IS NOT NULL AND sale_step_grams > 0) OR (product_type = 'PIECE' AND unit = 'PIECE' AND sale_step_grams IS NULL) );
ALTER TABLE products ADD CONSTRAINT chk_products_slug_format CHECK ( slug <> '' AND slug = lower(slug) AND position(' ' IN slug) = 0 );
ALTER TABLE products ADD CONSTRAINT chk_products_deleted_consistency CHECK ( deleted_at IS NULL OR is_active = FALSE );
ALTER TABLE product_variants ADD CONSTRAINT chk_variants_size_unit CHECK (size_unit IS NULL OR size_unit IN ('PIECE','KG','GRAM','LITER','ML'));
ALTER TABLE product_variants ADD CONSTRAINT chk_variants_compare_price CHECK ( compare_at_price IS NULL OR compare_at_price >= price );
ALTER TABLE product_variants ADD CONSTRAINT chk_variants_deleted_consistency CHECK ( deleted_at IS NULL OR is_active = FALSE );
ALTER TABLE product_variants ADD CONSTRAINT product_variants_size_value_check CHECK (size_value IS NULL OR size_value > 0);
ALTER TABLE product_variants ADD CONSTRAINT product_variants_price_check CHECK (price >= 0);
ALTER TABLE product_variants ADD CONSTRAINT product_variants_compare_at_price_check CHECK (compare_at_price IS NULL OR compare_at_price >= 0);
ALTER TABLE product_variants ADD CONSTRAINT product_variants_cost_price_check CHECK (cost_price IS NULL OR cost_price >= 0);
ALTER TABLE product_codes ADD CONSTRAINT chk_codes_type CHECK (type IN ('BARCODE', 'INTERNAL_CODE'));
ALTER TABLE product_codes ADD CONSTRAINT chk_codes_code_format CHECK (code <> '' AND position(' ' IN code) = 0);
ALTER TABLE inventory ADD CONSTRAINT chk_inventory_reserved_lte_quantity CHECK (reserved_quantity <= quantity);
ALTER TABLE inventory ADD CONSTRAINT inventory_quantity_check CHECK (quantity >= 0);
ALTER TABLE inventory ADD CONSTRAINT inventory_reserved_quantity_check CHECK (reserved_quantity >= 0);
ALTER TABLE inventory ADD CONSTRAINT inventory_low_stock_threshold_check CHECK (low_stock_threshold IS NULL OR low_stock_threshold >= 0);
ALTER TABLE inventory_movements ADD CONSTRAINT chk_movements_type CHECK ( movement_type IN ('STOCK_IN','SALE','RETURN','WASTE', 'ADJUSTMENT','REPLACEMENT','CANCELLED_ORDER') );
ALTER TABLE inventory_movements ADD CONSTRAINT chk_movements_qty_nonzero CHECK (quantity <> 0);
ALTER TABLE inventory_movements ADD CONSTRAINT chk_movements_ref_type CHECK ( reference_type IS NULL OR reference_type IN ('ORDER','PURCHASE','RETURN','ADJUSTMENT','MANUAL') );
ALTER TABLE inventory_movements ADD CONSTRAINT chk_movements_math CHECK (new_quantity = previous_quantity + quantity);
ALTER TABLE inventory_movements ADD CONSTRAINT chk_movements_ref_pair CHECK ( reference_id IS NULL OR reference_type IS NOT NULL );
ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_previous_quantity_check CHECK (previous_quantity >= 0);
ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_new_quantity_check CHECK (new_quantity >= 0);
ALTER TABLE product_price_history ADD CONSTRAINT chk_price_history_changed CHECK (old_price <> new_price);
ALTER TABLE product_price_history ADD CONSTRAINT product_price_history_old_price_check CHECK (old_price >= 0);
ALTER TABLE product_price_history ADD CONSTRAINT product_price_history_new_price_check CHECK (new_price >= 0);
ALTER TABLE customers ADD CONSTRAINT chk_customers_first_name CHECK (first_name <> '');
ALTER TABLE customers ADD CONSTRAINT chk_customers_phone_format CHECK (phone ~ '^[0-9]{8,15}$');
ALTER TABLE customers ADD CONSTRAINT chk_customers_email_format CHECK ( email IS NULL OR (position('@' IN email) > 1 AND position(' ' IN email) = 0));
ALTER TABLE customers ADD CONSTRAINT chk_customers_registered CHECK ( is_registered = FALSE OR password_hash IS NOT NULL);
ALTER TABLE customers ADD CONSTRAINT chk_customers_deleted_consistency CHECK ( deleted_at IS NULL OR is_active = FALSE);
ALTER TABLE customer_addresses ADD CONSTRAINT chk_addresses_city CHECK (city <> '');
ALTER TABLE customer_addresses ADD CONSTRAINT chk_addresses_phone_format CHECK (phone ~ '^[0-9]{8,15}$');
ALTER TABLE carts ADD CONSTRAINT chk_carts_session_format CHECK ( session_id IS NULL OR (session_id <> '' AND position(' ' IN session_id) = 0));
ALTER TABLE carts ADD CONSTRAINT chk_carts_status CHECK ( status IN ('ACTIVE','CHECKED_OUT','ABANDONED','EXPIRED','MERGED'));
ALTER TABLE carts ADD CONSTRAINT chk_carts_ownership CHECK ((customer_id IS NULL) <> (session_id IS NULL));
ALTER TABLE cart_items ADD CONSTRAINT chk_cart_items_qty CHECK (quantity > 0);
ALTER TABLE cart_items ADD CONSTRAINT chk_cart_items_unit CHECK ( unit_snapshot IN ('PIECE','KG','GRAM','LITER','ML'));
ALTER TABLE cart_items ADD CONSTRAINT chk_cart_items_price CHECK ( unit_price_snapshot IS NULL OR unit_price_snapshot >= 0);
ALTER TABLE orders ADD CONSTRAINT chk_orders_number_format CHECK ( order_number ~ '^HM-[0-9]{8}-[0-9]{6}$');
ALTER TABLE orders ADD CONSTRAINT chk_orders_idem_format CHECK ( idempotency_key IS NULL OR ( idempotency_key <> '' AND position(' ' IN idempotency_key) = 0));
ALTER TABLE orders ADD CONSTRAINT chk_orders_status CHECK (status IN ( 'NEW','CONFIRMED','PREPARING','READY_FOR_DELIVERY', 'OUT_FOR_DELIVERY','DELIVERED','CANCELLED'));
ALTER TABLE orders ADD CONSTRAINT chk_orders_subest CHECK (subtotal_estimated >= 0);
ALTER TABLE orders ADD CONSTRAINT chk_orders_disc CHECK (discount_total >= 0);
ALTER TABLE orders ADD CONSTRAINT chk_orders_fee CHECK (delivery_fee >= 0);
ALTER TABLE orders ADD CONSTRAINT chk_orders_totest CHECK (total_estimated >= 0);
ALTER TABLE orders ADD CONSTRAINT chk_orders_subfin CHECK ( subtotal_final IS NULL OR subtotal_final >= 0);
ALTER TABLE orders ADD CONSTRAINT chk_orders_totfin CHECK ( total_final IS NULL OR total_final >= 0);
ALTER TABLE orders ADD CONSTRAINT chk_orders_cname CHECK (customer_name_snapshot <> '');
ALTER TABLE orders ADD CONSTRAINT chk_orders_cphone CHECK ( customer_phone_snapshot ~ '^[0-9]{8,15}$');
ALTER TABLE orders ADD CONSTRAINT chk_orders_dcity CHECK (delivery_city <> '');
ALTER TABLE orders ADD CONSTRAINT chk_orders_dphone CHECK ( delivery_phone ~ '^[0-9]{8,15}$');
ALTER TABLE orders ADD CONSTRAINT chk_orders_discount_cap CHECK (discount_total <= subtotal_estimated);
ALTER TABLE orders ADD CONSTRAINT chk_orders_total_estimated CHECK ( total_estimated = subtotal_estimated - discount_total + delivery_fee);
ALTER TABLE orders ADD CONSTRAINT chk_orders_total_final CHECK ( total_final IS NULL OR (subtotal_final IS NOT NULL AND total_final = subtotal_final - LEAST(discount_total, subtotal_final) + delivery_fee));
ALTER TABLE order_items ADD CONSTRAINT chk_items_pname CHECK (product_name_snapshot <> '');
ALTER TABLE order_items ADD CONSTRAINT chk_items_vname CHECK (variant_name_snapshot <> '');
ALTER TABLE order_items ADD CONSTRAINT chk_items_ctype CHECK ( code_type_snapshot IS NULL OR code_type_snapshot IN ('BARCODE','INTERNAL_CODE'));
ALTER TABLE order_items ADD CONSTRAINT chk_items_unit CHECK ( unit_snapshot IN ('PIECE','KG','GRAM','LITER','ML'));
ALTER TABLE order_items ADD CONSTRAINT chk_items_ptype CHECK ( product_type_snapshot IN ('PIECE','WEIGHT'));
ALTER TABLE order_items ADD CONSTRAINT chk_items_price CHECK (unit_price >= 0);
ALTER TABLE order_items ADD CONSTRAINT chk_items_req CHECK (requested_quantity > 0);
ALTER TABLE order_items ADD CONSTRAINT chk_items_act CHECK ( actual_quantity IS NULL OR actual_quantity > 0);
ALTER TABLE order_items ADD CONSTRAINT chk_items_est CHECK (estimated_total >= 0);
ALTER TABLE order_items ADD CONSTRAINT chk_items_fin CHECK ( final_total IS NULL OR final_total >= 0);
ALTER TABLE order_items ADD CONSTRAINT chk_items_disc CHECK (discount_amount >= 0);
ALTER TABLE order_items ADD CONSTRAINT chk_items_status CHECK (item_status IN ( 'PENDING','FULFILLED','PARTIALLY_FULFILLED', 'UNAVAILABLE','REPLACED','CANCELLED'));
ALTER TABLE order_items ADD CONSTRAINT chk_items_code_pair CHECK ( (product_code_snapshot IS NULL) = (code_type_snapshot IS NULL));
ALTER TABLE order_items ADD CONSTRAINT chk_items_step_mirror CHECK ( (product_type_snapshot = 'WEIGHT' AND sale_step_snapshot IS NOT NULL AND sale_step_snapshot > 0) OR (product_type_snapshot = 'PIECE' AND sale_step_snapshot IS NULL));
ALTER TABLE order_items ADD CONSTRAINT chk_items_estimated_math CHECK ( estimated_total = round(requested_quantity * unit_price, 2));
ALTER TABLE order_items ADD CONSTRAINT chk_items_final_math CHECK ( final_total IS NULL OR (actual_quantity IS NOT NULL AND final_total = round(actual_quantity * unit_price, 2)));
ALTER TABLE order_items ADD CONSTRAINT chk_items_discount_cap CHECK (discount_amount <= estimated_total);
ALTER TABLE order_items ADD CONSTRAINT chk_items_pending_no_actual CHECK ( item_status <> 'PENDING' OR actual_quantity IS NULL);
ALTER TABLE order_items ADD CONSTRAINT chk_items_fulfilled_actual CHECK ( item_status <> 'FULFILLED' OR actual_quantity IS NOT NULL);
ALTER TABLE order_items ADD CONSTRAINT chk_items_partial_actual CHECK ( item_status <> 'PARTIALLY_FULFILLED' OR (actual_quantity IS NOT NULL AND actual_quantity <> requested_quantity));
ALTER TABLE order_status_history ADD CONSTRAINT chk_history_new CHECK (new_status IN ( 'NEW','CONFIRMED','PREPARING','READY_FOR_DELIVERY', 'OUT_FOR_DELIVERY','DELIVERED','CANCELLED'));
ALTER TABLE order_status_history ADD CONSTRAINT chk_history_actor_type CHECK ( actor_type IN ('SYSTEM','CUSTOMER','STAFF'));
ALTER TABLE order_status_history ADD CONSTRAINT chk_history_actor CHECK ( (actor_type = 'SYSTEM' AND actor_id IS NULL) OR (actor_type <> 'SYSTEM' AND actor_id IS NOT NULL));
ALTER TABLE order_status_history ADD CONSTRAINT chk_history_transition CHECK ( (old_status IS NULL AND new_status = 'NEW') OR (old_status IS NOT NULL AND (old_status, new_status) IN ( ('NEW','CONFIRMED'), ('CONFIRMED','PREPARING'), ('PREPARING','READY_FOR_DELIVERY'), ('READY_FOR_DELIVERY','OUT_FOR_DELIVERY'), ('OUT_FOR_DELIVERY','DELIVERED'), ('NEW','CANCELLED'), ('CONFIRMED','CANCELLED'), ('PREPARING','CANCELLED'))) );
ALTER TABLE order_item_replacements ADD CONSTRAINT chk_repl_qty CHECK (replacement_quantity > 0);
ALTER TABLE order_item_replacements ADD CONSTRAINT chk_repl_price CHECK (replacement_unit_price >= 0);
ALTER TABLE order_item_replacements ADD CONSTRAINT chk_repl_status CHECK (status IN ( 'PROPOSED','CUSTOMER_APPROVED', 'CUSTOMER_REJECTED','AUTO_ACCEPTED'));
ALTER TABLE order_item_replacements ADD CONSTRAINT chk_repl_proposer_type CHECK ( proposed_by_type IN ('SYSTEM','STAFF'));
ALTER TABLE order_item_replacements ADD CONSTRAINT chk_repl_decider_type CHECK ( decided_by_type IS NULL OR decided_by_type IN ('SYSTEM','CUSTOMER','STAFF'));
ALTER TABLE order_item_replacements ADD CONSTRAINT chk_repl_decided CHECK ( (status = 'PROPOSED' AND decided_by_type IS NULL AND decided_by_id IS NULL AND replacement_order_item_id IS NULL) OR (status IN ('CUSTOMER_APPROVED','CUSTOMER_REJECTED','AUTO_ACCEPTED') AND decided_by_type IS NOT NULL AND decided_by_id IS NOT NULL));
ALTER TABLE order_item_replacements ADD CONSTRAINT chk_repl_materialized CHECK ( (status IN ('CUSTOMER_APPROVED','AUTO_ACCEPTED') AND replacement_order_item_id IS NOT NULL) OR (status IN ('PROPOSED','CUSTOMER_REJECTED') AND replacement_order_item_id IS NULL));
ALTER TABLE promotions ADD CONSTRAINT chk_promos_name CHECK (name <> '');
ALTER TABLE promotions ADD CONSTRAINT chk_promos_type CHECK ( type IN ('PERCENTAGE','FIXED_AMOUNT','BUY_X_GET_Y','FIXED_PRICE'));
ALTER TABLE promotions ADD CONSTRAINT chk_promos_scope CHECK (scope IN ('LINE','ORDER'));
ALTER TABLE promotions ADD CONSTRAINT chk_promos_status CHECK (status IN ('DRAFT','ACTIVE','DISABLED'));
ALTER TABLE promotions ADD CONSTRAINT chk_promos_pct CHECK ( discount_percent IS NULL OR (discount_percent > 0 AND discount_percent <= 100));
ALTER TABLE promotions ADD CONSTRAINT chk_promos_amt CHECK ( discount_amount IS NULL OR discount_amount > 0);
ALTER TABLE promotions ADD CONSTRAINT chk_promos_fix CHECK ( fixed_price IS NULL OR fixed_price >= 0);
ALTER TABLE promotions ADD CONSTRAINT chk_promos_limit CHECK ( usage_limit IS NULL OR usage_limit > 0);
ALTER TABLE promotions ADD CONSTRAINT chk_promos_used CHECK (used_count >= 0);
ALTER TABLE promotions ADD CONSTRAINT chk_promos_values CHECK ( (type = 'PERCENTAGE' AND discount_percent IS NOT NULL AND discount_amount IS NULL AND fixed_price IS NULL) OR (type = 'FIXED_AMOUNT' AND discount_amount IS NOT NULL AND discount_percent IS NULL AND fixed_price IS NULL) OR (type = 'FIXED_PRICE' AND scope = 'LINE' AND fixed_price IS NOT NULL AND discount_percent IS NULL AND discount_amount IS NULL) OR (type = 'BUY_X_GET_Y' AND scope = 'LINE' AND discount_percent IS NULL AND discount_amount IS NULL AND fixed_price IS NULL));
ALTER TABLE promotions ADD CONSTRAINT chk_promos_scope_types CHECK ( scope = 'LINE' OR type IN ('PERCENTAGE','FIXED_AMOUNT'));
ALTER TABLE promotions ADD CONSTRAINT chk_promos_window CHECK ( start_at IS NULL OR end_at IS NULL OR end_at > start_at);
ALTER TABLE promotions ADD CONSTRAINT chk_promos_counter_cap CHECK ( usage_limit IS NULL OR used_count <= usage_limit);
ALTER TABLE promotions ADD CONSTRAINT chk_promos_deleted_consistency CHECK ( deleted_at IS NULL OR status = 'DISABLED');
ALTER TABLE promotion_targets ADD CONSTRAINT chk_targets_type CHECK ( target_type IN ('VARIANT','PRODUCT','BRAND','CATEGORY'));
ALTER TABLE promotion_rules ADD CONSTRAINT chk_rules_minqty CHECK ( minimum_quantity IS NULL OR minimum_quantity > 0);
ALTER TABLE promotion_rules ADD CONSTRAINT chk_rules_minamt CHECK ( minimum_amount IS NULL OR minimum_amount > 0);
ALTER TABLE promotion_rules ADD CONSTRAINT chk_rules_maxdisc CHECK ( maximum_discount IS NULL OR maximum_discount > 0);
ALTER TABLE promotion_buy_get_rules ADD CONSTRAINT chk_bxg_buy CHECK (buy_quantity > 0);
ALTER TABLE promotion_buy_get_rules ADD CONSTRAINT chk_bxg_get CHECK (get_quantity > 0);
ALTER TABLE promotion_buy_get_rules ADD CONSTRAINT chk_bxg_pct CHECK ( discount_percent > 0 AND discount_percent <= 100);
ALTER TABLE coupons ADD CONSTRAINT chk_coupons_code CHECK ( code <> '' AND code = upper(code) AND code = btrim(code) AND position(' ' IN code) = 0);
ALTER TABLE coupons ADD CONSTRAINT chk_coupons_limit CHECK ( usage_limit IS NULL OR usage_limit > 0);
ALTER TABLE coupons ADD CONSTRAINT chk_coupons_used CHECK (used_count >= 0);
ALTER TABLE coupons ADD CONSTRAINT chk_coupons_percust CHECK ( per_customer_limit IS NULL OR per_customer_limit >= 1);
ALTER TABLE coupons ADD CONSTRAINT chk_coupons_min CHECK ( minimum_order_amount IS NULL OR minimum_order_amount >= 0);
ALTER TABLE coupons ADD CONSTRAINT chk_coupons_window CHECK ( start_at IS NULL OR end_at IS NULL OR end_at > start_at);
ALTER TABLE coupons ADD CONSTRAINT chk_coupons_counter_cap CHECK ( usage_limit IS NULL OR used_count <= usage_limit);
ALTER TABLE coupons ADD CONSTRAINT chk_coupons_deleted_consistency CHECK ( deleted_at IS NULL OR is_active = FALSE);
ALTER TABLE coupon_usages ADD CONSTRAINT chk_uses_est CHECK (estimated_discount_amount >= 0);
ALTER TABLE coupon_usages ADD CONSTRAINT chk_uses_fin CHECK ( final_discount_amount IS NULL OR final_discount_amount >= 0);
ALTER TABLE order_discounts ADD CONSTRAINT chk_od_kind CHECK ( kind IN ('PROMOTION_LINE','PROMOTION_ORDER','COUPON','ALLOCATION'));
ALTER TABLE order_discounts ADD CONSTRAINT chk_od_pname CHECK (promotion_name_snapshot <> '');
ALTER TABLE order_discounts ADD CONSTRAINT chk_od_type CHECK ( type_snapshot IN ('PERCENTAGE','FIXED_AMOUNT','BUY_X_GET_Y','FIXED_PRICE'));
ALTER TABLE order_discounts ADD CONSTRAINT chk_od_scope CHECK (scope_snapshot IN ('LINE','ORDER'));
ALTER TABLE order_discounts ADD CONSTRAINT chk_od_applied_amt CHECK ( applied_amount IS NULL OR applied_amount >= 0);
ALTER TABLE order_discounts ADD CONSTRAINT chk_od_applied_fix CHECK ( applied_fixed_price IS NULL OR applied_fixed_price >= 0);
ALTER TABLE order_discounts ADD CONSTRAINT chk_od_cap CHECK ( cap_amount IS NULL OR cap_amount >= 0);
ALTER TABLE order_discounts ADD CONSTRAINT chk_od_base_est CHECK (base_estimated >= 0);
ALTER TABLE order_discounts ADD CONSTRAINT chk_od_disc_est CHECK (discount_estimated >= 0);
ALTER TABLE order_discounts ADD CONSTRAINT chk_od_base_fin CHECK ( base_final IS NULL OR base_final >= 0);
ALTER TABLE order_discounts ADD CONSTRAINT chk_od_disc_fin CHECK ( discount_final IS NULL OR discount_final >= 0);
ALTER TABLE order_discounts ADD CONSTRAINT chk_od_kind_shape CHECK ( (kind = 'PROMOTION_LINE' AND order_item_id IS NOT NULL AND coupon_id IS NULL AND parent_discount_id IS NULL) OR (kind = 'PROMOTION_ORDER' AND order_item_id IS NULL AND coupon_id IS NULL AND parent_discount_id IS NULL) OR (kind = 'COUPON' AND coupon_id IS NOT NULL AND order_item_id IS NULL AND parent_discount_id IS NULL) OR (kind = 'ALLOCATION' AND order_item_id IS NOT NULL AND parent_discount_id IS NOT NULL));
ALTER TABLE order_discounts ADD CONSTRAINT chk_od_applied_shape CHECK ( (kind = 'ALLOCATION' AND applied_percent IS NULL AND applied_amount IS NULL AND applied_fixed_price IS NULL AND cap_amount IS NULL) OR (kind <> 'ALLOCATION' AND ( (type_snapshot = 'PERCENTAGE' AND applied_percent IS NOT NULL AND applied_amount IS NULL AND applied_fixed_price IS NULL) OR (type_snapshot = 'FIXED_AMOUNT' AND applied_amount IS NOT NULL AND applied_percent IS NULL AND applied_fixed_price IS NULL) OR (type_snapshot = 'FIXED_PRICE' AND applied_fixed_price IS NOT NULL AND applied_percent IS NULL AND applied_amount IS NULL) OR (type_snapshot = 'BUY_X_GET_Y' AND applied_percent IS NOT NULL AND applied_amount IS NULL AND applied_fixed_price IS NULL))));
ALTER TABLE order_discounts ADD CONSTRAINT chk_od_est_bound CHECK (discount_estimated <= base_estimated);
ALTER TABLE order_discounts ADD CONSTRAINT chk_od_fin_bound CHECK ( discount_final IS NULL OR (base_final IS NOT NULL AND discount_final <= base_final));
ALTER TABLE users ADD CONSTRAINT chk_users_name CHECK (name <> '');
ALTER TABLE users ADD CONSTRAINT chk_users_email CHECK ( email <> '' AND email = lower(email) AND position('@' IN email) > 1 AND position(' ' IN email) = 0);
ALTER TABLE users ADD CONSTRAINT chk_users_phone CHECK ( phone IS NULL OR phone ~ '^[0-9]{8,15}$');
ALTER TABLE users ADD CONSTRAINT chk_users_deleted_consistency CHECK ( deleted_at IS NULL OR is_active = FALSE);
ALTER TABLE roles ADD CONSTRAINT chk_roles_name CHECK (name <> '' AND position(' ' IN name) = 0);
ALTER TABLE roles ADD CONSTRAINT chk_roles_deleted_consistency CHECK ( deleted_at IS NULL OR is_active = FALSE);
ALTER TABLE permissions ADD CONSTRAINT chk_permissions_key CHECK (key ~ '^[a-z0-9_]+\.[a-z0-9_]+$');
ALTER TABLE audit_logs ADD CONSTRAINT chk_audit_actor CHECK (actor_type IN ('ADMIN', 'SYSTEM'));
ALTER TABLE audit_logs ADD CONSTRAINT chk_audit_action CHECK (action ~ '^[a-z0-9_]+\.[a-z0-9_]+$');
ALTER TABLE audit_logs ADD CONSTRAINT chk_audit_actor_pair CHECK ( (actor_type = 'SYSTEM' AND user_id IS NULL) OR (actor_type = 'ADMIN' AND user_id IS NOT NULL));
ALTER TABLE store_settings ADD CONSTRAINT chk_settings_key CHECK ( key <> '' AND key = lower(key) AND position(' ' IN key) = 0);
ALTER TABLE store_settings ADD CONSTRAINT chk_settings_type CHECK ( value_type IN ('BOOLEAN', 'INTEGER', 'NUMERIC', 'TEXT', 'JSON'));
ALTER TABLE store_settings ADD CONSTRAINT chk_settings_typed CHECK ( CASE value_type WHEN 'BOOLEAN' THEN value_text IN ('true', 'false') WHEN 'INTEGER' THEN value_text ~ '^-?[0-9]+$' WHEN 'NUMERIC' THEN value_text ~ '^-?[0-9]+(\.[0-9]+)?$' WHEN 'TEXT' THEN true WHEN 'JSON' THEN value_text::jsonb IS NOT NULL END);
ALTER TABLE notifications ADD CONSTRAINT chk_notifications_type CHECK (type ~ '^[a-z0-9_.]+$');
ALTER TABLE notifications ADD CONSTRAINT chk_notifications_title CHECK (title <> '');
ALTER TABLE notifications ADD CONSTRAINT chk_notifications_message CHECK (message <> '');

-- Partial indexes (exact predicates preserved)
CREATE INDEX idx_categories_storefront  ON categories (parent_id, sort_order)
  WHERE is_active AND deleted_at IS NULL;
CREATE INDEX idx_products_storefront  ON products (category_id, is_active)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_variants_sellable    ON product_variants (product_id)
  WHERE is_active AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_codes_one_primary
  ON product_codes (product_variant_id) WHERE is_primary;
CREATE UNIQUE INDEX uq_customers_email ON customers (email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX uq_addresses_one_default
  ON customer_addresses (customer_id) WHERE is_default;
CREATE UNIQUE INDEX uq_carts_active_customer ON carts (customer_id) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX uq_carts_active_session ON carts (session_id) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX uq_replacements_one_proposed
  ON order_item_replacements (order_item_id) WHERE status = 'PROPOSED';
CREATE UNIQUE INDEX uq_users_phone ON users (phone) WHERE phone IS NOT NULL;

-- Trigger functions (before triggers that use them)
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION prevent_category_cycle()
RETURNS TRIGGER AS $$
DECLARE
  v_depth INT := 0;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'Category cannot be its own parent (%)', NEW.id;
  END IF;
  WITH RECURSIVE ancestors(id, parent_id, depth) AS (
    SELECT c.id, c.parent_id, 1
      FROM categories c
     WHERE c.id = NEW.parent_id
    UNION ALL
    SELECT c.id, c.parent_id, a.depth + 1
      FROM categories c
      JOIN ancestors a ON a.parent_id = c.id
     WHERE a.depth < 50
  )
  SELECT count(*) INTO v_depth FROM ancestors WHERE id = NEW.id;
  IF v_depth > 0 THEN
    RAISE EXCEPTION 'Circular category hierarchy detected for %', NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
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

-- Triggers
CREATE TRIGGER trg_categories_updated_at
  BEFORE UPDATE ON categories FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_categories_no_cycle
  BEFORE INSERT OR UPDATE OF parent_id ON categories
  FOR EACH ROW EXECUTE FUNCTION prevent_category_cycle();
CREATE TRIGGER trg_brands_updated_at
  BEFORE UPDATE ON brands FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_variants_updated_at
  BEFORE UPDATE ON product_variants FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_codes_updated_at
  BEFORE UPDATE ON product_codes FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_inventory_updated_at
  BEFORE UPDATE ON inventory FOR EACH ROW EXECUTE FUNCTION set_updated_at();
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
CREATE TRIGGER trg_orders_status_audited
  BEFORE UPDATE OF status ON orders FOR EACH ROW EXECUTE FUNCTION check_order_status_audited();
CREATE TRIGGER trg_order_items_updated_at
  BEFORE UPDATE ON order_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_order_items_transition
  BEFORE UPDATE OF item_status ON order_items FOR EACH ROW EXECUTE FUNCTION check_order_item_transition();
CREATE TRIGGER trg_replacements_transition
  BEFORE UPDATE OF status ON order_item_replacements
  FOR EACH ROW EXECUTE FUNCTION check_replacement_transition();
CREATE TRIGGER trg_promos_updated_at
  BEFORE UPDATE ON promotions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_coupons_updated_at
  BEFORE UPDATE ON coupons FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_roles_updated_at
  BEFORE UPDATE ON roles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_settings_updated_at
  BEFORE UPDATE ON store_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- View (after underlying tables)
CREATE OR REPLACE VIEW product_stock_status AS
SELECT
  p.id AS product_id,
  COUNT(v.id) FILTER (
    WHERE v.is_active AND v.deleted_at IS NULL) AS sellable_variants,
  COUNT(v.id) FILTER (
    WHERE v.is_active AND v.deleted_at IS NULL
      AND i.available_quantity > 0) AS in_stock_variants,
  EXISTS (SELECT 1
            FROM product_variants v2
            JOIN inventory i2 ON i2.product_variant_id = v2.id
           WHERE v2.product_id = p.id
             AND v2.is_active AND v2.deleted_at IS NULL
             AND i2.available_quantity > 0) AS is_in_stock
FROM products p
LEFT JOIN product_variants v ON v.product_id = p.id
LEFT JOIN inventory i ON i.product_variant_id = v.id
GROUP BY p.id;
