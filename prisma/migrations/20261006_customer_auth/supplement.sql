-- CUSTOMER AUTH FOUNDATION supplement (official): SQL-only integrity the Prisma
-- part cannot own. Order: CHECKs -> partial indexes -> trigger reuse.
-- Reuses the frozen set_updated_at() function (defined by the baseline);
-- no new functions are introduced in this migration.

-- ============================ CHECK constraints =============================
ALTER TABLE customers ADD CONSTRAINT chk_customers_failed_attempts CHECK (
  failed_login_attempts >= 0);

ALTER TABLE customer_sessions ADD CONSTRAINT chk_customer_sessions_expiry CHECK (
  expires_at > created_at);
ALTER TABLE customer_sessions ADD CONSTRAINT chk_customer_sessions_revoked CHECK (
  revoked_at IS NULL OR revoked_at >= created_at);
ALTER TABLE customer_sessions ADD CONSTRAINT chk_customer_sessions_token CHECK (
  token_hash ~ '^[0-9a-f]{64}$');

ALTER TABLE customer_auth_rate_limits ADD CONSTRAINT chk_customer_ratelimit_attempts CHECK (
  attempts >= 1);

-- ============================ Partial indexes ===============================
-- Live-session lookup per customer (revocation-aware). No now()-based
-- predicates: partial-index predicates must be IMMUTABLE, so expiry
-- filtering stays in SQL.
CREATE INDEX idx_customer_sessions_customer_live ON customer_sessions (customer_id)
  WHERE revoked_at IS NULL;

-- ============================ Trigger reuse =================================
-- Rate-bucket freshness stamp reuses the frozen updated_at writer.
CREATE TRIGGER trg_customer_rate_limits_updated_at
  BEFORE UPDATE ON customer_auth_rate_limits FOR EACH ROW EXECUTE FUNCTION set_updated_at();
