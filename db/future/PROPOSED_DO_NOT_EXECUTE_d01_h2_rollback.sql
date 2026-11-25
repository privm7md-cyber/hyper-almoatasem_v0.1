-- ============================================================================
-- P12-08 D01 — PROPOSED IDEMPOTENT ROLLBACK (REVIEW ARTIFACT ONLY)
-- ============================================================================
-- STATUS: PROPOSED, ISOLATED-REHEARSAL-VERIFIED, NOT AUTHORIZED FOR EXECUTION.
-- Lives under `db/future/` (NEVER `prisma/migrations/`).
-- ============================================================================

BEGIN;

DO $$
BEGIN
  RAISE EXCEPTION 'NON-EXECUTABLE REVIEW ARTIFACT: D01 H2 rollback SQL is a review artifact only.';
END
$$;

SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '5s';

DROP FUNCTION IF EXISTS public.redact_customer_audit_pii(uuid);
DROP FUNCTION IF EXISTS public.record_customer_audit_redaction_failure(uuid, text);
DROP FUNCTION IF EXISTS public.reset_failed_customer_audit_redaction_task(uuid);

SET LOCAL ROLE hyper_owner;

DROP TRIGGER IF EXISTS trg_redaction_tasks_validate_enqueue ON public.customer_audit_redaction_tasks;
DROP TRIGGER IF EXISTS trg_redaction_tasks_no_delete ON public.customer_audit_redaction_tasks;
DROP TRIGGER IF EXISTS trg_redaction_tasks_no_truncate ON public.customer_audit_redaction_tasks;
DROP TABLE IF EXISTS public.customer_audit_redaction_tasks;

DROP TRIGGER IF EXISTS trg_audit_logs_guard_update ON public.audit_logs;
DROP TRIGGER IF EXISTS trg_audit_logs_no_delete ON public.audit_logs;
DROP TRIGGER IF EXISTS trg_audit_logs_no_truncate ON public.audit_logs;

DROP FUNCTION IF EXISTS public.audit_logs_guard_customer_pii_redaction();
DROP FUNCTION IF EXISTS public.redaction_tasks_validate_enqueue();
DROP FUNCTION IF EXISTS public.audit_logs_forbid_delete_truncate();
DROP FUNCTION IF EXISTS public.scrub_customer_audit_jsonb(jsonb);

CREATE OR REPLACE FUNCTION public.audit_logs_insert_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$function$;

REVOKE ALL ON FUNCTION public.audit_logs_insert_only() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_audit_logs_row_immutable ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_row_immutable
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_logs_insert_only();

DROP TRIGGER IF EXISTS trg_audit_logs_no_truncate ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_no_truncate
  BEFORE TRUNCATE ON public.audit_logs
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.audit_logs_insert_only();

RESET ROLE;

REVOKE ALL ON TABLE public.audit_logs FROM hyper_audit_redactor, hyper_privacy_worker;
REVOKE ALL ON TABLE public.customers, public.orders FROM hyper_audit_redactor;
REVOKE USAGE, CREATE ON SCHEMA public FROM hyper_audit_redactor;

COMMIT;
