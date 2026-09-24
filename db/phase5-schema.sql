-- ============================================================================
-- HYPERMARKET STORE — PHASE 5 SCHEMA: ADMINISTRATION (RBAC + AUDIT + OPS)
-- ============================================================================
-- APPLY ORDER: phase1 → phase1-seed (opt) → phase2 → phase2-seed (opt) →
--              phase4 → phase4-seed (opt) → THEN this file. Requires the frozen
--              set_updated_at() function. Alters NO frozen object.
-- SCOPE: 8 tables. NO auth/session/password tables (authentication mechanism
--        undecided — see docs/final-database-architecture-v1.md §13/§15).
--        NO payments / delivery / frontend objects.
-- CONVENTIONS (frozen): app-generated UUIDv7 ids, gen_random_uuid() backstop
-- (pgcrypto), UUID PKs, RESTRICT-by-default FKs (NO CASCADE in Phase 5 except
-- notifications→users, documented), append-only histories, lowercase spaceless
-- identifiers, READ COMMITTED (no isolation change).
-- AUTHORIZATION MODEL (frozen by final-erd-v1): users → roles → permissions.
-- SUPER_ADMIN = seeded ROLE holding all grants explicitly (data, not a bypass).
-- Effective grant = active user AND active role AND (role, permission) mapped.
-- ============================================================================

-- ================================ USERS =====================================
-- Admin identity + authorization anchor ONLY. No password system (auth undecided);
-- no FK to customers (admins never live in the customer table).

CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(120) NOT NULL CONSTRAINT chk_users_name CHECK (name <> ''),
  -- Login identifier: always present, unique, stored lowercase.
  email       VARCHAR(160) NOT NULL UNIQUE
                CONSTRAINT chk_users_email CHECK (
                  email <> '' AND email = lower(email)
                  AND position('@' IN email) > 1 AND position(' ' IN email) = 0),
  -- Optional contact; unique when present (Egyptian-mobile validated app-side).
  phone       VARCHAR(20) NULL
                CONSTRAINT chk_users_phone CHECK (
                  phone IS NULL OR phone ~ '^[0-9]{8,15}$'),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,   -- disable, don't delete
  last_login_at TIMESTAMPTZ NULL,              -- written by the auth layer when it lands
  created_by  UUID NULL,   -- no FK (frozen created_by convention; bootstrap row has none)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ NULL,
  CONSTRAINT chk_users_deleted_consistency CHECK (
    deleted_at IS NULL OR is_active = FALSE)
);
-- Login + contact lookups. is_active deliberately NOT indexed (low cardinality).
CREATE UNIQUE INDEX uq_users_phone ON users (phone) WHERE phone IS NOT NULL;

-- ================================ ROLES =====================================
-- Data rows, NOT enums: future roles need zero DDL.

CREATE TABLE roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(60) NOT NULL UNIQUE
                CONSTRAINT chk_roles_name CHECK (name <> '' AND position(' ' IN name) = 0),
  description TEXT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,   -- disable blocks NEW grants; existing
                                               -- mappings authorize only via active roles (app rule)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ NULL,
  CONSTRAINT chk_roles_deleted_consistency CHECK (
    deleted_at IS NULL OR is_active = FALSE)
);

-- ============================== USER ROLES ==================================
-- Many-to-many. NO users.role_id (by design). Mappings are accountability-relevant:
-- revoke explicitly; RESTRICT both sides (audit trail references who-held-what).

CREATE TABLE user_roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users (id)
                ON DELETE RESTRICT
                ON UPDATE CASCADE,
  role_id     UUID NOT NULL REFERENCES roles (id)
                ON DELETE RESTRICT
                ON UPDATE CASCADE,
  assigned_by UUID NULL,   -- no FK (frozen convention)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  -- No updated_at: mappings are created/revoked, never edited (revoke = DELETE).
  ,
  CONSTRAINT uq_user_roles_pair UNIQUE (user_id, role_id)
);
CREATE INDEX idx_user_roles_user ON user_roles (user_id);   -- member listing
CREATE INDEX idx_user_roles_role ON user_roles (role_id);   -- role roster

-- ============================= PERMISSIONS ==================================
-- Action registry (never UI pages). Keys are stable identifiers; deprecate via
-- is_active, delete only when unreferenced (RESTRICT below enforces the order).

CREATE TABLE permissions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key         VARCHAR(120) NOT NULL UNIQUE
                CONSTRAINT chk_permissions_key CHECK (key ~ '^[a-z0-9_]+\.[a-z0-9_]+$'),
  description TEXT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  -- No updated_at/deleted_at: registry rows are added/deprecated, not edited.
);

-- =========================== ROLE PERMISSIONS ===============================
-- Many-to-many grants. RESTRICT both sides: explicit revoke before role/permission
-- removal; audit_logs captures grant/revoke events. NO CASCADE in Phase 5
-- (uniform, reviewable) — except notifications→users (below, documented).

CREATE TABLE role_permissions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id       UUID NOT NULL REFERENCES roles (id)
                  ON DELETE RESTRICT
                  ON UPDATE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions (id)
                  ON DELETE RESTRICT
                  ON UPDATE CASCADE,
  granted_by    UUID NULL,   -- no FK (frozen convention)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_role_permissions_pair UNIQUE (role_id, permission_id)
);
CREATE INDEX idx_role_permissions_role ON role_permissions (role_id);         -- grant listing
CREATE INDEX idx_role_permissions_permission ON role_permissions (permission_id);  -- where-used

-- ============================== AUDIT LOGS ==================================
-- Append-only security/accountability trail. NEVER updated or deleted by the app.
-- user_id NULL = system action (actor_type pairing mirrors the frozen Phase 2 pattern).

CREATE TABLE audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NULL REFERENCES users (id)
                ON DELETE RESTRICT     -- history pins its actors forever
                ON UPDATE CASCADE,
  actor_type  VARCHAR(10) NOT NULL
                CONSTRAINT chk_audit_actor CHECK (actor_type IN ('ADMIN', 'SYSTEM')),
  -- Namespaced action (never SELECTs/drafts/derived reads — see audit boundary).
  action      VARCHAR(80) NOT NULL
                CONSTRAINT chk_audit_action CHECK (action ~ '^[a-z0-9_]+\.[a-z0-9_]+$'),
  entity_type VARCHAR(40) NOT NULL,   -- NO FK (polymorphic; frozen targets precedent)
  entity_id   UUID NULL,              -- NULL for global actions (e.g. auth.login)
  -- Sanitized snapshots ONLY (allowlist, app-enforced, review-gated).
  -- FORBIDDEN: passwords, hashes, session/API/payment secrets, tokens,
  -- and PII beyond strict business need.
  old_values  JSONB NULL,
  new_values  JSONB NULL,
  ip_address  INET NULL,
  user_agent  VARCHAR(500) NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  -- No updated_at/deleted_at: immutable by convention (mirrors frozen ledgers).
  ,
  CONSTRAINT chk_audit_actor_pair CHECK (
    (actor_type = 'SYSTEM' AND user_id IS NULL)
    OR (actor_type = 'ADMIN' AND user_id IS NOT NULL))
);
CREATE INDEX idx_audit_user_time ON audit_logs (user_id, created_at DESC);      -- actor trail
CREATE INDEX idx_audit_entity ON audit_logs (entity_type, entity_id);           -- entity trail
CREATE INDEX idx_audit_time ON audit_logs (created_at DESC);                    -- global feed
CREATE INDEX idx_audit_action_time ON audit_logs (action, created_at DESC);     -- action-scoped audits

-- ============================ STORE SETTINGS ================================
-- Key/value + DB-validated type (NOT a dumping ground; NOT for secrets).
-- Typed-columns rejected (schema churn per setting); unvalidated EAV rejected.

CREATE TABLE store_settings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key         VARCHAR(120) NOT NULL UNIQUE
                CONSTRAINT chk_settings_key CHECK (
                  key <> '' AND key = lower(key) AND position(' ' IN key) = 0),
  value_text  TEXT NOT NULL,
  value_type  VARCHAR(10) NOT NULL
                CONSTRAINT chk_settings_type CHECK (
                  value_type IN ('BOOLEAN', 'INTEGER', 'NUMERIC', 'TEXT', 'JSON')),
  description TEXT NULL,
  updated_by  UUID NULL,   -- no FK (frozen convention)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- DB-enforced typing. CASE short-circuits (only the matching branch evaluates),
  -- so TEXT rows never touch the JSON cast. Invalid JSON under JSON type raises,
  -- which rejects the write — enforcement by rejection either way.
  CONSTRAINT chk_settings_typed CHECK (
    CASE value_type
      WHEN 'BOOLEAN' THEN value_text IN ('true', 'false')
      WHEN 'INTEGER' THEN value_text ~ '^-?[0-9]+$'
      WHEN 'NUMERIC' THEN value_text ~ '^-?[0-9]+(\.[0-9]+)?$'
      WHEN 'TEXT' THEN true
      WHEN 'JSON' THEN value_text::jsonb IS NOT NULL
    END)
);
-- Raw payment secrets FORBIDDEN here and everywhere (stated ban; no flag column needed).

-- ============================ NOTIFICATIONS =================================
-- Per-user operational inbox. Explicitly NOT a second audit log. The single
-- justified CASCADE in Phase 5: inbox rows are non-evidentiary (the durable
-- record lives in audit_logs); retention sweeps may delete old READ rows.

CREATE TABLE notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users (id)
               ON DELETE CASCADE        -- inbox dies with its user (documented)
               ON UPDATE CASCADE,
  type       VARCHAR(60) NOT NULL
               CONSTRAINT chk_notifications_type CHECK (type ~ '^[a-z0-9_.]+$'),
  title      VARCHAR(160) NOT NULL CONSTRAINT chk_notifications_title CHECK (title <> ''),
  message    TEXT NOT NULL CONSTRAINT chk_notifications_message CHECK (message <> ''),
  -- Entity ids / order numbers / thresholds ONLY. No secrets, no PII beyond need,
  -- never a substitute for audit rows.
  data       JSONB NULL,
  read_at    TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  -- No updated_at: read_at is the only mutation, by design.
);
-- Unread-inbox hot query + retention sweeps.
CREATE INDEX idx_notifications_inbox ON notifications (user_id, read_at, created_at DESC);
CREATE INDEX idx_notifications_time ON notifications (created_at);

-- ================================ TRIGGERS ==================================
-- updated_at only where rows are EDITED (users, roles, store_settings).
-- Mappings/registry/audit/inbox rows are created/revoked, never edited.

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_roles_updated_at
  BEFORE UPDATE ON roles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_settings_updated_at
  BEFORE UPDATE ON store_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================ FROZEN CONTRACT NOTES =========================
-- ENFORCED BY WRITER DISCIPLINE + review (inexpressible same-row or cross-row):
--  1. Effective grant = user.is_active AND role.is_active AND mapping exists.
--     Disabled users/roles authorize nothing (app rule on every grant evaluation).
--  2. SUPER_ADMIN role row is protected by app policy (cannot delete/rename); its
--     grants are explicit data rows, enumerable at any time (no bypass flag).
--  3. Audit payload sanitizer is allowlist-based (app-side); forbidden classes
--     (passwords/hashes/tokens/secrets) must never reach old_values/new_values.
--  4. Admin price/stock/promo/order mutations MUST flow through the frozen domain
--     transactions (price_history row, inventory tx + movement, promo tables,
--     status-history rows) with an audit_logs row in the same tx — administration
--     manages frozen domains, never duplicates them (no admin_* entities).
--  5. Sessions/password policy arrive with the authentication decision; until then
--     no credential material is stored anywhere (users table carries identity only).
