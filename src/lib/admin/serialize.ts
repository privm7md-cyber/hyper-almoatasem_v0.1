// BA-9 admin serialization (boundary shapes).
//
// password_hash, lockout columns, session/token material NEVER cross the
// boundary (omitted by construction — the interfaces below have no such
// fields; suites assert their absence). DateTimes as ISO strings.
import type { Permission, Prisma, Role, StoreSetting, User } from "@prisma/client";
import { iso } from "@/lib/api/serialize";

export interface AdminUserShape {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  roles: string[];
}

type UserRow = User & { userRoles: Array<{ role: Pick<Role, "name"> }> };

export function toAdminUser(u: UserRow): AdminUserShape {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    isActive: u.isActive,
    lastLoginAt: iso(u.lastLoginAt),
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
    roles: u.userRoles.map((ur) => ur.role.name),
  };
}

export interface RoleShape {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  permissions?: string[];
}

type RoleRow = Role & { rolePermissions?: Array<{ permission: Pick<Permission, "key"> }> };

export function toRole(r: RoleRow): RoleShape {
  const shape: RoleShape = {
    id: r.id,
    name: r.name,
    description: r.description,
    isActive: r.isActive,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
  if (r.rolePermissions) shape.permissions = r.rolePermissions.map((rp) => rp.permission.key);
  return shape;
}

export interface PermissionShape {
  id: string;
  key: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
}

export function toPermission(p: Permission): PermissionShape {
  return {
    id: p.id,
    key: p.key,
    description: p.description,
    isActive: p.isActive,
    createdAt: p.createdAt.toISOString(),
  };
}

export interface SettingShape {
  key: string;
  value: string;
  valueType: string;
  description: string | null;
  updatedAt: string;
}

export function toSetting(s: StoreSetting): SettingShape {
  return {
    key: s.key,
    value: s.valueText,
    valueType: s.valueType,
    description: s.description,
    updatedAt: s.updatedAt.toISOString(),
  };
}

export interface AuditShape {
  id: string;
  userId: string | null;
  actorType: string;
  action: string;
  entityType: string;
  entityId: string | null;
  oldValues: Prisma.JsonValue | null;
  newValues: Prisma.JsonValue | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface AuditRow {
  id: string;
  user_id: string | null;
  actor_type: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  old_values: unknown;
  new_values: unknown;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Date;
}

export function toAudit(r: AuditRow): AuditShape {
  return {
    id: r.id,
    userId: r.user_id,
    actorType: r.actor_type,
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    oldValues: (r.old_values ?? null) as Prisma.JsonValue | null,
    newValues: (r.new_values ?? null) as Prisma.JsonValue | null,
    ipAddress: r.ip_address,
    userAgent: r.user_agent,
    createdAt: r.created_at.toISOString(),
  };
}
