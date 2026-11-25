-- ============================================================================
-- P12-08 D01 — PROPOSED HARDENED DESIGN H2 MIGRATION (REVIEW ARTIFACT ONLY)
-- ============================================================================
-- STATUS: PROPOSED, ISOLATED-REHEARSAL-VERIFIED, NOT AUTHORIZED FOR EXECUTION.
-- Lives under `db/future/` (NEVER `prisma/migrations/`) so no migration runner
-- or deploy hook can apply it implicitly.
--
-- SAFETY LOCK: Executing this file as-is aborts immediately inside `BEGIN`
-- before running a single DDL statement. Production or Scratch execution
-- requires separate explicit Owner authorization and a dedicated maintenance
-- runbook.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  RAISE EXCEPTION 'NON-EXECUTABLE REVIEW ARTIFACT: D01 H2 migration is not authorized for execution without explicit Owner approval.';
END
$$;

SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '5s';

DO $$
DECLARE
  v_db           text := pg_catalog.current_database();
  v_bad_role_cnt integer;
  v_member_cnt   integer;
BEGIN
  IF v_db <> 'hyper_almoatasem' THEN
    RAISE EXCEPTION 'MIGRATION ABORT: Expected hyper_almoatasem, got %', v_db;
  END IF;

  SELECT count(*)::int INTO v_bad_role_cnt
    FROM pg_catalog.pg_roles AS r
   WHERE r.rolname = 'hyper_audit_redactor'
     AND r.rolcanlogin = false
     AND r.rolsuper = false
     AND r.rolinherit = false
     AND r.rolcreaterole = false
     AND r.rolcreatedb = false
     AND r.rolbypassrls = false;

  IF v_bad_role_cnt <> 1 THEN
    RAISE EXCEPTION 'ROLE GATE FAILED: hyper_audit_redactor missing or has unsafe role flags';
  END IF;

  SELECT count(*)::int INTO v_bad_role_cnt
    FROM pg_catalog.pg_roles AS r
   WHERE r.rolname IN ('hyper_privacy_worker', 'hyper_app', 'hyper_owner')
     AND r.rolcanlogin = true
     AND r.rolsuper = false
     AND r.rolinherit = false
     AND r.rolcreaterole = false
     AND r.rolcreatedb = false
     AND r.rolbypassrls = false;

  IF v_bad_role_cnt <> 3 THEN
    RAISE EXCEPTION 'ROLE GATE FAILED: runtime/worker/owner roles missing or over-privileged';
  END IF;

  SELECT count(*)::int INTO v_member_cnt
    FROM pg_catalog.pg_auth_members AS am
    JOIN pg_catalog.pg_roles AS r ON r.oid = am.roleid
    JOIN pg_catalog.pg_roles AS m ON m.oid = am.member
   WHERE r.rolname IN ('hyper_audit_redactor', 'hyper_privacy_worker')
      OR m.rolname IN ('hyper_audit_redactor', 'hyper_privacy_worker');

  IF v_member_cnt <> 0 THEN
    RAISE EXCEPTION 'ROLE GATE FAILED: unexpected role memberships (%) on H2 roles', v_member_cnt;
  END IF;
END
$$;

ALTER DEFAULT PRIVILEGES FOR ROLE hyper_owner IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE hyper_audit_redactor IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

SET LOCAL ROLE hyper_owner;

CREATE TABLE IF NOT EXISTS public.customer_audit_redaction_tasks (
  id                      uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  customer_id             uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  anonymize_audit_id      uuid NOT NULL UNIQUE REFERENCES public.audit_logs(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  requested_by_user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  requested_by_session_id uuid NOT NULL REFERENCES public.admin_sessions(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  status                  varchar(24) NOT NULL DEFAULT 'PENDING',
  attempt_count           integer NOT NULL DEFAULT 0,
  redacted_audit_rows     integer,
  completion_audit_id     uuid REFERENCES public.audit_logs(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  last_error_code         varchar(80),
  created_at              timestamptz(6) NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at              timestamptz(6) NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  completed_at            timestamptz(6),
  CONSTRAINT chk_redaction_task_status
    CHECK (status IN ('PENDING', 'FAILED', 'COMPLETED')),
  CONSTRAINT chk_redaction_task_attempts
    CHECK (attempt_count >= 0),
  CONSTRAINT chk_redaction_task_error_code_fmt
    CHECK (last_error_code IS NULL OR (last_error_code)::text OPERATOR(pg_catalog.~) '^[A-Z0-9_]{1,80}$'),
  CONSTRAINT chk_redaction_task_completion_integrity
    CHECK (
      (status = 'COMPLETED'
        AND completed_at IS NOT NULL
        AND completion_audit_id IS NOT NULL
        AND redacted_audit_rows IS NOT NULL
        AND redacted_audit_rows >= 0
        AND last_error_code IS NULL)
      OR
      (status = 'PENDING'
        AND attempt_count = 0
        AND completed_at IS NULL
        AND completion_audit_id IS NULL
        AND redacted_audit_rows IS NULL
        AND last_error_code IS NULL)
      OR
      (status = 'FAILED'
        AND attempt_count >= 1
        AND completed_at IS NULL
        AND completion_audit_id IS NULL
        AND redacted_audit_rows IS NULL
        AND last_error_code IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_redaction_task_active_per_customer
  ON public.customer_audit_redaction_tasks (customer_id)
  WHERE status IN ('PENDING', 'FAILED');

CREATE INDEX IF NOT EXISTS idx_redaction_tasks_pending_created
  ON public.customer_audit_redaction_tasks (status, created_at ASC);

CREATE OR REPLACE FUNCTION public.scrub_customer_audit_jsonb(p_val jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_type          text;
  v_key           text;
  v_val           jsonb;
  v_val_type      text;
  v_elem          jsonb;
  v_elem_type     text;
  v_str           text;
  v_valid_fields  boolean;
  v_obj_acc       jsonb := '{}'::jsonb;
  v_arr_acc       jsonb := '[]'::jsonb;
  c_redacted      constant jsonb := pg_catalog.to_jsonb('تمت إزالة البيانات لأسباب الخصوصية'::text);
BEGIN
  IF p_val IS NULL THEN
    RETURN NULL;
  END IF;
  v_type := pg_catalog.jsonb_typeof(p_val);
  IF v_type = 'null' THEN
    RETURN 'null'::jsonb;
  ELSIF v_type = 'array' THEN
    FOR v_elem IN SELECT value FROM pg_catalog.jsonb_array_elements(p_val)
    LOOP
      v_elem_type := pg_catalog.jsonb_typeof(v_elem);
      IF v_elem_type IN ('object', 'array') THEN
        v_arr_acc := v_arr_acc || pg_catalog.jsonb_build_array(public.scrub_customer_audit_jsonb(v_elem));
      ELSIF v_elem_type = 'null' THEN
        v_arr_acc := v_arr_acc || '[null]'::jsonb;
      ELSE
        v_arr_acc := v_arr_acc || pg_catalog.jsonb_build_array(c_redacted);
      END IF;
    END LOOP;
    RETURN v_arr_acc;
  ELSIF v_type = 'object' THEN
    FOR v_key, v_val IN SELECT key, value FROM pg_catalog.jsonb_each(p_val)
    LOOP
      v_val_type := pg_catalog.jsonb_typeof(v_val);
      IF pg_catalog.lower(v_key) IN (
        'isregistered', 'is_registered',
        'isactive', 'is_active',
        'autoacceptreplacements', 'auto_accept_replacements'
      ) AND v_val_type = 'boolean' THEN
        v_obj_acc := v_obj_acc || pg_catalog.jsonb_build_object(v_key, v_val);
      ELSIF pg_catalog.lower(v_key) = 'correlation_id' AND v_val_type = 'string' THEN
        v_str := v_val #>> '{}';
        IF v_str OPERATOR(pg_catalog.~) '^[A-Za-z0-9][A-Za-z0-9._:\-]{0,63}$'
           AND pg_catalog.strpos(v_str, '@') = 0 THEN
          v_obj_acc := v_obj_acc || pg_catalog.jsonb_build_object(v_key, v_val);
        ELSE
          v_obj_acc := v_obj_acc || pg_catalog.jsonb_build_object(v_key, c_redacted);
        END IF;
      ELSIF pg_catalog.lower(v_key) IN ('changedfields', 'changed_fields') AND v_val_type = 'array' THEN
        SELECT COALESCE(
          pg_catalog.bool_and(
            pg_catalog.jsonb_typeof(e.value) = 'string'
            AND (e.value #>> '{}') IN (
              'firstName', 'first_name',
              'lastName', 'last_name',
              'email',
              'autoAcceptReplacements', 'auto_accept_replacements',
              'isActive', 'is_active'
            )
          ),
          true
        )
        INTO v_valid_fields
        FROM pg_catalog.jsonb_array_elements(v_val) AS e(value);
        IF v_valid_fields THEN
          v_obj_acc := v_obj_acc || pg_catalog.jsonb_build_object(v_key, v_val);
        ELSE
          v_obj_acc := v_obj_acc || pg_catalog.jsonb_build_object(v_key, c_redacted);
        END IF;
      ELSIF v_val_type = 'null' THEN
        v_obj_acc := v_obj_acc || pg_catalog.jsonb_build_object(v_key, 'null'::jsonb);
      ELSIF v_val_type IN ('object', 'array') THEN
        v_obj_acc := v_obj_acc || pg_catalog.jsonb_build_object(v_key, public.scrub_customer_audit_jsonb(v_val));
      ELSE
        v_obj_acc := v_obj_acc || pg_catalog.jsonb_build_object(v_key, c_redacted);
      END IF;
    END LOOP;
    RETURN v_obj_acc;
  END IF;
  RETURN c_redacted;
END;
$function$;

REVOKE ALL ON FUNCTION public.scrub_customer_audit_jsonb(jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.audit_logs_forbid_delete_truncate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  RAISE EXCEPTION 'Append-only protection on %: % is never permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$function$;

REVOKE ALL ON FUNCTION public.audit_logs_forbid_delete_truncate() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.redaction_tasks_validate_enqueue()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF NEW.status <> 'PENDING'
     OR NEW.attempt_count <> 0
     OR NEW.completed_at IS NOT NULL
     OR NEW.completion_audit_id IS NOT NULL
     OR NEW.redacted_audit_rows IS NOT NULL THEN
    RAISE EXCEPTION 'Redaction task must be enqueued in initial PENDING state'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.customers AS c
     WHERE c.id = NEW.customer_id
       AND c.is_active = false
       AND c.is_registered = false
       AND c.deleted_at IS NOT NULL
       AND c.first_name = 'عميل مجهول'
       AND c.last_name IS NULL
       AND c.email IS NULL
       AND c.password_hash IS NULL
       AND (c.phone)::text OPERATOR(pg_catalog.~) '^000[0-9]{12}$'
  ) THEN
    RAISE EXCEPTION 'Cannot enqueue redaction task: customer % is not anonymized', NEW.customer_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.orders AS o
     WHERE o.customer_id = NEW.customer_id
       AND o.status IN ('NEW', 'CONFIRMED', 'PREPARING', 'READY_FOR_DELIVERY', 'OUT_FOR_DELIVERY')
  ) THEN
    RAISE EXCEPTION 'Cannot enqueue redaction task: customer % has open orders', NEW.customer_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.audit_logs AS a
     WHERE a.id = NEW.anonymize_audit_id
       AND a.entity_type = 'customers'
       AND a.entity_id = NEW.customer_id
       AND a.action = 'customers.anonymize'
       AND a.actor_type = 'ADMIN'
       AND a.user_id = NEW.requested_by_user_id
  ) THEN
    RAISE EXCEPTION 'Cannot enqueue redaction task: invalid anonymize_audit_id %', NEW.anonymize_audit_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_sessions AS s
     WHERE s.id = NEW.requested_by_session_id
       AND s.user_id = NEW.requested_by_user_id
       AND s.revoked_at IS NULL
       AND s.expires_at > pg_catalog.clock_timestamp()
  ) THEN
    RAISE EXCEPTION 'Cannot enqueue redaction task: expired, revoked, or mismatched admin session %',
      NEW.requested_by_session_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.users AS u
      JOIN public.user_roles AS ur ON ur.user_id = u.id
      JOIN public.roles AS r ON r.id = ur.role_id
      JOIN public.role_permissions AS rp ON rp.role_id = r.id
      JOIN public.permissions AS p ON p.id = rp.permission_id
     WHERE u.id = NEW.requested_by_user_id
       AND u.is_active = true
       AND u.deleted_at IS NULL
       AND r.is_active = true
       AND r.deleted_at IS NULL
       AND p.key = 'customers.anonymize'
       AND p.is_active = true
  ) THEN
    RAISE EXCEPTION 'Cannot enqueue redaction task: actor % lacks active customers.anonymize permission',
      NEW.requested_by_user_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.redaction_tasks_validate_enqueue() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.audit_logs_guard_customer_pii_redaction()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'audit_logs is append-only: % is not permitted', TG_OP
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF CURRENT_USER <> 'hyper_audit_redactor'
     OR SESSION_USER <> 'hyper_privacy_worker' THEN
    RAISE EXCEPTION 'audit_logs is append-only: UPDATE is not permitted'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.entity_type <> 'customers'
     OR NEW.entity_type <> 'customers'
     OR OLD.entity_id IS NULL
     OR OLD.action NOT IN ('customers.update', 'customers.register') THEN
    RAISE EXCEPTION 'audit_logs redaction scope violation on row %', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.id <> OLD.id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.actor_type <> OLD.actor_type
     OR NEW.action <> OLD.action
     OR NEW.entity_type <> OLD.entity_type
     OR NEW.entity_id IS DISTINCT FROM OLD.entity_id
     OR NEW.ip_address IS DISTINCT FROM OLD.ip_address
     OR NEW.user_agent IS DISTINCT FROM OLD.user_agent
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'audit_logs forensic envelope columns are immutable (row %)', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.customer_audit_redaction_tasks AS t
      JOIN public.audit_logs AS a ON a.id = t.anonymize_audit_id
     WHERE t.customer_id = OLD.entity_id
       AND t.status IN ('PENDING', 'FAILED')
       AND a.entity_type = 'customers'
       AND a.entity_id = OLD.entity_id
       AND a.action = 'customers.anonymize'
       AND a.actor_type = 'ADMIN'
  ) THEN
    RAISE EXCEPTION 'audit_logs redaction denied: no active authorized redaction task for customer %', OLD.entity_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.customers AS c
     WHERE c.id = OLD.entity_id
       AND c.is_active = false
       AND c.is_registered = false
       AND c.deleted_at IS NOT NULL
       AND c.first_name = 'عميل مجهول'
       AND c.last_name IS NULL
       AND c.email IS NULL
       AND c.password_hash IS NULL
       AND (c.phone)::text OPERATOR(pg_catalog.~) '^000[0-9]{12}$'
  ) OR EXISTS (
    SELECT 1 FROM public.orders AS o
     WHERE o.customer_id = OLD.entity_id
       AND o.status IN ('NEW', 'CONFIRMED', 'PREPARING', 'READY_FOR_DELIVERY', 'OUT_FOR_DELIVERY')
  ) THEN
    RAISE EXCEPTION 'audit_logs redaction denied: customer % state invalid or has open orders', OLD.entity_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.old_values IS DISTINCT FROM public.scrub_customer_audit_jsonb(OLD.old_values)
     OR NEW.new_values IS DISTINCT FROM public.scrub_customer_audit_jsonb(OLD.new_values) THEN
    RAISE EXCEPTION 'audit_logs redaction denied: payload transition violates allowlist scrubber'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.audit_logs_guard_customer_pii_redaction() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_audit_logs_row_immutable ON public.audit_logs;
DROP TRIGGER IF EXISTS trg_audit_logs_no_delete ON public.audit_logs;
DROP TRIGGER IF EXISTS trg_audit_logs_no_truncate ON public.audit_logs;
DROP TRIGGER IF EXISTS trg_audit_logs_guard_update ON public.audit_logs;
DROP FUNCTION IF EXISTS public.audit_logs_insert_only();

CREATE TRIGGER trg_audit_logs_no_delete
  BEFORE DELETE ON public.audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_logs_forbid_delete_truncate();

CREATE TRIGGER trg_audit_logs_no_truncate
  BEFORE TRUNCATE ON public.audit_logs
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.audit_logs_forbid_delete_truncate();

CREATE TRIGGER trg_audit_logs_guard_update
  BEFORE UPDATE ON public.audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_logs_guard_customer_pii_redaction();

DROP TRIGGER IF EXISTS trg_redaction_tasks_validate_enqueue ON public.customer_audit_redaction_tasks;
DROP TRIGGER IF EXISTS trg_redaction_tasks_no_delete ON public.customer_audit_redaction_tasks;
DROP TRIGGER IF EXISTS trg_redaction_tasks_no_truncate ON public.customer_audit_redaction_tasks;

CREATE TRIGGER trg_redaction_tasks_validate_enqueue
  BEFORE INSERT ON public.customer_audit_redaction_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.redaction_tasks_validate_enqueue();

CREATE TRIGGER trg_redaction_tasks_no_delete
  BEFORE DELETE ON public.customer_audit_redaction_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_logs_forbid_delete_truncate();

CREATE TRIGGER trg_redaction_tasks_no_truncate
  BEFORE TRUNCATE ON public.customer_audit_redaction_tasks
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.audit_logs_forbid_delete_truncate();

REVOKE ALL ON TABLE public.audit_logs FROM PUBLIC, hyper_app, hyper_privacy_worker, hyper_audit_redactor;
GRANT SELECT, INSERT ON TABLE public.audit_logs TO hyper_app;

REVOKE ALL ON TABLE public.customer_audit_redaction_tasks FROM PUBLIC, hyper_app, hyper_privacy_worker, hyper_audit_redactor;
GRANT SELECT, INSERT ON TABLE public.customer_audit_redaction_tasks TO hyper_app;
GRANT SELECT ON TABLE public.customer_audit_redaction_tasks TO hyper_privacy_worker;

GRANT SELECT (
  id, user_id, actor_type, action, entity_type, entity_id,
  old_values, new_values, ip_address, user_agent, created_at
) ON TABLE public.audit_logs TO hyper_audit_redactor;
GRANT UPDATE (old_values, new_values), INSERT ON TABLE public.audit_logs TO hyper_audit_redactor;
GRANT SELECT ON TABLE public.customers, public.orders TO hyper_audit_redactor;
GRANT SELECT, UPDATE (
  status, attempt_count, redacted_audit_rows, completion_audit_id,
  last_error_code, updated_at, completed_at
) ON TABLE public.customer_audit_redaction_tasks TO hyper_audit_redactor;
GRANT EXECUTE ON FUNCTION public.scrub_customer_audit_jsonb(jsonb) TO hyper_audit_redactor;

RESET ROLE;

GRANT USAGE, CREATE ON SCHEMA public TO hyper_audit_redactor;
SET LOCAL ROLE hyper_audit_redactor;

CREATE OR REPLACE FUNCTION public.redact_customer_audit_pii(p_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_task                public.customer_audit_redaction_tasks%ROWTYPE;
  v_redacted_count      integer := 0;
  v_unredacted_after    integer := 0;
  v_completion_audit_id uuid;
BEGIN
  IF SESSION_USER <> 'hyper_privacy_worker' THEN
    RAISE EXCEPTION 'Unauthorized session_user % for redact_customer_audit_pii', SESSION_USER
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_task_id IS NULL THEN
    RAISE EXCEPTION 'p_task_id is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_task FROM public.customer_audit_redaction_tasks AS t WHERE t.id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Redaction task % not found', p_task_id USING ERRCODE = 'no_data_found';
  END IF;
  IF v_task.status = 'COMPLETED' THEN
    SELECT count(*)::int INTO v_unredacted_after FROM public.audit_logs AS a
     WHERE a.entity_type = 'customers' AND a.entity_id = v_task.customer_id
       AND a.action IN ('customers.update', 'customers.register')
       AND (a.old_values IS DISTINCT FROM public.scrub_customer_audit_jsonb(a.old_values)
            OR a.new_values IS DISTINCT FROM public.scrub_customer_audit_jsonb(a.new_values));
    IF v_unredacted_after <> 0 THEN
      RAISE EXCEPTION 'Integrity error: task % marked COMPLETED but % unredacted rows exist',
        p_task_id, v_unredacted_after USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'taskId', v_task.id, 'customerId', v_task.customer_id, 'status', 'COMPLETED',
      'alreadyCompleted', true, 'redactedRows', v_task.redacted_audit_rows,
      'completionAuditId', v_task.completion_audit_id
    );
  END IF;
  PERFORM 1 FROM public.audit_logs AS a
    WHERE a.id = v_task.anonymize_audit_id AND a.entity_type = 'customers'
      AND a.entity_id = v_task.customer_id AND a.action = 'customers.anonymize'
      AND a.actor_type = 'ADMIN' AND a.user_id = v_task.requested_by_user_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Originating customers.anonymize audit record % invalid', v_task.anonymize_audit_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  PERFORM 1 FROM public.customers AS c
    WHERE c.id = v_task.customer_id AND c.is_active = false AND c.is_registered = false
      AND c.deleted_at IS NOT NULL AND c.first_name = 'عميل مجهول'
      AND c.last_name IS NULL AND c.email IS NULL AND c.password_hash IS NULL
      AND (c.phone)::text OPERATOR(pg_catalog.~) '^000[0-9]{12}$';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer % is not in canonical anonymized state', v_task.customer_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.orders AS o
     WHERE o.customer_id = v_task.customer_id
       AND o.status IN ('NEW', 'CONFIRMED', 'PREPARING', 'READY_FOR_DELIVERY', 'OUT_FOR_DELIVERY')
  ) THEN
    RAISE EXCEPTION 'Customer % has open orders; redaction refused', v_task.customer_id
      USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.audit_logs AS a
     SET old_values = public.scrub_customer_audit_jsonb(a.old_values),
         new_values = public.scrub_customer_audit_jsonb(a.new_values)
   WHERE a.entity_type = 'customers' AND a.entity_id = v_task.customer_id
     AND a.action IN ('customers.update', 'customers.register')
     AND (a.old_values IS DISTINCT FROM public.scrub_customer_audit_jsonb(a.old_values)
          OR a.new_values IS DISTINCT FROM public.scrub_customer_audit_jsonb(a.new_values));
  GET DIAGNOSTICS v_redacted_count = ROW_COUNT;
  INSERT INTO public.audit_logs (actor_type, user_id, action, entity_type, entity_id, old_values, new_values)
  VALUES (
    'SYSTEM', NULL, 'customers.audit_redact', 'customers', v_task.customer_id, NULL,
    pg_catalog.jsonb_build_object(
      'redactionTaskId', v_task.id, 'anonymizeAuditId', v_task.anonymize_audit_id, 'redactedRows', v_redacted_count
    )
  )
  RETURNING id INTO v_completion_audit_id;
  UPDATE public.customer_audit_redaction_tasks AS t
     SET status = 'COMPLETED', attempt_count = v_task.attempt_count + 1,
         redacted_audit_rows = v_redacted_count, completion_audit_id = v_completion_audit_id,
         last_error_code = NULL, updated_at = pg_catalog.clock_timestamp(),
         completed_at = pg_catalog.clock_timestamp()
   WHERE t.id = v_task.id;
  RETURN pg_catalog.jsonb_build_object(
    'taskId', v_task.id, 'customerId', v_task.customer_id, 'status', 'COMPLETED',
    'alreadyCompleted', false, 'redactedRows', v_redacted_count, 'completionAuditId', v_completion_audit_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.redact_customer_audit_pii(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redact_customer_audit_pii(uuid) TO hyper_privacy_worker;

CREATE OR REPLACE FUNCTION public.record_customer_audit_redaction_failure(p_task_id uuid, p_error_code text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_code text := COALESCE(p_error_code, 'WORKER_EXECUTION_ERROR');
BEGIN
  IF SESSION_USER <> 'hyper_privacy_worker' THEN
    RAISE EXCEPTION 'Unauthorized session_user %', SESSION_USER USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (v_code OPERATOR(pg_catalog.~) '^[A-Z0-9_]{1,80}$') THEN
    v_code := 'WORKER_EXECUTION_ERROR';
  END IF;
  UPDATE public.customer_audit_redaction_tasks AS t
     SET status = 'FAILED', attempt_count = t.attempt_count + 1,
         last_error_code = v_code, updated_at = pg_catalog.clock_timestamp()
   WHERE t.id = p_task_id AND t.status IN ('PENDING', 'FAILED');
END;
$function$;

REVOKE ALL ON FUNCTION public.record_customer_audit_redaction_failure(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_customer_audit_redaction_failure(uuid, text) TO hyper_privacy_worker;

CREATE OR REPLACE FUNCTION public.reset_failed_customer_audit_redaction_task(p_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_task public.customer_audit_redaction_tasks%ROWTYPE;
BEGIN
  IF SESSION_USER <> 'hyper_privacy_worker' THEN
    RAISE EXCEPTION 'Unauthorized session_user %', SESSION_USER USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_task FROM public.customer_audit_redaction_tasks AS t WHERE t.id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Redaction task % not found', p_task_id USING ERRCODE = 'no_data_found';
  END IF;
  IF v_task.status = 'COMPLETED' THEN
    RETURN pg_catalog.jsonb_build_object('taskId', v_task.id, 'status', 'COMPLETED', 'alreadyCompleted', true);
  END IF;
  IF v_task.status = 'FAILED' THEN
    UPDATE public.customer_audit_redaction_tasks AS t
       SET status = 'PENDING', attempt_count = 0, last_error_code = NULL, updated_at = pg_catalog.clock_timestamp()
     WHERE t.id = v_task.id;
  END IF;
  RETURN pg_catalog.jsonb_build_object('taskId', v_task.id, 'status', 'PENDING', 'recovered', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.reset_failed_customer_audit_redaction_task(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reset_failed_customer_audit_redaction_task(uuid) TO hyper_privacy_worker;

RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM hyper_audit_redactor;

COMMIT;
