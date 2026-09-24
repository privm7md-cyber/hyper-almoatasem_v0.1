-- ============================================================================
-- PHASE 4 — EXAMPLE SEED DATA (illustrative, minimal — no flooding)
-- Run AFTER db/phase4-schema.sql. Fixed UUIDv7 ids for reproducibility.
-- Reuses Phase 1 seed ids: category dairy ...001, brand Pepsi ...010,
-- product Pepsi ...200, variants ...201/202/203, Romi product ...100 / variant ...101.
-- All ACTIVE + windowless (always effective) EXCEPT brand promo (starts tomorrow).
-- Amounts: Pepsi 330ML=15, 1L=30, 2.5L=55; Romi=320/KG (base prices UNCHANGED).
-- ============================================================================
BEGIN;

-- ---------------- Promotions ----------------
-- P1: Pepsi 20% OFF (brand target, non-stackable, capped at 100 — §12 demo).
INSERT INTO promotions (id, name, description, type, scope, status, discount_percent,
                        priority, is_stackable)
VALUES ('01800000-0000-7000-8000-000000000601', 'Pepsi 20% OFF', 'Brand-wide Pepsi percent sale',
        'PERCENTAGE', 'LINE', 'ACTIVE', 20.00, 10, FALSE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO promotion_targets (id, promotion_id, target_type, target_id)
VALUES ('01800000-0000-7000-8000-000000000621',
        '01800000-0000-7000-8000-000000000601',
        'BRAND', '01800000-0000-7000-8000-000000000010')
ON CONFLICT (id) DO NOTHING;

INSERT INTO promotion_rules (id, promotion_id, maximum_discount)
VALUES ('01800000-0000-7000-8000-000000000640',
        '01800000-0000-7000-8000-000000000601', 100.00)
ON CONFLICT (id) DO NOTHING;

-- P2: 50 EGP OFF eligible Pepsi line (fixed amount, capped at line gross by engine).
INSERT INTO promotions (id, name, type, scope, status, discount_amount, priority, is_stackable)
VALUES ('01800000-0000-7000-8000-000000000602', '50 EGP OFF Pepsi line', 'FIXED_AMOUNT', 'LINE',
        'ACTIVE', 50.00, 5, FALSE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO promotion_targets (id, promotion_id, target_type, target_id)
VALUES ('01800000-0000-7000-8000-000000000622',
        '01800000-0000-7000-8000-000000000602',
        'PRODUCT', '01800000-0000-7000-8000-000000000200')
ON CONFLICT (id) DO NOTHING;

-- P3: Buy 2 Get 1 FREE Pepsi (same variant free => free_variant_id NULL).
INSERT INTO promotions (id, name, type, scope, status, priority, is_stackable)
VALUES ('01800000-0000-7000-8000-000000000603', 'Buy 2 Get 1 FREE Pepsi', 'BUY_X_GET_Y', 'LINE',
        'ACTIVE', 20, FALSE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO promotion_targets (id, promotion_id, target_type, target_id)
VALUES ('01800000-0000-7000-8000-000000000623',
        '01800000-0000-7000-8000-000000000603',
        'PRODUCT', '01800000-0000-7000-8000-000000000200')
ON CONFLICT (id) DO NOTHING;

INSERT INTO promotion_buy_get_rules (id, promotion_id, buy_quantity, get_quantity,
                                     discount_percent, free_variant_id)
VALUES ('01800000-0000-7000-8000-000000000641',
        '01800000-0000-7000-8000-000000000603', 2.000, 1.000, 100.00, NULL)
ON CONFLICT (id) DO NOTHING;

-- P4: Buy 3 Get 1 at 50% Pepsi.
INSERT INTO promotions (id, name, type, scope, status, priority, is_stackable)
VALUES ('01800000-0000-7000-8000-000000000604', 'Buy 3 Get 1 at 50% Pepsi', 'BUY_X_GET_Y', 'LINE',
        'ACTIVE', 20, FALSE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO promotion_targets (id, promotion_id, target_type, target_id)
VALUES ('01800000-0000-7000-8000-000000000624',
        '01800000-0000-7000-8000-000000000604',
        'PRODUCT', '01800000-0000-7000-8000-000000000200')
ON CONFLICT (id) DO NOTHING;

INSERT INTO promotion_buy_get_rules (id, promotion_id, buy_quantity, get_quantity,
                                     discount_percent, free_variant_id)
VALUES ('01800000-0000-7000-8000-000000000642',
        '01800000-0000-7000-8000-000000000604', 3.000, 1.000, 50.00, NULL)
ON CONFLICT (id) DO NOTHING;

-- P5: Romi Cheese 10% OFF (variant target, weighted demo: 320/KG).
INSERT INTO promotions (id, name, type, scope, status, discount_percent, priority, is_stackable)
VALUES ('01800000-0000-7000-8000-000000000605', 'Romi Cheese 10% OFF', 'PERCENTAGE', 'LINE',
        'ACTIVE', 10.00, 10, FALSE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO promotion_targets (id, promotion_id, target_type, target_id)
VALUES ('01800000-0000-7000-8000-000000000625',
        '01800000-0000-7000-8000-000000000605',
        'VARIANT', '01800000-0000-7000-8000-000000000101')
ON CONFLICT (id) DO NOTHING;

-- P6: Pepsi 330ML fixed 12.00 (FIXED_PRICE below base 15.00).
INSERT INTO promotions (id, name, type, scope, status, fixed_price, priority, is_stackable)
VALUES ('01800000-0000-7000-8000-000000000606', 'Pepsi 330ML fixed 12', 'FIXED_PRICE', 'LINE',
        'ACTIVE', 12.00, 15, FALSE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO promotion_targets (id, promotion_id, target_type, target_id)
VALUES ('01800000-0000-7000-8000-000000000626',
        '01800000-0000-7000-8000-000000000606',
        'VARIANT', '01800000-0000-7000-8000-000000000201')
ON CONFLICT (id) DO NOTHING;

-- P7: Welcome discount 50 (ORDER fixed amount; reached via coupons below).
INSERT INTO promotions (id, name, type, scope, status, discount_amount, priority, is_stackable)
VALUES ('01800000-0000-7000-8000-000000000607', 'Welcome discount 50', 'FIXED_AMOUNT', 'ORDER',
        'ACTIVE', 50.00, 100, FALSE)
ON CONFLICT (id) DO NOTHING;

-- P9: Loyal 10% order promo (ORDER percent; reached via LOYAL10 coupon).
INSERT INTO promotions (id, name, type, scope, status, discount_percent, priority, is_stackable)
VALUES ('01800000-0000-7000-8000-000000000609', 'Loyal 10% order', 'PERCENTAGE', 'ORDER',
        'ACTIVE', 10.00, 100, FALSE)
ON CONFLICT (id) DO NOTHING;

-- P10: Dairy category 5% (stackable — stacking demo with P1).
INSERT INTO promotions (id, name, type, scope, status, discount_percent, priority, is_stackable)
VALUES ('01800000-0000-7000-8000-000000000610', 'Dairy 5% OFF', 'PERCENTAGE', 'LINE',
        'ACTIVE', 5.00, 1, TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO promotion_targets (id, promotion_id, target_type, target_id)
VALUES ('01800000-0000-7000-8000-000000000630',
        '01800000-0000-7000-8000-000000000610',
        'CATEGORY', '01800000-0000-7000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

-- P11: Pepsi brand 25% (starts TOMORROW — temporal-validity demo, not effective yet).
INSERT INTO promotions (id, name, type, scope, status, discount_percent, priority, is_stackable,
                        start_at)
VALUES ('01800000-0000-7000-8000-000000000611', 'Pepsi brand 25% (scheduled)', 'PERCENTAGE', 'LINE',
        'ACTIVE', 25.00, 10, FALSE, now() + INTERVAL '1 day')
ON CONFLICT (id) DO NOTHING;

INSERT INTO promotion_targets (id, promotion_id, target_type, target_id)
VALUES ('01800000-0000-7000-8000-000000000631',
        '01800000-0000-7000-8000-000000000611',
        'BRAND', '01800000-0000-7000-8000-000000000010')
ON CONFLICT (id) DO NOTHING;

-- P12: Pepsi 330ML variant 30% (specificity demo: VARIANT beats BRAND at equal priority).
INSERT INTO promotions (id, name, type, scope, status, discount_percent, priority, is_stackable)
VALUES ('01800000-0000-7000-8000-000000000612', 'Pepsi 330ML 30%', 'PERCENTAGE', 'LINE',
        'ACTIVE', 30.00, 10, FALSE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO promotion_targets (id, promotion_id, target_type, target_id)
VALUES ('01800000-0000-7000-8000-000000000632',
        '01800000-0000-7000-8000-000000000612',
        'VARIANT', '01800000-0000-7000-8000-000000000201')
ON CONFLICT (id) DO NOTHING;

-- P13: Romi buy 0.500 KG get 0.100 KG free (weighted BXGY; sale_step_grams=125 respected).
INSERT INTO promotions (id, name, type, scope, status, priority, is_stackable)
VALUES ('01800000-0000-7000-8000-000000000613', 'Romi buy 0.5 get 0.1 free', 'BUY_X_GET_Y', 'LINE',
        'ACTIVE', 20, FALSE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO promotion_targets (id, promotion_id, target_type, target_id)
VALUES ('01800000-0000-7000-8000-000000000633',
        '01800000-0000-7000-8000-000000000613',
        'VARIANT', '01800000-0000-7000-8000-000000000101')
ON CONFLICT (id) DO NOTHING;

INSERT INTO promotion_buy_get_rules (id, promotion_id, buy_quantity, get_quantity,
                                     discount_percent, free_variant_id)
VALUES ('01800000-0000-7000-8000-000000000643',
        '01800000-0000-7000-8000-000000000613', 0.500, 0.100, 100.00, NULL)
ON CONFLICT (id) DO NOTHING;

-- ---------------- Coupons (1 promo → N coupons) ----------------
-- C1: WELCOME50 on P7 (min order 200, one per customer).
INSERT INTO coupons (id, promotion_id, code, per_customer_limit, minimum_order_amount, is_active)
VALUES ('01800000-0000-7000-8000-000000000651',
        '01800000-0000-7000-8000-000000000607', 'WELCOME50', 1, 200.00, TRUE)
ON CONFLICT (id) DO NOTHING;

-- C2: FLASH5 on P7 (global limit 5 — concurrency demo).
INSERT INTO coupons (id, promotion_id, code, usage_limit, per_customer_limit, is_active)
VALUES ('01800000-0000-7000-8000-000000000652',
        '01800000-0000-7000-8000-000000000607', 'FLASH5', 5, 1, TRUE)
ON CONFLICT (id) DO NOTHING;

-- C3: LOYAL10 on P9 (per-customer limit 2 — per-customer demo).
INSERT INTO coupons (id, promotion_id, code, per_customer_limit, minimum_order_amount, is_active)
VALUES ('01800000-0000-7000-8000-000000000653',
        '01800000-0000-7000-8000-000000000609', 'LOYAL10', 2, 100.00, TRUE)
ON CONFLICT (id) DO NOTHING;

COMMIT;
