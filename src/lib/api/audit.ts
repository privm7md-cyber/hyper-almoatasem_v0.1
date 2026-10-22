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

export interface AuditEvent {
  action: string;
  userId: string;
  entityType: string;
  entityId: string | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
}

/** Tx-bound audit INSERT (audit.ts shape; that helper is not tx-bound). */
export async function auditInTx(tx: Prisma.TransactionClient, event: AuditEvent): Promise<void> {
  const ctx = await resolveRequestContext();
  await tx.$executeRaw`
    INSERT INTO audit_logs (user_id, actor_type, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent)
    VALUES (${event.userId}::uuid, 'ADMIN', ${event.action}::text, ${event.entityType}::text,
      ${event.entityId}::uuid,
      ${event.oldValues ? JSON.stringify(event.oldValues) : null}::jsonb,
      ${event.newValues ? JSON.stringify(event.newValues) : null}::jsonb,
      ${ctx.ip ?? null}::inet,
      ${ctx.userAgent ?? null}::text)`;
}
