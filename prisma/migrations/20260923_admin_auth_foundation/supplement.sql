-- ADMIN AUTH FOUNDATION supplement (official): SQL-only integrity the Prisma
-- part cannot own. Order: CHECKs -> partial indexes -> trigger reuse.
-- Reuses the frozen set_updated_at() function (defined by the baseline);
-- no new functions are introduced in this migration.

-- ============================ CHECK constraints =============================
ALTER TABLE users ADD CONSTRAINT chk_users_password_hash CHECK (
  password_hash IS NULL OR length(password_hash) >= 20);
ALTER TABLE users ADD CONSTRAINT chk_users_failed_attempts CHECK (
  failed_login_attempts >= 0);

ALTER TABLE admin_sessions ADD CONSTRAINT chk_sessions_expiry CHECK (
  expires_at > created_at);
ALTER TABLE admin_sessions ADD CONSTRAINT chk_sessions_revoked CHECK (
  revoked_at IS NULL OR revoked_at >= created_at);
ALTER TABLE admin_sessions ADD CONSTRAINT chk_sessions_token CHECK (
  token_hash ~ '^[0-9a-f]{64}$');

ALTER TABLE admin_auth_tokens ADD CONSTRAINT chk_tokens_purpose CHECK (
  purpose IN ('INVITATION', 'PASSWORD_RESET'));
ALTER TABLE admin_auth_tokens ADD CONSTRAINT chk_tokens_expiry CHECK (
  expires_at > created_at);
ALTER TABLE admin_auth_tokens ADD CONSTRAINT chk_tokens_used CHECK (
  used_at IS NULL OR used_at >= created_at);
ALTER TABLE admin_auth_tokens ADD CONSTRAINT chk_tokens_token CHECK (
  token_hash ~ '^[0-9a-f]{64}$');

ALTER TABLE admin_auth_rate_limits ADD CONSTRAINT chk_ratelimit_attempts CHECK (
  attempts >= 1);

-- ============================ Partial indexes ===============================
-- Live-session lookup per user (revocation-aware). No now()-based predicates:
-- partial-index predicates must be IMMUTABLE, so expiry filtering stays in SQL.
CREATE INDEX idx_sessions_user_live ON admin_sessions (user_id)
  WHERE revoked_at IS NULL;

-- ============================ Trigger reuse =================================
-- Rate-bucket freshness stamp reuses the frozen updated_at writer.
CREATE TRIGGER trg_rate_limits_updated_at
  BEFORE UPDATE ON admin_auth_rate_limits FOR EACH ROW EXECUTE FUNCTION set_updated_at();
