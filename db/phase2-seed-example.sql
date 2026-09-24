-- ============================================================================
-- PHASE 2 — EXAMPLE SEED DATA (illustrative)
-- Run AFTER db/phase2-schema.sql. Fixed UUIDv7 ids for reproducibility.
-- Reuses Phase 1 seed variants: Romi KG (...000101), Pepsi 330ML (...000201).
-- Canonical phones (R8): 01012345678 -> 201012345678 (guest), 01122233344 -> 201122233344.
-- ============================================================================
BEGIN;

-- Guest customer (Mohamed): no password_hash, unregistered.
INSERT INTO customers (id, first_name, last_name, phone, email, password_hash,
                       is_registered, auto_accept_replacements, is_active)
VALUES ('01800000-0000-7000-8000-000000000301', 'Mohamed', NULL,
        '201012345678', NULL, NULL, FALSE, FALSE, TRUE)
ON CONFLICT (id) DO NOTHING;

-- Registered customer (Sara): hash set, registered.
INSERT INTO customers (id, first_name, last_name, phone, email, password_hash,
                       is_registered, auto_accept_replacements, is_active)
VALUES ('01800000-0000-7000-8000-000000000302', 'Sara', 'Ahmed',
        '201122233344', 'sara.ahmed@example.com',
        '$2b$12$EXAMPLEHASHFORSEEDDATANOTAREALPASSWORD0000000000000000',
        TRUE, TRUE, TRUE)
ON CONFLICT (id) DO NOTHING;

-- Guest address (default).
INSERT INTO customer_addresses (id, customer_id, label, city, area, street,
                                building_number, landmark, phone, is_default)
VALUES ('01800000-0000-7000-8000-000000000311',
        '01800000-0000-7000-8000-000000000301',
        'home', 'Cairo', 'Nasr City', 'Abbas El Akkad', '12', 'Near City Center',
        '201012345678', TRUE)
ON CONFLICT (id) DO NOTHING;

-- Registered addresses (one default + one secondary).
INSERT INTO customer_addresses (id, customer_id, label, city, area, village, street,
                                building_number, landmark, phone, is_default)
VALUES ('01800000-0000-7000-8000-000000000312',
        '01800000-0000-7000-8000-000000000302',
        'home', 'Giza', 'Dokki', NULL, 'Taha Hussein', '7', 'Near Metro',
        '201122233344', TRUE),
       ('01800000-0000-7000-8000-000000000313',
        '01800000-0000-7000-8000-000000000302',
        'work', 'Cairo', 'Maadi', NULL, 'Road 9', '3', NULL,
        '201122233344', FALSE)
ON CONFLICT (id) DO NOTHING;

-- Guest ACTIVE cart (session-owned): 2x Pepsi 330ML + 0.500 KG Romi.
-- Prices are last-known quotes (unit_price_snapshot), NOT promises.
-- Counting units (frozen pin): 'PIECE' = packs for PIECE lines, 'KG' for the weight line.
INSERT INTO carts (id, customer_id, session_id, status, expires_at)
VALUES ('01800000-0000-7000-8000-000000000321', NULL,
        'sess-example-guest-001', 'ACTIVE', now() + INTERVAL '30 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO cart_items (id, cart_id, product_variant_id, quantity, unit_snapshot,
                        unit_price_snapshot, price_checked_at)
VALUES ('01800000-0000-7000-8000-000000000331',
        '01800000-0000-7000-8000-000000000321',
        '01800000-0000-7000-8000-000000000201',   -- Pepsi 330 ML
        2.000, 'PIECE', 15.00, now()),
       ('01800000-0000-7000-8000-000000000332',
        '01800000-0000-7000-8000-000000000321',
        '01800000-0000-7000-8000-000000000101',   -- Romi Cheese KG
        0.500, 'KG', 320.00, now())
ON CONFLICT (id) DO NOTHING;

COMMIT;
