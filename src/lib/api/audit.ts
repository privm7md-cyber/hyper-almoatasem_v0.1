// Shared tx-bound audit INSERT (PRE-BA-11 hardening).
//
// Single canonical shape for pairing an admin business mutation with its
// audit_logs row in the SAME database transaction (frozen Phase 5 §4
// pattern): the caller owns the transaction; this helper only appends the
// audit INSERT before COMMIT, so a business failure rolls back with no
// audit row and an audit failure rolls back the business mutation.
// Payloads are caller-supplied sanitized allowlists (never hashes, tokens,
// secrets, or credentials). Action must satisfy the frozen
// chk_audit_action CHECK (`^[a-z0-9_]+\.[a-z0-9_]+$`); ADMIN actor rows
// require a non-null user id (chk_audit_actor_pair).
//
// Phase-10 remediation (G06): the request context (client IP + User-Agent)
// is resolved HERE, centrally, so all ~57 audited write sites record it
// without every domain service having to thread it through its signature.
// The IP is only present when a trusted reverse proxy is declared
// (`TRUSTED_PROXY=1`); otherwise it stays NULL rather than recording an
// unproven client-supplied header. The User-Agent is always recorded when
// present. No cookie, authorization header, session token or guest token is
// ever read here.
import "server-only";
import { Prisma } from "@prisma/client";
import { resolveRequestContext } from "@/lib/api/request-context";
import { sanitizeLogFields } from "@/lib/api/log";
import { normalizeAuditReason } from "@/lib/api/correlation";

export interface AuditEvent {
  action: string;
  userId: string;
  entityType: string;
  entityId: string | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  /**
   * Optional operation reason (BL-01). Recorded INSIDE new_values — the
   * frozen audit_logs table is never widened (doc 14 BL-01: correlation
   * id and reason travel "into the payload").
   */
  reason?: string | null;
}

/**
 * The audit trail is the app's log store, so the central sanitizer runs here
 * rather than trusting every call site to pre-sanitize. A payload that cannot
 * be sanitized is dropped rather than stored unsanitized: losing the detail
 * is recoverable, persisting a secret is not.
 */
function auditPayload(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null;
  try {
    return JSON.stringify(sanitizeLogFields(payload));
  } catch {
    return null;
  }
}

/**
 * new_values payload: the sanitized caller payload with the request metadata
 * (correlation_id / reason) attached when present. With no metadata and a
 * null payload the column stays NULL exactly as before — existing payloads
 * are byte-identical (the metadata keys appear ONLY when genuinely present).
 */
function auditNewPayload(
  payload: Record<string, unknown> | null,
  meta: Record<string, unknown> | null,
): string | null {
  const hasMeta = meta !== null && Object.keys(meta).length > 0;
  if (payload === null && !hasMeta) return null;
  const base = payload === null ? {} : sanitizeLogFields(payload);
  const merged = hasMeta ? { ...base, ...(meta as Record<string, unknown>) } : base;
  try {
    return JSON.stringify(merged);
  } catch {
    return null;
  }
}

/**
 * Serialize one cell for an audit payload: exact, JSON-safe. Prisma Decimal
 * serializes through its exact toString(); Dates to ISO; null stays null.
 */
export function serializeAuditValue(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return String(v);
  return v;
}

/**
 * BL-01 (doc 11 P2): true before/after for exactly the fields a write
 * touches — old values from the prior row, new values from the updated row,
 * same key set, so the pair is directly diffable.
 */
export function auditFieldDiff(
  prior: Record<string, unknown>,
  updated: Record<string, unknown>,
  keys: readonly string[],
): { oldValues: Record<string, unknown>; newValues: Record<string, unknown> } {
  const oldValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};
  for (const k of keys) {
    oldValues[k] = serializeAuditValue(prior[k]);
    newValues[k] = serializeAuditValue(updated[k]);
  }
  return { oldValues, newValues };
}

/** Tx-bound audit INSERT (audit.ts shape; that helper is not tx-bound). */
export async function auditInTx(tx: Prisma.TransactionClient, event: AuditEvent): Promise<void> {
  const ctx = await resolveRequestContext();
  const meta: Record<string, unknown> = {};
  if (ctx.correlationId) meta.correlation_id = ctx.correlationId;
  const reason = normalizeAuditReason(event.reason);
  if (reason) meta.reason = reason;
  await tx.$executeRaw`
    INSERT INTO audit_logs (user_id, actor_type, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent)
    VALUES (${event.userId}::uuid, 'ADMIN', ${event.action}::text, ${event.entityType}::text,
      ${event.entityId}::uuid,
      ${auditPayload(event.oldValues)}::jsonb,
      ${auditNewPayload(event.newValues, Object.keys(meta).length > 0 ? meta : null)}::jsonb,
      ${ctx.ip ?? null}::inet,
      ${ctx.userAgent ?? null}::text)`;
}
