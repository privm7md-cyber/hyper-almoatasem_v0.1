-- GUEST ORDER supplement (official): SQL-only integrity the Prisma part
-- cannot own. Order: history-actor CHECK amendment -> CHECKs -> partial
-- index -> trigger reuse. Reuses the frozen set_updated_at() function
-- (defined by the baseline); no new functions are introduced.

-- ============================ History actor amendment =====================
-- BGGO-D005 (LOCKED): guest-performed order actions record actor_type
-- 'GUEST' with NULL actor_id (guests own no customer row). SYSTEM-as-stand-in
-- was rejected as dishonest attribution. Additive whitelist widening only:
-- existing SYSTEM/CUSTOMER/STAFF writers are unaffected.
ALTER TABLE order_status_history DROP CONSTRAINT chk_history_actor_type;
ALTER TABLE order_status_history ADD CONSTRAINT chk_history_actor_type CHECK (
  actor_type IN ('SYSTEM', 'CUSTOMER', 'STAFF', 'GUEST'));
ALTER TABLE order_status_history DROP CONSTRAINT chk_history_actor;
ALTER TABLE order_status_history ADD CONSTRAINT chk_history_actor CHECK (
  ((actor_type = 'SYSTEM' OR actor_type = 'GUEST') AND actor_id IS NULL) OR
  ((actor_type = 'CUSTOMER' OR actor_type = 'STAFF') AND actor_id IS NOT NULL));

-- ================== Replacement decider amendment =========================
-- BGGO-D006 (LOCKED), found during implementation: the frozen decider
-- CHECKs demand a non-null decided_by_id on every decided row and whitelist
-- SYSTEM/CUSTOMER/STAFF only, so a GUEST/NULL decision (the locked guest
-- decide record) is impossible without amendment — same approved class as
-- the history-actor widening above (BGGO-D005). SYSTEM-as-stand-in and
-- CUSTOMER-with-NULL were both rejected (dishonest attribution / CHECK
-- violation). Additive widening only: existing writers unaffected.
ALTER TABLE order_item_replacements DROP CONSTRAINT chk_repl_decider_type;
ALTER TABLE order_item_replacements ADD CONSTRAINT chk_repl_decider_type CHECK (
  decided_by_type IS NULL OR decided_by_type IN ('SYSTEM', 'CUSTOMER', 'STAFF', 'GUEST'));
ALTER TABLE order_item_replacements DROP CONSTRAINT chk_repl_decided;
ALTER TABLE order_item_replacements ADD CONSTRAINT chk_repl_decided CHECK (
  (status = 'PROPOSED' AND decided_by_type IS NULL AND decided_by_id IS NULL AND replacement_order_item_id IS NULL) OR
  (status IN ('CUSTOMER_APPROVED', 'CUSTOMER_REJECTED', 'AUTO_ACCEPTED') AND decided_by_type IS NOT NULL AND
    (((decided_by_type = 'SYSTEM' OR decided_by_type = 'CUSTOMER' OR decided_by_type = 'STAFF') AND decided_by_id IS NOT NULL) OR
     (decided_by_type = 'GUEST' AND decided_by_id IS NULL))));

-- ============================ CHECK constraints =============================
-- NOTE: no expires_at > created_at CHECK on purpose — expiry in the past is
-- a legitimate terminal state (expired credentials read 410); liveness is
-- gated by `expires_at > now()` in lookups, never by this constraint.
ALTER TABLE guest_order_credentials ADD CONSTRAINT chk_guest_cred_revoked CHECK (
  revoked_at IS NULL OR revoked_at >= created_at);
ALTER TABLE guest_order_credentials ADD CONSTRAINT chk_guest_cred_token CHECK (
  token_hash ~ '^[0-9a-f]{64}$');

ALTER TABLE guest_order_rate_limits ADD CONSTRAINT chk_guest_ratelimit_attempts CHECK (
  attempts >= 1);

-- ============================ Partial indexes ===============================
-- Exactly one LIVE credential per order (revocation-aware UNIQUE — the
-- frozen-style partial-UQ pattern, e.g. uq_carts_active_customer). Revoked
-- rows stay as history, so rotation (revoke + insert) is legal while double
-- live issuance is impossible, including across concurrent rotations (the
-- loser surfaces 23505 → 409). No now()-based predicates: partial-index
-- predicates must be IMMUTABLE, so expiry filtering stays in SQL.
CREATE UNIQUE INDEX uq_guest_order_credentials_order_live ON guest_order_credentials (order_id)
  WHERE revoked_at IS NULL;

-- ============================ Trigger reuse =================================
-- Rate-bucket freshness stamp reuses the frozen updated_at writer.
CREATE TRIGGER trg_guest_rate_limits_updated_at
  BEFORE UPDATE ON guest_order_rate_limits FOR EACH ROW EXECUTE FUNCTION set_updated_at();
