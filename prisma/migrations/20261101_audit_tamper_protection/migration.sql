-- ============================================================================
-- 20261101_audit_tamper_protection — BL-01 audit hardening (tamper guard)
-- ============================================================================
-- The audit trail is the store of record for admin/system business actions.
-- Until now NOTHING prevented a SQL session (including the runtime role,
-- which holds UPDATE/DELETE grants by the replayed ACL) from silently
-- rewriting or erasing audit rows. This migration makes audit_logs strictly
-- append-only at the database level: UPDATE, DELETE and TRUNCATE are
-- rejected for every role. Corrections to erroneous audit content are out of
-- scope by design — an audit trail that can be edited is not evidence.
--
-- Additive only: no column, no CHECK, no grant, no Prisma-model change.
-- Row-level triggers cover UPDATE/DELETE; a statement-level trigger covers
-- TRUNCATE (row triggers do not fire for it).
-- ============================================================================

CREATE OR REPLACE FUNCTION audit_logs_insert_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_logs_row_immutable ON audit_logs;
CREATE TRIGGER trg_audit_logs_row_immutable
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION audit_logs_insert_only();

DROP TRIGGER IF EXISTS trg_audit_logs_no_truncate ON audit_logs;
CREATE TRIGGER trg_audit_logs_no_truncate
  BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT
  EXECUTE FUNCTION audit_logs_insert_only();
