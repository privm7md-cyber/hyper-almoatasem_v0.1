-- ============================================================================
-- PHASE 5 — EXAMPLE SEED DATA (authoritative RBAC baseline, minimal)
-- Run AFTER db/phase5-schema.sql. Fixed UUIDv7 ids for reproducibility.
-- Seeds: 2 roles, 31 action permissions, explicit grant matrix
-- (SUPER_ADMIN = all 31; STORE_ADMIN = 24, security capabilities excluded),
-- operational settings, one bootstrap owner (identity only — NO credentials;
-- authentication arrives with the auth decision).
-- ============================================================================
BEGIN;

-- ---------------- Roles ----------------
INSERT INTO roles (id, name, description, is_active)
VALUES ('02800000-0000-7000-8000-000000000001', 'SUPER_ADMIN', 'Platform/system owner — all grants explicit, no bypass flag', TRUE),
       ('02800000-0000-7000-8000-000000000002', 'STORE_ADMIN', 'Hypermarket owner/operator — all business domains, no platform-security capabilities', TRUE)
ON CONFLICT (id) DO NOTHING;

-- ---------------- Permissions (action registry; stable identifiers) ----------------
INSERT INTO permissions (id, key, description) VALUES
  ('02800000-0000-7000-8000-000000000101', 'products.view', 'View catalog products'),
  ('02800000-0000-7000-8000-000000000102', 'products.create', 'Create catalog products'),
  ('02800000-0000-7000-8000-000000000103', 'products.update', 'Update catalog products'),
  ('02800000-0000-7000-8000-000000000104', 'products.delete', 'Disable/remove catalog products'),
  ('02800000-0000-7000-8000-000000000105', 'prices.view', 'View selling prices'),
  ('02800000-0000-7000-8000-000000000106', 'prices.update', 'Change selling prices (writes price history)'),
  ('02800000-0000-7000-8000-000000000107', 'inventory.view', 'View stock levels'),
  ('02800000-0000-7000-8000-000000000108', 'inventory.adjust', 'Adjust stock (frozen inventory tx + movement)'),
  ('02800000-0000-7000-8000-000000000109', 'orders.view', 'View orders'),
  ('02800000-0000-7000-8000-000000000110', 'orders.update', 'Advance/fulfill orders'),
  ('02800000-0000-7000-8000-000000000111', 'orders.cancel', 'Cancel orders within policy'),
  ('02800000-0000-7000-8000-000000000112', 'customers.view', 'View customers'),
  ('02800000-0000-7000-8000-000000000113', 'promotions.view', 'View promotions'),
  ('02800000-0000-7000-8000-000000000114', 'promotions.create', 'Create promotions'),
  ('02800000-0000-7000-8000-000000000115', 'promotions.update', 'Update promotions'),
  ('02800000-0000-7000-8000-000000000116', 'promotions.disable', 'Disable promotions'),
  ('02800000-0000-7000-8000-000000000117', 'coupons.view', 'View coupons'),
  ('02800000-0000-7000-8000-000000000118', 'coupons.create', 'Create coupons'),
  ('02800000-0000-7000-8000-000000000119', 'coupons.update', 'Update coupons'),
  ('02800000-0000-7000-8000-000000000120', 'coupons.disable', 'Disable coupons'),
  ('02800000-0000-7000-8000-000000000121', 'delivery.view', 'View delivery state'),
  ('02800000-0000-7000-8000-000000000122', 'delivery.assign', 'Assign delivery work'),
  ('02800000-0000-7000-8000-000000000123', 'reports.view', 'View reports'),
  ('02800000-0000-7000-8000-000000000124', 'users.view', 'View admin users'),
  ('02800000-0000-7000-8000-000000000125', 'users.manage', 'Provision/disable admin users'),
  ('02800000-0000-7000-8000-000000000126', 'roles.view', 'View roles'),
  ('02800000-0000-7000-8000-000000000127', 'roles.manage', 'Manage roles and grants'),
  ('02800000-0000-7000-8000-000000000128', 'settings.view', 'View store settings'),
  ('02800000-0000-7000-8000-000000000129', 'settings.manage', 'Change store settings'),
  ('02800000-0000-7000-8000-000000000130', 'audit_logs.view', 'Read audit trail'),
  ('02800000-0000-7000-8000-000000000131', 'notifications.view', 'Read own notifications')
ON CONFLICT (id) DO NOTHING;

-- ---------------- Grants: SUPER_ADMIN = all 31 (explicit rows, enumerable) ----------------
INSERT INTO role_permissions (role_id, permission_id)
SELECT '02800000-0000-7000-8000-000000000001', p.id FROM permissions p
ON CONFLICT DO NOTHING;

-- ---------------- Grants: STORE_ADMIN = 24 (platform-security excluded) ----------------
-- Excluded: users.view, users.manage, roles.view, roles.manage,
--           settings.view, settings.manage, audit_logs.view
INSERT INTO role_permissions (role_id, permission_id)
SELECT '02800000-0000-7000-8000-000000000002', p.id FROM permissions p
WHERE p.key NOT IN ('users.view', 'users.manage', 'roles.view', 'roles.manage',
                    'settings.view', 'settings.manage', 'audit_logs.view')
ON CONFLICT DO NOTHING;

-- ---------------- Bootstrap owner (identity only — no credentials stored) ----------------
INSERT INTO users (id, name, email, phone, is_active)
VALUES ('02800000-0000-7000-8000-000000000010', 'System Owner', 'owner@hyper-al-moatasem.local',
        '201000000000', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_roles (user_id, role_id)
VALUES ('02800000-0000-7000-8000-000000000010', '02800000-0000-7000-8000-000000000001')
ON CONFLICT DO NOTHING;

-- ---------------- Operational settings ----------------
INSERT INTO store_settings (id, key, value_text, value_type, description) VALUES
  ('02800000-0000-7000-8000-000000000201', 'store.name', 'Hyper Al-Moatasem', 'TEXT', 'Public store name (Arabic UI renders storefront copy)'),
  ('02800000-0000-7000-8000-000000000202', 'store.phone', '201000000000', 'TEXT', 'Public contact phone'),
  ('02800000-0000-7000-8000-000000000203', 'store.email', 'store@hyper-al-moatasem.local', 'TEXT', 'Public contact email'),
  ('02800000-0000-7000-8000-000000000204', 'currency', 'EGP', 'TEXT', 'Single operating currency (frozen assumption)'),
  ('02800000-0000-7000-8000-000000000205', 'timezone', 'Africa/Cairo', 'TEXT', 'Operating timezone'),
  ('02800000-0000-7000-8000-000000000206', 'delivery.enabled', 'false', 'BOOLEAN', 'Delivery fulfillment switch (delivery phase owns mechanics)'),
  ('02800000-0000-7000-8000-000000000207', 'delivery.default_fee', '20.00', 'NUMERIC', 'Default delivery fee applied by future delivery phase'),
  ('02800000-0000-7000-8000-000000000208', 'orders.auto_cancel_minutes', '30', 'INTEGER', 'Unpaid-order auto-cancel window (payments phase consumes)')
ON CONFLICT (id) DO NOTHING;

COMMIT;
