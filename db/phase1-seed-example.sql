-- ============================================================================
-- PHASE 1 — EXAMPLE SEED DATA (illustrative, §H of the freeze document)
-- Run AFTER db/phase1-schema.sql. Uses fixed UUIDs so output is reproducible.
-- ============================================================================
BEGIN;

-- ---------------- Category: dairy & cheese ----------------------------------
INSERT INTO categories (id, name, slug, description, parent_id, is_active, sort_order)
VALUES ('01800000-0000-7000-8000-000000000001', 'ألبان وجبن', 'dairy-cheese',
        'Dairy, cheese and yoghurt', NULL, TRUE, 1)
ON CONFLICT (id) DO NOTHING;

-- ---------------- Brand (Pepsi needs one; cheese is unbranded/loose) ---------
INSERT INTO brands (id, name, slug, is_active)
VALUES ('01800000-0000-7000-8000-000000000010', 'Pepsi', 'pepsi', TRUE)
ON CONFLICT (id) DO NOTHING;

-- ---------------- Product 1: Romi Cheese (WEIGHT) ----------------------------
INSERT INTO products (id, name, slug, description, category_id, brand_id,
                      product_type, unit, sale_step_grams, is_active)
VALUES ('01800000-0000-7000-8000-000000000100', 'جبنة رومي', 'romi-cheese',
        'Romi cheese, sold by weight', '01800000-0000-7000-8000-000000000001', NULL,
        'WEIGHT', 'KG', 125, TRUE)
ON CONFLICT (id) DO NOTHING;

-- Single loose-weight variant: price is PER 1 KG.
INSERT INTO product_variants (id, product_id, name, size_value, size_unit,
                              price, compare_at_price, cost_price, is_active)
VALUES ('01800000-0000-7000-8000-000000000101',
        '01800000-0000-7000-8000-000000000100',
        'KG', 1.000, 'KG', 320.00, NULL, 280.00, TRUE)
ON CONFLICT (id) DO NOTHING;

-- Internal scale code (VARCHAR keeps any leading zeros, e.g. '02010106').
INSERT INTO product_codes (id, product_variant_id, code, type, is_primary)
VALUES ('01800000-0000-7000-8000-000000000102',
        '01800000-0000-7000-8000-000000000101',
        '2010106', 'INTERNAL_CODE', TRUE)
ON CONFLICT (id) DO NOTHING;

-- Stock: 47.350 KG on hand.
INSERT INTO inventory (id, product_variant_id, quantity, reserved_quantity, low_stock_threshold)
VALUES ('01800000-0000-7000-8000-000000000103',
        '01800000-0000-7000-8000-000000000101',
        47.350, 0.000, 5.000)
ON CONFLICT (id) DO NOTHING;

INSERT INTO inventory_movements (product_variant_id, movement_type, quantity,
                                 previous_quantity, new_quantity,
                                 reference_type, reference_id, reason)
VALUES ('01800000-0000-7000-8000-000000000101',
        'STOCK_IN', 47.350, 0.000, 47.350,
        'PURCHASE', 'PO-2026-0001', 'Initial stock: Romi Cheese 47.350 KG');

-- Price change 300 -> 320 (audit trail; old orders keep their snapshot).
INSERT INTO product_price_history (product_variant_id, old_price, new_price, reason)
VALUES ('01800000-0000-7000-8000-000000000101', 300.00, 320.00,
        'Supplier price increase Sep 2026');

-- ---------------- Product 2: Pepsi (PIECE, 3 variants) -----------------------
INSERT INTO products (id, name, slug, description, category_id, brand_id,
                      product_type, unit, sale_step_grams, is_active)
VALUES ('01800000-0000-7000-8000-000000000200', 'Pepsi', 'pepsi',
        'Carbonated soft drink', '01800000-0000-7000-8000-000000000001',
        '01800000-0000-7000-8000-000000000010',
        'PIECE', 'PIECE', NULL, TRUE)
ON CONFLICT (id) DO NOTHING;
-- NOTE: Pepsi is intentionally placed under dairy-cheese here only to keep the
-- seed to one category; in real data it belongs to a 'Beverages' category.

INSERT INTO product_variants (id, product_id, name, size_value, size_unit, price, is_active)
VALUES
  ('01800000-0000-7000-8000-000000000201',
   '01800000-0000-7000-8000-000000000200', '330 ML', 330.000, 'ML', 15.00, TRUE),
  ('01800000-0000-7000-8000-000000000202',
   '01800000-0000-7000-8000-000000000200', '1 L', 1.000, 'LITER', 30.00, TRUE),
  ('01800000-0000-7000-8000-000000000203',
   '01800000-0000-7000-8000-000000000200', '2.5 L', 2.500, 'LITER', 55.00, TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO product_codes (id, product_variant_id, code, type, is_primary)
VALUES
  ('01800000-0000-7000-8000-000000000211', '01800000-0000-7000-8000-000000000201',
   '6221001000331', 'BARCODE', TRUE),
  ('01800000-0000-7000-8000-000000000212', '01800000-0000-7000-8000-000000000202',
   '6221001001000', 'BARCODE', TRUE),
  ('01800000-0000-7000-8000-000000000213', '01800000-0000-7000-8000-000000000203',
   '6221001002500', 'BARCODE', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO inventory (id, product_variant_id, quantity, reserved_quantity, low_stock_threshold)
VALUES
  ('01800000-0000-7000-8000-000000000221', '01800000-0000-7000-8000-000000000201',
   500.000, 0.000, 50.000),
  ('01800000-0000-7000-8000-000000000222', '01800000-0000-7000-8000-000000000202',
   300.000, 0.000, 30.000),
  ('01800000-0000-7000-8000-000000000223', '01800000-0000-7000-8000-000000000203',
   150.000, 0.000, 20.000)
ON CONFLICT (id) DO NOTHING;

INSERT INTO inventory_movements (product_variant_id, movement_type, quantity,
                                 previous_quantity, new_quantity, reason)
VALUES
  ('01800000-0000-7000-8000-000000000201', 'STOCK_IN', 500.000, 0.000, 500.000,
   'Initial stock: Pepsi 330 ML x500'),
  ('01800000-0000-7000-8000-000000000202', 'STOCK_IN', 300.000, 0.000, 300.000,
   'Initial stock: Pepsi 1 L x300'),
  ('01800000-0000-7000-8000-000000000203', 'STOCK_IN', 150.000, 0.000, 150.000,
   'Initial stock: Pepsi 2.5 L x150');

COMMIT;

-- ---------------- Expected weight options for Romi (app-derived) -------------
-- sale_step_grams = 125  =>  UI builds: 125g, 250g, 375g, 500g, 625g, 750g,
-- 875g, 1000g (1kg), 1125g ...  price(option) = 320 * grams / 1000.
-- Changing the step to 100/250/500 later = one UPDATE on products, no DDL.
