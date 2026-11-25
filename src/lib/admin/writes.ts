// BA-9 admin write domain (users/roles/grants/settings).
//
// Every mutation below pairs its state change with an audit_logs row in
// the SAME transaction (frozen Phase 5 §4 pattern), using the audit.ts
// row shape via a tx-bound raw INSERT (writeAuthAudit is not tx-bound, so
// it cannot serve atomic mutations — same shape, cited, no second system).
// Payloads are sanitized allowlists (never hashes/tokens/secrets).
// SUPER_ADMIN-row protection (writer discipline, Phase 5 L2): the
// SUPER_ADMIN role can neither be renamed nor deleted (403). PRE-BA-11
// hardening adds: self-deactivation guard (403), last-active-SUPER_ADMIN
// guard on user deactivation / SUPER_ADMIN-mapping removal /
// SUPER_ADMIN-role deactivation (409, concurrency-safe under READ
// COMMITTED via ASC-ordered holder locks), and SUPER_ADMIN grant-revoke
// protection (403). Normal roles keep zero-grant reachability (frozen).
// Effective-permission ceiling: assignments and false->true reactivations
// require the enabled permission set ⊆ the actor's authenticated effective
// snapshot. SUPER_ADMIN membership is an ownership boundary, NOT a wildcard.
// New ownership/graph reads do not lock grant/mapping writers or refresh the
// actor snapshot: they are not a concurrency proof for those graph changes.
// Final-RBAC lock order (READ COMMITTED, acyclic by construction):
//  - holder protocol (patchUser-deactivate, guarded removeRole): locks the
//    active-holder users+user_roles set in ASC user order; NEVER locks
//    roles rows (roles is joined, not FOR UPDATE OF roles);
//  - role-row protocol (patchRole every edit, assignRole): locks EXACTLY
//    ONE roles row per tx, then re-reads state and checks post-lock;
//  - single-row grant/mapping writes take no pre-locks (UQ arbitrates).
// Single-row locks + one ASC multi-row order ⇒ no deadlock cycle.
// Prisma owns representable writes; raw SQL owns the audit INSERT
// (inet-adjacent raw posture), row locks and effective-grant reads.
// IDs are app-generated UUIDv7.
import "server-only";
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError, businessRule, conflict } from "@/lib/api/errors";
import { auditInTx } from "@/lib/api/audit";
import { checkPasswordPolicy, hashPassword } from "@/lib/auth/password";
import { SUPER_ADMIN_ROLE, isSettingValueValid, MONEY_SETTING_KEYS, MONEY_SETTING_TEXT_RE } from "@/lib/admin/policy";
import { settingValueRule } from "@/lib/admin/settings-registry";
import { DELIVERY_PRICING_KEYS } from "@/lib/orders/delivery-pricing";
import { notifyRoleAccessChanged } from "@/lib/admin/notification-events";
import type { UserInput, RoleInput } from "@/lib/admin/validation";

/** RFC 9562 UUIDv7 (frozen app-ID strategy; local copy — previous BA
 * modules are not modified for reuse). */
export function newUuidV7(nowMs: number = Date.now()): string {
  const rand = randomBytes(10);
  const timeHex = nowMs.toString(16).padStart(12, "0");
  const b: number[] = [
    ...[0, 1, 2, 3, 4, 5].map((i) => parseInt(timeHex.slice(i * 2, i * 2 + 2), 16)),
    0x70 | (rand[0] & 0x0f),
    rand[1],
    0x80 | (rand[2] & 0x3f),
    rand[3],
    rand[4],
    rand[5],
    rand[6],
    rand[7],
    rand[8],
    rand[9],
  ];
  const hex = b.map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003";
}

function isNotFound(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";
}

function forbidden(message: string): ApiError {
  return new ApiError("FORBIDDEN", message, null, false);
}

/** Target ownership follows ANY reserved mapping, even an inactive holder or
 * role. Actor ownership follows only the active roles from checkPermission. */
function assertOwnerBoundary(roleNames: readonly string[], actorRoles: readonly string[]): void {
  if (roleNames.includes(SUPER_ADMIN_ROLE) && !actorRoles.includes(SUPER_ADMIN_ROLE)) {
    throw forbidden("Only a SUPER_ADMIN can modify SUPER_ADMIN accounts, roles or mappings.");
  }
}

/** Tx-bound audit INSERT lives in `@/lib/api/audit` (shared with the
 * PRE-BA-11 retrofit — identical SQL, no second system). */

/**
 * Lock every active SUPER_ADMIN holder (user + mapping rows) in ASC user
 * order and return the holder user ids. One statement, deterministic
 * order: concurrent guarded operations serialize on the same rows and the
 * loser re-evaluates after the winner commits (READ COMMITTED — no
 * SERIALIZABLE, no app mutex, no retry loop). Callers MUST invoke this
 * BEFORE any state change in the same tx and reject when the operation
 * would leave zero holders.
 */
async function lockActiveSuperAdminHolders(tx: Prisma.TransactionClient): Promise<string[]> {
  const holders = await tx.$queryRaw<Array<{ uid: string }>>`
    SELECT u.id::text AS uid
      FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      JOIN roles r ON r.id = ur.role_id
     WHERE r.name = ${SUPER_ADMIN_ROLE}
       AND u.is_active AND u.deleted_at IS NULL
       AND r.is_active AND r.deleted_at IS NULL
     ORDER BY u.id ASC
     FOR UPDATE OF u, ur`;
  return holders.map((h) => h.uid);
}

/** Count active SUPER_ADMIN holders visible in this tx (no locks — the
 * caller holds the relevant row lock already). */
async function countActiveSuperAdminHolders(tx: Prisma.TransactionClient): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ n: string }>>`
    SELECT count(*)::text AS n
      FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      JOIN roles r ON r.id = ur.role_id
     WHERE r.name = ${SUPER_ADMIN_ROLE}
       AND u.is_active AND u.deleted_at IS NULL
       AND r.is_active AND r.deleted_at IS NULL`;
  return Number(rows[0]?.n ?? "0");
}

export async function createUser(input: UserInput, actorId: string) {
  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          id: newUuidV7(),
          name: input.name,
          email: input.email,
          phone: input.phone ?? null,
          createdBy: actorId,
        },
        include: { userRoles: { include: { role: { select: { name: true } } } } },
      });
      await auditInTx(tx, {
        action: "users.create",
        userId: actorId,
        entityType: "users",
        entityId: created.id,
        oldValues: null,
        newValues: { name: created.name, email: created.email, phone: created.phone },
      });
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict("User email or phone already exists.", null);
    if (error instanceof ApiError) throw error;
    throw error;
  }
}

export interface UserPatch {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  isActive?: boolean | null;
}

export async function patchUser(
  id: string,
  patch: UserPatch,
  actorId: string,
  actorPermissions: readonly string[] = [],
  actorRoles: readonly string[] = [],
) {
  if (!actorPermissions.includes("users.manage")) throw forbidden("Forbidden.");
  const current = await prisma.user.findUnique({
    where: { id },
    include: { userRoles: { include: { role: { select: { name: true } } } } },
  });
  if (!current) return null;
  assertOwnerBoundary(current.userRoles.map((ur) => ur.role.name), actorRoles);
  const data: Record<string, unknown> = {};
  if (patch.name !== undefined && patch.name !== null) data.name = patch.name;
  if (patch.email !== undefined && patch.email !== null) data.email = patch.email;
  if (patch.phone !== undefined) data.phone = patch.phone;
  if (patch.isActive !== undefined && patch.isActive !== null) data.isActive = patch.isActive;
  if (Object.keys(data).length === 0) return current;
  const deactivating = data.isActive === false;
  // Guard 1 (PRE-BA-11 decision #1): self-deactivation is rejected for the
  // authenticated actor — before any tx, so no state change and no audit.
  if (deactivating && id === actorId) {
    throw forbidden("Administrators cannot deactivate their own account.");
  }
  const oldValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};
  for (const k of ["name", "email", "phone", "isActive"] as const) {
    if (k in data && (current as unknown as Record<string, unknown>)[k] !== data[k]) {
      oldValues[k] = (current as unknown as Record<string, unknown>)[k] ?? null;
      newValues[k] = data[k] ?? null;
    }
  }
  try {
    return await prisma.$transaction(async (tx) => {
      // Guard 2: deactivating the last active SUPER_ADMIN holder is
      // rejected (holder rows locked ASC first — concurrency-safe).
      if (deactivating) {
        const holders = await lockActiveSuperAdminHolders(tx);
        const targetIsHolder = holders.includes(id);
        const survives = holders.some((uid) => uid !== id);
        if (targetIsHolder && !survives) {
          throw conflict("Operation would leave no active SUPER_ADMIN.", null);
        }
      }
      // Re-read without adding locks to the ASC holder protocol. Ownership
      // and activation checks precede every update/audit in this transaction.
      const latest = await tx.user.findUnique({
        where: { id },
        select: { isActive: true, userRoles: { select: { role: { select: { name: true } } } } },
      });
      if (!latest) return null;
      assertOwnerBoundary(latest.userRoles.map((ur) => ur.role.name), actorRoles);
      if (data.isActive === true && !latest.isActive) {
        const grants = await tx.$queryRaw<Array<{ key: string }>>`
          SELECT p.key FROM user_roles ur
            JOIN roles r ON r.id = ur.role_id
            JOIN role_permissions rp ON rp.role_id = r.id
            JOIN permissions p ON p.id = rp.permission_id
           WHERE ur.user_id = ${id}::uuid AND r.is_active AND p.is_active`;
        if (grants.some((g) => !actorPermissions.includes(g.key))) {
          throw forbidden("Cannot activate a user with permissions outside your own effective set.");
        }
      }
      const updated = await tx.user.update({
        where: { id },
        data,
        include: { userRoles: { include: { role: { select: { name: true } } } } },
      });
      await auditInTx(tx, {
        action: "users.update",
        userId: actorId,
        entityType: "users",
        entityId: id,
        oldValues,
        newValues,
      });
      return updated;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict("User email or phone already exists.", null);
    if (isNotFound(error)) return null;
    if (error instanceof ApiError) throw error;
    throw error;
  }
}

/**
 * Provision credentials for an admin user: policy + Argon2id (existing
 * auth infrastructure) + lockout reset + revoke-all sessions + audit, one
 * tx. Mirrors login.ts changePassword plus the audit row (that helper is
 * not tx-audited, so the pairing lives here — hashing/policy delegated).
 */
export async function setUserPassword(
  id: string,
  password: string,
  actorId: string,
  actorPermissions: readonly string[] = [],
  actorRoles: readonly string[] = [],
) {
  if (!actorPermissions.includes("users.manage")) throw forbidden("Forbidden.");
  const current = await prisma.user.findUnique({
    where: { id },
    select: { id: true, userRoles: { select: { role: { select: { name: true } } } } },
  });
  if (!current) return null;
  assertOwnerBoundary(current.userRoles.map((ur) => ur.role.name), actorRoles);
  const policyError = checkPasswordPolicy(password);
  if (policyError) throw businessRule("Password does not meet policy.", null);
  const hash = await hashPassword(password);
  return prisma.$transaction(async (tx) => {
    const latest = await tx.user.findUnique({
      where: { id },
      select: { id: true, userRoles: { select: { role: { select: { name: true } } } } },
    });
    if (!latest) return null;
    assertOwnerBoundary(latest.userRoles.map((ur) => ur.role.name), actorRoles);
    const updated = await tx.user.update({
      where: { id },
      data: { passwordHash: hash, failedLoginAttempts: 0, lockedUntil: null },
      include: { userRoles: { include: { role: { select: { name: true } } } } },
    });
    await tx.$executeRaw`
      UPDATE admin_sessions SET revoked_at = now()
       WHERE user_id = ${id}::uuid AND revoked_at IS NULL`;
    await auditInTx(tx, {
      action: "users.password",
      userId: actorId,
      entityType: "users",
      entityId: id,
      oldValues: null,
      newValues: { credential: "set" },
    });
    return updated;
  });
}

export async function assignRole(
  userId: string,
  roleId: string,
  actorId: string,
  actorPermissions: readonly string[] = [],
  actorRoles: readonly string[] = [],
) {
  if (!actorPermissions.includes("roles.manage")) throw forbidden("Forbidden.");
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, userRoles: { select: { role: { select: { name: true } } } } },
  });
  if (!user) throw new ApiError("NOT_FOUND", "User not found.", null);
  assertOwnerBoundary(user.userRoles.map((ur) => ur.role.name), actorRoles);
  let assignedRoleName = "";
  try {
    const mapping = await prisma.$transaction(async (tx) => {
      // Role-row serialization (final-RBAC Decision A): lock the target
      // roles row FIRST, re-read authoritative state, and run every
      // state-dependent check post-lock. A concurrent role deactivation
      // serializes on this same row: whichever commits first wins, the
      // loser re-evaluates (deactivation-first ⇒ 409 below; assign-first
      // ⇒ the deactivation sees the new holder state). Exactly one
      // roles row per tx — no multi-row order, no deadlock cycle with
      // the ASC holder protocol (which never locks roles rows).
      const locked = await tx.$queryRaw<Array<{ name: string; is_active: boolean }>>`
        SELECT name, is_active FROM roles WHERE id = ${roleId}::uuid FOR UPDATE`;
      if (locked.length === 0) throw new ApiError("NOT_FOUND", "Role not found.", null);
      const row = locked[0];
      assertOwnerBoundary([row.name], actorRoles);
      const latestUser = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, userRoles: { select: { role: { select: { name: true } } } } },
      });
      if (!latestUser) throw new ApiError("NOT_FOUND", "User not found.", null);
      assertOwnerBoundary(latestUser.userRoles.map((ur) => ur.role.name), actorRoles);
      // Post-lock active-state recheck: assigning an inactive role is
      // rejected (it would grant nothing — meaningless and racy).
      if (!row.is_active) {
        throw conflict("Role is not active.", null);
      }
      // Ceiling on re-read grants (same frozen rule as rbac.ts — active
      // grants of active permissions). Zero-grant roles stay assignable.
      const grants = await tx.$queryRaw<Array<{ key: string }>>`
        SELECT p.key FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
         WHERE rp.role_id = ${roleId}::uuid AND p.is_active`;
      const outside = grants.filter((g) => !actorPermissions.includes(g.key));
      if (outside.length > 0) {
        throw forbidden("Cannot assign a role with permissions outside your own effective set.");
      }
      const mapping = await tx.userRole.create({
        data: { id: newUuidV7(), userId, roleId, assignedBy: actorId },
      });
      await auditInTx(tx, {
        action: "users.role_assign",
        userId: actorId,
        entityType: "users",
        entityId: userId,
        oldValues: null,
        newValues: { role: row.name },
      });
      assignedRoleName = row.name;
      return mapping;
    });
    await notifyRoleAccessChanged({
      actorId,
      kind: "mapping.add",
      roleName: assignedRoleName,
      target: user.name,
    }).catch(() => {});
    return mapping;
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict("Role already assigned to user.", null);
    if (isForeignKeyViolation(error)) throw businessRule("Referenced user or role does not exist.", null);
    if (error instanceof ApiError) throw error;
    throw error;
  }
}

export async function removeRole(
  userId: string,
  roleId: string,
  actorId: string,
  actorPermissions: readonly string[] = [],
  actorRoles: readonly string[] = [],
): Promise<boolean> {
  if (!actorPermissions.includes("roles.manage")) throw forbidden("Forbidden.");
  const mapping = await prisma.userRole.findFirst({
    where: { userId, roleId },
    include: {
      role: { select: { name: true } },
      user: { select: {
        name: true, isActive: true, deletedAt: true,
        userRoles: { select: { role: { select: { name: true } } } },
      } },
    },
  });
  if (!mapping) return false;
  assertOwnerBoundary([mapping.role.name, ...mapping.user.userRoles.map((ur) => ur.role.name)], actorRoles);
  // Guard (PRE-BA-11 decision #1): removing the last active holder's
  // SUPER_ADMIN mapping is rejected like a deactivation. This last-holder
  // check does not restrict other mappings or inactive users; the ownership
  // boundary above still applies (zero-grant reachability is preserved).
  const superAdminMapping = mapping.role.name === SUPER_ADMIN_ROLE;
  const userActive = mapping.user.isActive && mapping.user.deletedAt === null;
  await prisma.$transaction(async (tx) => {
    if (superAdminMapping && userActive) {
      const holders = await lockActiveSuperAdminHolders(tx);
      const targetIsHolder = holders.includes(userId);
      const survives = holders.some((uid) => uid !== userId);
      if (targetIsHolder && !survives) {
        throw conflict("Operation would leave no active SUPER_ADMIN.", null);
      }
    }
    const latestUser = await tx.user.findUnique({
      where: { id: userId },
      select: { userRoles: { select: { role: { select: { name: true } } } } },
    });
    if (latestUser) assertOwnerBoundary(latestUser.userRoles.map((ur) => ur.role.name), actorRoles);
    await tx.userRole.delete({ where: { id: mapping.id } });
    await auditInTx(tx, {
      action: "users.role_remove",
      userId: actorId,
      entityType: "users",
      entityId: userId,
      oldValues: { role: mapping.role.name },
      newValues: null,
    });
  });
  await notifyRoleAccessChanged({
    actorId,
    kind: "mapping.remove",
    roleName: mapping.role.name,
    target: mapping.user.name,
  }).catch(() => {});
  return true;
}

export async function createRole(input: RoleInput, actorId: string) {
  try {
    const created = await prisma.$transaction(async (tx) => {
      const role = await tx.role.create({
        data: { id: newUuidV7(), name: input.name, description: input.description ?? null },
      });
      await auditInTx(tx, {
        action: "roles.create",
        userId: actorId,
        entityType: "roles",
        entityId: role.id,
        oldValues: null,
        newValues: { name: role.name },
      });
      return role;
    });
    await notifyRoleAccessChanged({ actorId, kind: "role.create", roleName: created.name }).catch(() => {});
    return created;
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict("Role name already exists.", null);
    if (error instanceof ApiError) throw error;
    throw error;
  }
}

export interface RolePatch {
  name?: string | null;
  description?: string | null;
  isActive?: boolean | null;
}

export async function patchRole(
  id: string,
  patch: RolePatch,
  actorId: string,
  actorPermissions: readonly string[] = [],
  actorRoles: readonly string[] = [],
) {
  if (!actorPermissions.includes("roles.manage")) throw forbidden("Forbidden.");
  const current = await prisma.role.findUnique({ where: { id } });
  if (!current) return null;
  assertOwnerBoundary([current.name, patch.name ?? current.name], actorRoles);
  if (current.name === SUPER_ADMIN_ROLE && patch.name !== undefined && patch.name !== null && patch.name !== current.name) {
    throw forbidden("The SUPER_ADMIN role cannot be renamed.");
  }
  const data: Record<string, unknown> = {};
  if (patch.name !== undefined && patch.name !== null) data.name = patch.name;
  if (patch.description !== undefined) data.description = patch.description;
  if (patch.isActive !== undefined && patch.isActive !== null) data.isActive = patch.isActive;
  if (Object.keys(data).length === 0) return current;
  try {
    const updated = await prisma.$transaction(async (tx) => {
      // Role-row serialization (final-RBAC Decision A): EVERY role edit
      // locks the roles row first and re-reads authoritative state, so
      // assignRole (same row lock) and deactivation serialize
      // transactionally — never an optimistic pre-read. Exactly one
      // roles row per tx: no deadlock cycle.
      const locked = await tx.$queryRaw<Array<{ name: string; is_active: boolean; description: string | null }>>`
        SELECT name, is_active, description FROM roles WHERE id = ${id}::uuid FOR UPDATE`;
      if (locked.length === 0) return null;
      const row = locked[0];
      const nextName = typeof data.name === "string" ? data.name : row.name;
      assertOwnerBoundary([row.name, nextName], actorRoles);
      if (row.name === SUPER_ADMIN_ROLE && nextName !== row.name) {
        throw forbidden("The SUPER_ADMIN role cannot be renamed.");
      }
      if (data.isActive === true && !row.is_active) {
        const grants = await tx.$queryRaw<Array<{ key: string }>>`
          SELECT p.key FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
           WHERE rp.role_id = ${id}::uuid AND p.is_active`;
        if (grants.some((g) => !actorPermissions.includes(g.key))) {
          throw forbidden("Cannot activate a role with permissions outside your own effective set.");
        }
      }
      // Guard (PRE-BA-11 decision #1, evaluated post-lock): the
      // SUPER_ADMIN role cannot be deactivated while any active holder
      // exists — that would leave zero active SUPER_ADMINs.
      if (row.name === SUPER_ADMIN_ROLE && data.isActive === false && row.is_active) {
        const holders = await countActiveSuperAdminHolders(tx);
        if (holders > 0) {
          throw conflict("The SUPER_ADMIN role cannot be deactivated while holders exist.", null);
        }
      }
      const updated = await tx.role.update({ where: { id }, data });
      await auditInTx(tx, {
        action: "roles.update",
        userId: actorId,
        entityType: "roles",
        entityId: id,
        oldValues: { name: row.name, isActive: row.is_active, description: row.description },
        newValues: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
          // ADM-09: the description is part of the role's meaning; a change to
          // it must be visible in the audit trail, not invisible.
          ...(data.description !== undefined ? { description: data.description } : {}),
        },
      });
      return updated;
    });
    if (!updated) return null;
    await notifyRoleAccessChanged({ actorId, kind: "role.update", roleName: updated.name }).catch(() => {});
    return updated;
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict("Role name already exists.", null);
    if (isNotFound(error)) return null;
    if (error instanceof ApiError) throw error;
    throw error;
  }
}

export async function deleteRole(id: string, actorId: string, actorRoles: readonly string[] = []): Promise<boolean> {
  const current = await prisma.role.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!current) return false;
  // ADM-09/ADM-11: deleting is a role mutation, so the ownership boundary
  // applies exactly as it does to rename/deactivate. Without this line a
  // non-owner with `roles.manage` could delete a SUPER_ADMIN role by id.
  assertOwnerBoundary([current.name], actorRoles);
  if (current.name === SUPER_ADMIN_ROLE) {
    throw forbidden("The SUPER_ADMIN role cannot be deleted.");
  }
  try {
    await prisma.$transaction(async (tx) => {
      await tx.role.delete({ where: { id } });
      await auditInTx(tx, {
        action: "roles.delete",
        userId: actorId,
        entityType: "roles",
        entityId: id,
        oldValues: { name: current.name },
        newValues: null,
      });
    });
    await notifyRoleAccessChanged({ actorId, kind: "role.delete", roleName: current.name }).catch(() => {});
    return true;
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      throw conflict("Role is still granted and cannot be deleted.", null);
    }
    if (isNotFound(error)) return false;
    if (error instanceof ApiError) throw error;
    throw error;
  }
}

export async function assignGrant(
  roleId: string,
  permissionId: string,
  actorId: string,
  actorPermissions: string[] = [],
) {
  const [role, permission] = await Promise.all([
    prisma.role.findUnique({ where: { id: roleId }, select: { id: true, name: true } }),
    prisma.permission.findUnique({ where: { id: permissionId }, select: { id: true, key: true } }),
  ]);
  if (!role) throw new ApiError("NOT_FOUND", "Role not found.", null);
  if (!permission) throw new ApiError("NOT_FOUND", "Permission not found.", null);
  // Ceiling (grant-threshold decision): the granted permission must lie
  // within the actor's current effective set (privilege-escalation
  // prevention). Rejected atomically before any tx: no mutation, no
  // audit row, no partial granting.
  if (!actorPermissions.includes(permission.key)) {
    throw forbidden("Cannot grant a permission outside your own effective set.");
  }
  try {
    const grant = await prisma.$transaction(async (tx) => {
      const created = await tx.rolePermission.create({
        data: { id: newUuidV7(), roleId, permissionId, grantedBy: actorId },
      });
      await auditInTx(tx, {
        action: "roles.grant",
        userId: actorId,
        entityType: "roles",
        entityId: roleId,
        oldValues: null,
        newValues: { permission: permission.key },
      });
      return created;
    });
    await notifyRoleAccessChanged({
      actorId,
      kind: "grant.add",
      roleName: role.name,
      target: permission.key,
    }).catch(() => {});
    return grant;
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict("Permission already granted to role.", null);
    if (isForeignKeyViolation(error)) throw businessRule("Referenced role or permission does not exist.", null);
    if (error instanceof ApiError) throw error;
    throw error;
  }
}

export async function removeGrant(
  roleId: string,
  permissionId: string,
  actorId: string,
  actorPermissions: string[] = [],
): Promise<boolean> {
  const grant = await prisma.rolePermission.findFirst({
    where: { roleId, permissionId },
    include: {
      permission: { select: { key: true } },
      role: { select: { name: true } },
    },
  });
  if (!grant) return false;
  // Guard (PRE-BA-11 decision #1): the bootstrap SUPER_ADMIN role holds
  // all 31 permissions explicitly as data (frozen seed — no bypass flag),
  // so every one of its grants is a required administrative grant.
  // Revoking any of them is rejected (403, same as rename/delete).
  // Normal roles are unaffected and keep zero-grant reachability.
  if (grant.role.name === SUPER_ADMIN_ROLE) {
    throw forbidden("The SUPER_ADMIN role grants cannot be revoked.");
  }
  // Ceiling (ADM-09, 13 Nov 2026): revoking is the mirror of granting. An
  // actor may only strip a permission they hold themselves — otherwise a
  // `roles.manage` holder who lacks `prices.view` could still strip
  // `prices.view` from a role, which is a privilege change they were never
  // allowed to make. Rejected before any mutation: no write, no audit row.
  if (!actorPermissions.includes(grant.permission.key)) {
    throw forbidden("Cannot revoke a permission outside your own effective set.");
  }
  await prisma.$transaction(async (tx) => {
    await tx.rolePermission.delete({ where: { id: grant.id } });
    await auditInTx(tx, {
      action: "roles.revoke",
      userId: actorId,
      entityType: "roles",
      entityId: roleId,
      oldValues: { permission: grant.permission.key },
      newValues: null,
    });
  });
  await notifyRoleAccessChanged({
    actorId,
    kind: "grant.remove",
    roleName: grant.role.name,
    target: grant.permission.key,
  }).catch(() => {});
  return true;
}

/** Mirror of the frozen chk_settings_typed branches (DB CHECK enforces). */
export function assertSettingValue(valueType: string, value: string): void {
  if (!isSettingValueValid(valueType, value)) {
    throw businessRule("Setting value does not match its type.", null);
  }
}

/**
 * Money-valued settings use the SAME wire shape as delivery zones and the
 * order/estimate contract: non-negative, at most two decimals, bounded by
 * NUMERIC(10,2). A NUMERIC setting alone would accept "20.000" or "-5", which
 * is not a valid delivery fee.
 */
export async function patchSetting(key: string, value: string, actorId: string) {
  if(key.startsWith("delivery.zone."))throw businessRule("Use delivery-zone management to edit this configuration.");
  const current = await prisma.storeSetting.findUnique({ where: { key } });
  if (!current) {
    // Delivery-pricing settings (owner-approved, 2026-11-19): they are
    // created on first write through the admin screen — the registry is the
    // allow-list, so only registry-editable keys can be created here.
    const rule = settingValueRule(key);
    if (!rule || !DELIVERY_PRICING_KEYS.has(key)) return null;
    if (rule.pattern && !rule.pattern.test(value)) {
      throw businessRule("Setting value is outside the allowed range.", null);
    }
    assertSettingValue(rule.valueType, value);
    return prisma.storeSetting.create({
      data: { key, valueText: value, valueType: rule.valueType, updatedBy: actorId },
    });
  }
  assertSettingValue(current.valueType, value);
  if (MONEY_SETTING_KEYS.has(key) && !MONEY_SETTING_TEXT_RE.test(value)) {
    throw businessRule("Delivery fee must be a non-negative amount with at most two decimals.", null);
  }
  if (current.valueText === value) {
    return current;
  }
  return prisma.$transaction(async (tx) => {
    // Compare-and-set on the exact observed value text: a concurrent editor
    // must not be silently overwritten (and the audit old value must be the
    // value this update actually replaced).
    const updatedCount = await tx.storeSetting.updateMany({
      where: { key, valueText: current.valueText },
      data: { valueText: value, updatedBy: actorId },
    });
    if (updatedCount.count === 0) {
      throw conflict("Setting changed concurrently; reload and retry.", { key });
    }
    await auditInTx(tx, {
      action: "settings.update",
      userId: actorId,
      entityType: "store_settings",
      entityId: current.id,
      oldValues: { key, value: current.valueText },
      newValues: { key, value },
    });
    return tx.storeSetting.findUniqueOrThrow({ where: { key } });
  });
}
