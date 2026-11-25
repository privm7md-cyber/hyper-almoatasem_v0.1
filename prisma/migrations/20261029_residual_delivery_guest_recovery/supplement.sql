-- RESIDUAL PHASE-10 CLOSURE supplement (SQL-only integrity the Prisma part
-- cannot own). Order: CHECKs -> trigger reuse. Reuses the frozen
-- set_updated_at() function (defined by the baseline); no new functions.

-- ============================ CHECK constraints =============================
-- Delivery fee is a non-negative NUMERIC(10,2); zero is a deliberate admin
-- decision, never a conversion fallback. NUMERIC(10,2) already caps the value
-- at 99,999,999.99.
ALTER TABLE delivery_zones ADD CONSTRAINT chk_delivery_zone_fee CHECK (fee >= 0);
ALTER TABLE delivery_zones ADD CONSTRAINT chk_delivery_zone_version CHECK (version >= 1);
ALTER TABLE delivery_zones ADD CONSTRAINT chk_delivery_zone_normalized CHECK (
  char_length(normalized_name) BETWEEN 1 AND 80
  AND normalized_name = btrim(normalized_name));

-- Guest checkout recovery sessions: hash-only, same shape as the per-order
-- credential (64 lowercase hex chars). Past expiry is a legitimate terminal
-- state (liveness is gated by `expires_at > now()` in lookups), so there is
-- deliberately no `expires_at > created_at` CHECK.
ALTER TABLE guest_checkout_sessions ADD CONSTRAINT chk_guest_checkout_token CHECK (
  token_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE guest_checkout_sessions ADD CONSTRAINT chk_guest_checkout_revoked CHECK (
  revoked_at IS NULL OR revoked_at >= created_at);

-- ============================ Trigger reuse =================================
-- Admin edits keep updated_at fresh through the frozen writer.
CREATE TRIGGER trg_delivery_zones_updated_at
  BEFORE UPDATE ON delivery_zones FOR EACH ROW EXECUTE FUNCTION set_updated_at();
