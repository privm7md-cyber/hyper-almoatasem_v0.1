# P12-08 `D01` — Dedicated Privacy Redaction Worker (`Design H2`)

> **ACTIVATION STATUS: SOURCE-INTEGRATED, DEFAULT-DISABLED (`INACTIVE`)**
>
> - `CUSTOMER_AUDIT_REDACTION_MODE` is **unset (`!== "H2"`)** by default.
> - No database migration has been applied to `hyper_almoatasem` or `hyper_almoatasem_scratch`.
> - `PRIVACY_WORKER_DATABASE_URL` **must never** be added to the Next.js Storefront/Admin web runtime environment.
> - Activating `H2` requires explicit Owner approval for (1) PostgreSQL role/DDL migration, (2) isolated worker hosting, and (3) production `202 Accepted` API contract adoption.

---

## 1. Security Architecture & Credential Air-Gap

Hardened Design `H2` resolves the conflict between customer privacy erasure (`anonymizeCustomer`) and append-only `audit_logs` tamper protection without granting `UPDATE` or `SECURITY DEFINER` execution privileges to the web application role (`hyper_app`):

1. **Restricted Web Runtime (`hyper_app` / `DATABASE_URL`):**
   - Pseudonymizes operational customer/order records inside `prisma.$transaction`.
   - Holds `SELECT, INSERT` **only** on `public.audit_logs` and `public.customer_audit_redaction_tasks` (`0` `EXECUTE` grants on redaction routines, `0` `UPDATE`/`DELETE`/`TRUNCATE` grants).
   - Enqueues a durable task validated by `trg_redaction_tasks_validate_enqueue` (requiring canonical anonymized `customers` state, `0` open orders, valid `customers.anonymize` ADMIN audit row, live unrevoked `admin_sessions` row, and active `customers.anonymize` RBAC grant).
2. **Isolated Worker Runtime (`hyper_privacy_worker` / `PRIVACY_WORKER_DATABASE_URL`):**
   - Runs in a **strictly separate execution environment** with zero inbound public HTTP routes and zero shared web-project secrets.
   - Holds `SELECT` on `public.customer_audit_redaction_tasks` and `EXECUTE` **only** on:
     - `public.redact_customer_audit_pii(uuid)`
     - `public.record_customer_audit_redaction_failure(uuid, text)`
     - `public.reset_failed_customer_audit_redaction_task(uuid)`
   - Cannot `SELECT` directly from `public.audit_logs`, `public.customers`, or `public.orders`.
3. **Database-Enforced Scrubber (`hyper_audit_redactor` `NOLOGIN` + 6-Gate Trigger):**
   - Column-scoped `UPDATE (old_values, new_values)` on `public.audit_logs` (all `9` forensic envelope columns lack column ACL and are re-verified byte-identical in `trg_audit_logs_guard_update`).
   - Enforces **both** `CURRENT_USER = 'hyper_audit_redactor'` **and** `SESSION_USER = 'hyper_privacy_worker'` plus deterministic 5-key non-PII allowlist scrubbing (`public.scrub_customer_audit_jsonb`).

---

## 2. Environment Variable Matrix (Names Only — Never Commit Secrets)

| Variable Name | Next.js Web Runtime | Isolated Worker Runtime | Purpose |
|---|---|---|---|
| `DATABASE_URL` | **Required** (`hyper_app`) | **Forbidden** | Standard Next.js/Prisma restricted database connection. |
| `CUSTOMER_AUDIT_REDACTION_MODE` | Optional (`"H2"` only after migration; default unset = disabled) | Not used | Explicit activation gate for H2 queue & `202` contract. |
| `PRIVACY_REDACTION_SYNC_WAIT_MS` | Optional (`0` default; `0..5000`) | Not used | Optional bounded poll window when an online daemon is active. |
| `PRIVACY_WORKER_DATABASE_URL` | **FORBIDDEN** | **Required** (`hyper_privacy_worker`, direct TLS `sslmode=verify-full`) | Least-privilege direct PostgreSQL connection for the worker. |
| `ALLOW_PRODUCTION_PRIVACY_WORKER` | Not used | `"1"` (required when targeting `hyper_almoatasem`) | Fail-closed safety gate preventing accidental production execution. |

---

## 3. CLI Operations, Health Monitoring & Safe Recovery

### One-Shot Scheduled Sweep (`--once`)
```bash
node scripts/privacy-redaction-worker.mjs --once --max-tasks 25 --max-attempts 5
```
- Exit `0`: queue drained cleanly (`0` failures).
- Exit `2`: one or more tasks recorded `FAILED` (rolled back cleanly; never marked `COMPLETED`).
- Exit `1`: startup preflight or connection safety check failed closed.

### Continuous Low-Latency Daemon (`--daemon`)
```bash
node scripts/privacy-redaction-worker.mjs --daemon --poll-ms 1500 --max-attempts 5
```
- Subscribes to `LISTEN customer_audit_redaction_ready` over a direct PostgreSQL TLS connection (`non-pooler` endpoint on Neon) with periodic fallback polling.
- Handles `SIGINT` and `SIGTERM` gracefully: stops claiming new work, completes or rolls back any single in-flight transaction (`lock_timeout = '2s'`, `statement_timeout = '5s'`), closes connections, and exits `0`.

### Queue Health & Stale/Failed Alerting (`--health`)
```bash
node scripts/privacy-redaction-worker.mjs --health --max-pending-age-sec 300
```
- Emits structured JSON (`{ healthy, pendingCount, failedCount, completedCount, oldestPendingAgeSec }`) with zero PII.
- Exits `0` when `failedCount === 0` and `oldestPendingAgeSec <= 300`; exits **`1`** when alerting is required.

### Safe Exhausted-Task Recovery (`--recover-task`)
When a task exhausts `--max-attempts` and enters terminal `FAILED` state (`visible` to `customers.anonymize` Admins in `/admin/customers/[id]`):
1. Inspect structured worker logs (`task.failed`, `errorCode`) and resolve the underlying operational issue.
2. Execute targeted recovery from the isolated worker host:
   ```bash
   node scripts/privacy-redaction-worker.mjs --recover-task <task-uuid>
   ```
3. Re-verify queue health (`--health` → exit `0`) and confirm `COMPLETED` status in the Admin UI (`"تحديث حالة التنقية"`).

---

## 4. Proposed SQL Artifacts (Non-Executable Review Files)

- Forward proposal: `db/future/PROPOSED_DO_NOT_EXECUTE_d01_h2_migration.sql`
- Idempotent rollback proposal: `db/future/PROPOSED_DO_NOT_EXECUTE_d01_h2_rollback.sql`

Both files live outside `prisma/migrations/` and carry a top-of-file `RAISE EXCEPTION` safety lock so no automated tool or accidental `psql` invocation can execute them without explicit Owner authorization.
