import "server-only";
// Auth audit writer (raw SQL layer).
// audit_logs.ip_address is PostgreSQL `inet`, which @prisma/client 7.10 maps
// as Unsupported — the whole AuditLog model is query-poisoned through Prisma
// (proven finding, docs/prisma-sql-gaps.md). ALL audit writes therefore go
// through this module via parameterized raw SQL. Reads (rare, admin-only)
// must use raw SQL as well, never prisma.auditLog.
// Never logs: passwords, hashes, session/invitation/reset tokens, secrets.
import { prisma } from "@/lib/db";

export type AuditActor = "ADMIN" | "SYSTEM";

export interface AuthAuditEvent {
  action: string; // must match ^[a-z0-9_]+\.[a-z0-9_]+$ (DB CHECK)
  userId?: string | null; // ADMIN requires non-null; SYSTEM requires null
  entityType: string; // e.g. 'users' (no FK by frozen design)
  entityId?: string | null;
  values?: Record<string, unknown> | null; // sanitized only
  ip?: string | null; // stored as inet (nullable)
  userAgent?: string | null;
}

export async function writeAuthAudit(event: AuthAuditEvent): Promise<void> {
  const actor: AuditActor = event.userId ? "ADMIN" : "SYSTEM";
  await prisma.$executeRaw`
    INSERT INTO audit_logs (user_id, actor_type, action, entity_type, entity_id, new_values, ip_address, user_agent)
    VALUES (
      ${event.userId ?? null}::uuid,
      ${actor}::text,
      ${event.action}::text,
      ${event.entityType}::text,
      ${event.entityId ?? null}::uuid,
      ${event.values ? JSON.stringify(event.values) : null}::jsonb,
      ${event.ip ?? null}::inet,
      ${event.userAgent ?? null}::text
    )
  `;
}
