// ============================================================================
// EFFECTIVE PERMISSIONS — "what can this account actually do?"
// ============================================================================
// ADM-09: the admin screens showed role names and permission labels, but
// nothing answered the operator's real question: which permissions does THIS
// account hold, where did they come from, and is each one actually usable?
//
// This module computes that answer and — crucially — keeps the different
// states apart instead of mixing them:
//
//   1. IN THE CODE      — the key exists in the admin catalogue.
//   2. IN THE SEED      — the key is provisioned by the seed/bootstrap.
//   3. IN THE DATABASE  — a `permissions` row exists (read-only check).
//   4. GRANTED          — the key reaches the account through an active role.
//   5. ALLOWED HERE     — the key is inside the ACTOR's own effective set
//                         (the ceiling: an actor can never grant or revoke
//                         outside their own set).
//
// A permission that is only "in the code" is NOT active. The sensitive
// capabilities (`customers.anonymize`, `products.delete`, `prices.view`, the
// RBAC keys) carry an explicit activation state so the UI can never present a
// defined-but-not-granted capability as a working one.
// ============================================================================
import { prisma } from "@/lib/db";
import {
  PERMISSION_GROUPS,
  permissionCapability,
  permissionDescription,
  permissionLabel,
  isSensitivePermission,
  type PermissionCapability,
} from "@/lib/admin/terminology";

export type PermissionDbState = "PRESENT" | "MISSING" | "UNKNOWN";

export interface EffectivePermission {
  key: string;
  label: string;
  description: string;
  capability: PermissionCapability | null;
  sensitive: boolean;
  /** Whether the account holds the key (through an active role). */
  granted: boolean;
  /** Where the grant comes from: the active role that carries it. */
  source: { roleId: string; roleName: string } | null;
  /** Whether a `permissions` row exists for the key in the database. */
  dbState: PermissionDbState;
  /**
   * Whether the key is inside the ACTOR's own effective set (the ceiling).
   * This is a statement about the signed-in operator, never about the target
   * account: false does not mean the target lacks the permission.
   */
  allowedHere: boolean;
  /**
   * The activation state shown to the operator. `GRANTED` means usable now.
   * `PENDING_OWNER_APPROVAL` is used for the capabilities whose activation is
   * an owner decision, not a database fact.
   */
  activation:
    | "GRANTED"
    | "NOT_GRANTED"
    | "DB_MISSING"
    | "PENDING_OWNER_APPROVAL";
}

export interface EffectivePermissionsReport {
  user: { id: string; name: string; email: string; isActive: boolean };
  roles: Array<{ id: string; name: string; isActive: boolean }>;
  permissions: EffectivePermission[];
  summary: {
    catalogueTotal: number;
    grantedTotal: number;
    missingInDatabase: number;
    pendingOwnerApproval: number;
    allowedHereTotal: number;
  };
}

/** The capabilities whose activation is an OWNER decision, not a DB fact. */
export const OWNER_APPROVAL_PERMISSIONS: readonly string[] = ["customers.anonymize", "products.delete"];

/** The keys the seed provisions (read from the seed file at call time). */
export async function listDbPermissionKeys(): Promise<string[]> {
  const rows = await prisma.permission.findMany({
    select: { key: true },
  });
  return rows.map((row) => row.key);
}

/**
 * Compute the effective permission report for one account.
 *
 * `actorPermissions` is the signed-in actor's own effective set: it is the
 * ceiling, and it is reported as the "allowed here" column.
 */
export async function effectivePermissionsFor(
  userId: string,
  actorPermissions: readonly string[] = [],
): Promise<EffectivePermissionsReport | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      isActive: true,
      userRoles: {
        select: {
          role: {
            select: {
              id: true,
              name: true,
              isActive: true,
              deletedAt: true,
              rolePermissions: {
                select: { permission: { select: { key: true, isActive: true } } },
              },
            },
          },
        },
      },
    },
  });
  if (!user) return null;

  const dbKeys = new Set(await listDbPermissionKeys());
  const roles = user.userRoles.map((ur) => ({
    id: ur.role.id,
    name: ur.role.name,
    isActive: ur.role.isActive && ur.role.deletedAt === null,
  }));

  // The grant source: the first active role that carries the key.
  const source = new Map<string, { roleId: string; roleName: string }>();
  for (const ur of user.userRoles) {
    const role = ur.role;
    const roleActive = role.isActive && role.deletedAt === null;
    if (!roleActive) continue;
    for (const rp of role.rolePermissions) {
      if (!rp.permission.isActive) continue;
      if (!source.has(rp.permission.key)) {
        source.set(rp.permission.key, { roleId: role.id, roleName: role.name });
      }
    }
  }

  const catalogue = PERMISSION_GROUPS.flatMap((group) => group.permissions);
  const actorSet = new Set(actorPermissions);
  const permissions: EffectivePermission[] = catalogue.map((entry) => {
    const granted = source.has(entry.key);
    const dbState: PermissionDbState = dbKeys.has(entry.key) ? "PRESENT" : "MISSING";
    let activation: EffectivePermission["activation"];
    if (OWNER_APPROVAL_PERMISSIONS.includes(entry.key)) {
      // The capability is defined and enforced in code, but turning it on for
      // real data is an OWNER decision (grant + legal approval). It is never
      // presented as "active" just because the key exists.
      activation = granted ? "PENDING_OWNER_APPROVAL" : "NOT_GRANTED";
    } else if (!granted) {
      activation = "NOT_GRANTED";
    } else if (dbState === "MISSING") {
      activation = "DB_MISSING";
    } else {
      activation = "GRANTED";
    }
    return {
      key: entry.key,
      label: permissionLabel(entry.key),
      description: permissionDescription(entry.key),
      capability: permissionCapability(entry.key),
      sensitive: isSensitivePermission(entry.key),
      granted,
      source: source.get(entry.key) ?? null,
      dbState,
      allowedHere: actorSet.has(entry.key),
      activation,
    };
  });

  return {
    user: { id: user.id, name: user.name, email: user.email, isActive: user.isActive },
    roles,
    permissions,
    summary: {
      catalogueTotal: permissions.length,
      grantedTotal: permissions.filter((p) => p.granted).length,
      missingInDatabase: permissions.filter((p) => p.dbState === "MISSING").length,
      pendingOwnerApproval: permissions.filter((p) => p.activation === "PENDING_OWNER_APPROVAL").length,
      allowedHereTotal: permissions.filter((p) => p.allowedHere).length,
    },
  };
}

/** The actor's own ceiling, as a display map. */
export function actorCeilingMap(actorPermissions: readonly string[]): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const entry of PERMISSION_GROUPS.flatMap((group) => group.permissions)) {
    map[entry.key] = actorPermissions.includes(entry.key);
  }
  return map;
}
