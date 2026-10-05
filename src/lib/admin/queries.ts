// BA-9 admin read domain.
//
// Prisma owns representable reads (users/roles/permissions/settings with
// grant graphs). Raw SQL owns audit reads ONLY (the AuditLog model is
// query-poisoned by Unsupported("inet") — proven gaps-doc finding):
// SELECTs cast ip_address to text and never return secrets (none stored).
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { AuditRow } from "@/lib/admin/serialize";

const roleNames = {
  include: { userRoles: { include: { role: { select: { name: true } } } } },
};

export interface UserListFilter {
  limit: number;
  cursor: string | null;
  search: string | null;
  active: boolean | null;
}

export async function listUsers(filter: UserListFilter) {
  const rows = await prisma.user.findMany({
    where: {
      ...(filter.cursor ? { id: { gt: filter.cursor } } : {}),
      ...(filter.search
        ? {
            OR: [
              { email: { contains: filter.search, mode: "insensitive" as const } },
              { name: { contains: filter.search, mode: "insensitive" as const } },
              { phone: { contains: filter.search } },
            ],
          }
        : {}),
      ...(filter.active === null || filter.active === undefined ? {} : { isActive: filter.active }),
    },
    ...roleNames,
    orderBy: [{ id: "asc" as const }],
    take: filter.limit + 1,
  });
  return rows;
}

export function getUser(id: string) {
  return prisma.user.findUnique({ where: { id }, ...roleNames });
}

export interface RoleListFilter {
  limit: number;
  cursor: string | null;
  search: string | null;
  active: boolean | null;
}

export async function listRoles(filter: RoleListFilter) {
  const rows = await prisma.role.findMany({
    where: {
      ...(filter.cursor ? { id: { gt: filter.cursor } } : {}),
      ...(filter.search ? { name: { contains: filter.search, mode: "insensitive" as const } } : {}),
      ...(filter.active === null || filter.active === undefined ? {} : { isActive: filter.active }),
    },
    orderBy: [{ id: "asc" as const }],
    take: filter.limit + 1,
  });
  return rows;
}

export function getRole(id: string) {
  return prisma.role.findUnique({
    where: { id },
    include: {
      rolePermissions: { include: { permission: { select: { key: true } } } },
      _count: { select: { userRoles: true } },
    },
  });
}

export interface RoleMembersFilter {
  limit: number;
  cursor: string | null;
}

/** Users holding a role (read-only observability; delete constraint surfaces as 409). */
export async function listRoleMembers(roleId: string, filter: RoleMembersFilter) {
  const rows = await prisma.userRole.findMany({
    where: {
      roleId,
      ...(filter.cursor ? { id: { gt: filter.cursor } } : {}),
    },
    include: {
      user: {
        include: { userRoles: { include: { role: { select: { name: true } } } } },
      },
    },
    orderBy: [{ id: "asc" as const }],
    take: filter.limit + 1,
  });
  return rows;
}

export async function listPermissions(filter: { limit: number; cursor: string | null; search: string | null }) {
  const rows = await prisma.permission.findMany({
    where: {
      ...(filter.cursor ? { id: { gt: filter.cursor } } : {}),
      ...(filter.search ? { key: { contains: filter.search, mode: "insensitive" as const } } : {}),
    },
    orderBy: [{ id: "asc" as const }],
    take: filter.limit + 1,
  });
  return rows;
}

export function getPermission(id: string) {
  return prisma.permission.findUnique({ where: { id } });
}

export function listSettings() {
  return prisma.storeSetting.findMany({ orderBy: [{ key: "asc" as const }] });
}

export function getSetting(key: string) {
  return prisma.storeSetting.findUnique({ where: { key } });
}

export interface AuditListFilter {
  limit: number;
  cursor: string | null;
  userId: string | null;
  action: string | null;
  entityType: string | null;
  entityId: string | null;
  since: string | null;
  until: string | null;
}

/**
 * Audit feed, newest first. Ordering is (created_at DESC, id DESC): audit
 * row ids are DB-default random UUIDv4 (auditInTx supplies no id), so id
 * order is NOT time order and `ORDER BY id DESC` returned an arbitrary feed
 * (pagination could skip/duplicate rows). The uuid cursor wire contract is
 * preserved — the cursor position resolves through its row's created_at.
 * Served by idx_audit_time / idx_audit_action_time / idx_audit_user_time.
 */
export async function listAudit(filter: AuditListFilter): Promise<AuditRow[]> {
  const conds: Prisma.Sql[] = [];
  if (filter.cursor)
    conds.push(
      Prisma.sql`(created_at, id) < ((SELECT created_at FROM audit_logs WHERE id = ${filter.cursor}::uuid), ${filter.cursor}::uuid)`,
    );
  if (filter.userId) conds.push(Prisma.sql`user_id = ${filter.userId}::uuid`);
  if (filter.action) conds.push(Prisma.sql`action = ${filter.action}`);
  if (filter.entityType) conds.push(Prisma.sql`entity_type = ${filter.entityType}`);
  if (filter.entityId) conds.push(Prisma.sql`entity_id = ${filter.entityId}::uuid`);
  if (filter.since) conds.push(Prisma.sql`created_at >= ${filter.since}::timestamptz`);
  if (filter.until) conds.push(Prisma.sql`created_at <= ${filter.until}::timestamptz`);
  const where = conds.length === 0 ? Prisma.empty : Prisma.sql`WHERE ${Prisma.join(conds, " AND ")}`;
  return prisma.$queryRaw<AuditRow[]>`
    SELECT id::text AS id, user_id::text AS user_id, actor_type, action,
      entity_type, entity_id::text AS entity_id, old_values, new_values,
      ip_address::text AS ip_address, user_agent, created_at
      FROM audit_logs ${where}
     ORDER BY created_at DESC, id DESC LIMIT ${filter.limit + 1}`;
}

export async function getAudit(id: string): Promise<AuditRow | null> {
  const rows = await prisma.$queryRaw<AuditRow[]>`
    SELECT id::text AS id, user_id::text AS user_id, actor_type, action,
      entity_type, entity_id::text AS entity_id, old_values, new_values,
      ip_address::text AS ip_address, user_agent, created_at
      FROM audit_logs WHERE id = ${id}::uuid`;
  return rows[0] ?? null;
}
