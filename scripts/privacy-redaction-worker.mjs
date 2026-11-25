#!/usr/bin/env node
// ============================================================================
// P12-08 D01 — Dedicated Least-Privilege Privacy Redaction Worker (Design H2)
// ============================================================================
// STATUS: Source-integrated, DEFAULT-INACTIVE. Never auto-started by Next.js,
// `package.json` build/start/postinstall hooks, or module import.
//
// Connects exclusively as the dedicated worker role (`PRIVACY_WORKER_DATABASE_URL`) —
// NEVER `hyper_app` (`DATABASE_URL`) and NEVER a superuser or table owner.
// Do NOT add `PRIVACY_WORKER_DATABASE_URL` to the Next.js Storefront/API runtime.
//
// Supported CLI Modes (when explicitly invoked in an isolated worker runtime):
//   node scripts/privacy-redaction-worker.mjs --once [--max-tasks 25] [--max-attempts 5]
//   node scripts/privacy-redaction-worker.mjs --daemon [--poll-ms 1500] [--max-attempts 5]
//   node scripts/privacy-redaction-worker.mjs --health [--max-pending-age-sec 300]
//   node scripts/privacy-redaction-worker.mjs --recover-task <task-uuid>
//
// Security & Logging Guarantees:
//   - Zero PII, passwords, connection strings, or raw SQL error details logged.
//   - Graceful SIGINT/SIGTERM handling: stops claiming new work, finishes or
//     rolls back any in-flight transaction cleanly, and NEVER marks an
//     interrupted task `COMPLETED`.
// ============================================================================

import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, Client } from "pg";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_CODE_RE = /^[A-Z0-9_]{1,80}$/;

export function parseWorkerArgs(argv) {
  const flags = new Set();
  const values = new Map();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        values.set(key, next);
        i += 1;
      } else {
        flags.add(key);
      }
    }
  }
  return { flags, values };
}

export function sanitizeWorkerLogFields(event, fields = {}) {
  const safe = { ts: new Date().toISOString(), service: "privacy-redaction-worker", event };
  for (const [k, v] of Object.entries(fields)) {
    if (/password|secret|token|url|email|phone|name/i.test(k)) continue;
    safe[k] = v;
  }
  return safe;
}

function logWorkerEvent(event, fields = {}) {
  process.stdout.write(JSON.stringify(sanitizeWorkerLogFields(event, fields)) + "\n");
}

export function normalizeWorkerErrorCode(err) {
  if (err && typeof err === "object") {
    if (typeof err.workerCode === "string" && SAFE_CODE_RE.test(err.workerCode)) {
      return err.workerCode;
    }
    if (typeof err.code === "string" && /^[A-Z0-9]{5}$/i.test(err.code)) {
      return `PG_${err.code.toUpperCase()}`;
    }
  }
  return "WORKER_EXECUTION_ERROR";
}

export async function verifyWorkerConnectionSafety(pool, env = process.env) {
  const r = await pool.query(`
    SELECT CURRENT_USER AS current_user,
           SESSION_USER AS session_user,
           pg_catalog.current_database() AS database,
           (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = CURRENT_USER) AS is_super,
           pg_catalog.has_table_privilege(CURRENT_USER, 'public.audit_logs', 'SELECT') AS can_read_audit,
           pg_catalog.has_table_privilege(CURRENT_USER, 'public.customers', 'SELECT') AS can_read_customers,
           pg_catalog.has_function_privilege(
             CURRENT_USER,
             'public.redact_customer_audit_pii(uuid)'::pg_catalog.regprocedure,
             'EXECUTE'
           ) AS can_exec_redact
  `);
  const row = r.rows[0];
  if (!row || row.is_super) {
    throw Object.assign(new Error("Worker refused: superuser role is forbidden."), {
      workerCode: "FORBIDDEN_SUPERUSER_ROLE",
    });
  }
  if (row.database === "hyper_almoatasem" && env.ALLOW_PRODUCTION_PRIVACY_WORKER !== "1") {
    throw Object.assign(new Error("Worker refused: production DB not authorized."), {
      workerCode: "PRODUCTION_DB_NOT_AUTHORIZED",
    });
  }
  if (row.can_read_audit || row.can_read_customers) {
    throw Object.assign(new Error("Worker refused: role holds excess table SELECT privileges."), {
      workerCode: "EXCESS_WORKER_PRIVILEGES",
    });
  }
  if (!row.can_exec_redact) {
    throw Object.assign(new Error("Worker refused: role lacks EXECUTE on redact_customer_audit_pii."), {
      workerCode: "MISSING_REDACT_EXECUTE_PRIVILEGE",
    });
  }
  return {
    role: row.current_user,
    database: row.database,
  };
}

let faultInjectedOnce = false;

async function processSingleTask(pool, taskId, options = {}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query("SET LOCAL statement_timeout = '5s'");

    const res = await client.query(`SELECT public.redact_customer_audit_pii($1::uuid) AS outcome`, [
      taskId,
    ]);

    if (
      options.allowFaultInjection &&
      !faultInjectedOnce &&
      process.env.PRIVACY_WORKER_SIMULATE_FAULT === "ALWAYS"
    ) {
      throw Object.assign(new Error("Simulated persistent worker fault"), {
        workerCode: "SIMULATED_WORKER_CRASH",
      });
    }
    if (
      options.allowFaultInjection &&
      !faultInjectedOnce &&
      process.env.PRIVACY_WORKER_SIMULATE_FAULT === "ONCE"
    ) {
      faultInjectedOnce = true;
      throw Object.assign(new Error("Simulated transient worker fault"), {
        workerCode: "SIMULATED_TRANSIENT_CRASH",
      });
    }

    await client.query("COMMIT");
    const outcome = res.rows[0]?.outcome ?? {};
    logWorkerEvent("task.completed", {
      taskId,
      alreadyCompleted: Boolean(outcome.alreadyCompleted),
      redactedRows: Number(outcome.redactedRows ?? 0),
    });
    return { status: "COMPLETED", taskId, redactedRows: Number(outcome.redactedRows ?? 0) };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    const code = normalizeWorkerErrorCode(err);
    try {
      await client.query(`SELECT public.record_customer_audit_redaction_failure($1::uuid, $2::text)`, [
        taskId,
        code,
      ]);
    } catch {
      // Never leak raw error strings
    }
    logWorkerEvent("task.failed", { taskId, errorCode: code });
    return { status: "FAILED", taskId, errorCode: code };
  } finally {
    client.release();
  }
}

async function runSweep(
  pool,
  { maxTasks = 25, maxAttempts = 5, shouldStop = () => false, allowFaultInjection = false },
) {
  const pending = await pool.query(
    `SELECT id::text AS id, attempt_count
       FROM public.customer_audit_redaction_tasks
      WHERE status = 'PENDING'
         OR (status = 'FAILED' AND attempt_count < $1)
      ORDER BY created_at ASC
      LIMIT $2`,
    [maxAttempts, maxTasks],
  );

  let completed = 0;
  let failed = 0;
  for (const row of pending.rows) {
    if (shouldStop()) {
      logWorkerEvent("sweep.interrupted_gracefully", { completed, failed });
      break;
    }
    const r = await processSingleTask(pool, row.id, { allowFaultInjection });
    if (r.status === "COMPLETED") completed += 1;
    else failed += 1;
  }
  return { scanned: pending.rows.length, completed, failed };
}

async function runHealthCheck(pool, maxPendingAgeSec) {
  const res = await pool.query(`
    SELECT count(*) FILTER (WHERE status = 'PENDING')::int AS pending_count,
           count(*) FILTER (WHERE status = 'FAILED')::int AS failed_count,
           count(*) FILTER (WHERE status = 'COMPLETED')::int AS completed_count,
           COALESCE(
             EXTRACT(EPOCH FROM (pg_catalog.clock_timestamp() - min(created_at) FILTER (WHERE status = 'PENDING')))::int,
             0
           ) AS oldest_pending_age_sec
      FROM public.customer_audit_redaction_tasks
  `);
  const m = res.rows[0];
  const healthy = m.failed_count === 0 && m.oldest_pending_age_sec <= maxPendingAgeSec;
  logWorkerEvent(healthy ? "health.ok" : "health.alert", {
    healthy,
    pendingCount: m.pending_count,
    failedCount: m.failed_count,
    completedCount: m.completed_count,
    oldestPendingAgeSec: m.oldest_pending_age_sec,
    maxPendingAgeSec,
  });
  return healthy ? 0 : 1;
}

async function runRecoverTask(pool, taskId) {
  if (!UUID_RE.test(taskId)) {
    logWorkerEvent("recover.invalid_task_id");
    return 1;
  }
  const resetRes = await pool.query(
    `SELECT public.reset_failed_customer_audit_redaction_task($1::uuid) AS outcome`,
    [taskId],
  );
  const resetOutcome = resetRes.rows[0]?.outcome ?? {};
  logWorkerEvent("recover.reset", {
    taskId,
    status: resetOutcome.status ?? "UNKNOWN",
    recovered: Boolean(resetOutcome.recovered),
  });
  if (resetOutcome.alreadyCompleted) {
    return 0;
  }
  const execRes = await processSingleTask(pool, taskId, { allowFaultInjection: false });
  return execRes.status === "COMPLETED" ? 0 : 2;
}

export async function runPrivacyWorkerCli(argv = process.argv.slice(2), env = process.env) {
  const { flags, values } = parseWorkerArgs(argv);
  const workerUrl = env.PRIVACY_WORKER_DATABASE_URL || "";
  if (!workerUrl.trim()) {
    logWorkerEvent("startup.refused", { errorCode: "MISSING_PRIVACY_WORKER_DATABASE_URL" });
    return 1;
  }
  if (env.DATABASE_URL && workerUrl.trim() === env.DATABASE_URL.trim()) {
    logWorkerEvent("startup.refused", { errorCode: "WORKER_URL_MUST_DIFFER_FROM_APP_URL" });
    return 1;
  }

  const maxTasks = Math.max(1, Math.min(100, Number.parseInt(values.get("max-tasks") ?? "25", 10) || 25));
  const maxAttempts = Math.max(1, Math.min(20, Number.parseInt(values.get("max-attempts") ?? "5", 10) || 5));
  const pollMs = Math.max(100, Math.min(60_000, Number.parseInt(values.get("poll-ms") ?? "1500", 10) || 1500));
  const maxPendingAgeSec = Math.max(
    10,
    Number.parseInt(values.get("max-pending-age-sec") ?? "300", 10) || 300,
  );
  const allowFaultInjection = env.ALLOW_WORKER_FAULT_INJECTION === "1";

  const pool = new Pool({ connectionString: workerUrl, max: 4 });
  let listenerClient = null;
  let shuttingDown = false;

  try {
    const identity = await verifyWorkerConnectionSafety(pool, env);
    logWorkerEvent("worker.verified", { role: identity.role, database: identity.database });

    if (flags.has("health")) {
      const code = await runHealthCheck(pool, maxPendingAgeSec);
      await pool.end();
      return code;
    }

    if (values.has("recover-task")) {
      const code = await runRecoverTask(pool, values.get("recover-task"));
      await pool.end();
      return code;
    }

    if (flags.has("once") || !flags.has("daemon")) {
      const summary = await runSweep(pool, {
        maxTasks,
        maxAttempts,
        shouldStop: () => shuttingDown,
        allowFaultInjection,
      });
      logWorkerEvent("sweep.summary", summary);
      await pool.end();
      return summary.failed > 0 ? 2 : 0;
    }

    let wakeResolve = null;
    const triggerWake = () => {
      if (wakeResolve) {
        const fn = wakeResolve;
        wakeResolve = null;
        fn();
      }
    };

    const requestShutdown = (signal) => {
      if (shuttingDown) return;
      shuttingDown = true;
      logWorkerEvent("worker.shutdown_requested", { signal });
      triggerWake();
    };
    process.on("SIGINT", () => requestShutdown("SIGINT"));
    process.on("SIGTERM", () => requestShutdown("SIGTERM"));

    listenerClient = new Client({ connectionString: workerUrl });
    await listenerClient.connect();
    listenerClient.on("notification", () => triggerWake());
    listenerClient.on("error", () => triggerWake());
    await listenerClient.query("LISTEN customer_audit_redaction_ready");
    logWorkerEvent("worker.daemon_ready", { pollMs, maxAttempts });

    while (!shuttingDown) {
      await runSweep(pool, {
        maxTasks,
        maxAttempts,
        shouldStop: () => shuttingDown,
        allowFaultInjection,
      });
      if (shuttingDown) break;
      await new Promise((resolve) => {
        wakeResolve = resolve;
        setTimeout(() => {
          if (wakeResolve === resolve) wakeResolve = null;
          resolve();
        }, pollMs);
      });
    }

    logWorkerEvent("worker.daemon_stopped");
    await listenerClient.end().catch(() => {});
    await pool.end();
    return 0;
  } catch (err) {
    logWorkerEvent("worker.fatal", { errorCode: normalizeWorkerErrorCode(err) });
    if (listenerClient) await listenerClient.end().catch(() => {});
    await pool.end().catch(() => {});
    return 1;
  }
}

const isDirectExecution =
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  const exitCode = await runPrivacyWorkerCli();
  process.exit(exitCode);
}
