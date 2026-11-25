// ============================================================================
// NOTIFICATION EVENTS — the only app write sites of `notifications`
// ============================================================================
// ADM-11: before this module the notifications table had no application write
// site at all, so the inbox could only ever be empty. The two events below are
// the real, owner-relevant ones the admin surface can raise today:
//
//   • security.role_changed   — a role, grant or mapping changed;
//   • security.account_locked — an admin account was locked by failed logins.
//
// Recipients are REAL active SUPER_ADMIN holders (read at event time), never a
// hard-coded address and never a fixture. The acting account is skipped: it
// already knows what it just did.
//
// Delivery is best-effort and deliberately outside the mutation transaction:
// the authoritative, atomic record is the audit row. A notification failure
// must never roll back a security change or turn a failed login into a crash —
// callers await `.catch(() => {})`.
import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { SUPER_ADMIN_ROLE } from "@/lib/admin/policy";

type RoleChangeKind = "role.create" | "role.update" | "role.delete" | "grant.add" | "grant.remove" | "mapping.add" | "mapping.remove";

const ROLE_CHANGE_TEXT: Record<RoleChangeKind, string> = {
  "role.create": "تم إنشاء دور جديد",
  "role.update": "تم تعديل دور",
  "role.delete": "تم حذف دور",
  "grant.add": "تم منح صلاحية لدور",
  "grant.remove": "تم سحب صلاحية من دور",
  "mapping.add": "تم إسناد دور لمستخدم",
  "mapping.remove": "تم إزالة دور من مستخدم",
};

export interface SuperAdminNotice {
  type: string;
  title: string;
  message: string;
  data?: Prisma.InputJsonValue;
  /** When set, an existing notice with the same type + entity is not repeated. */
  entityId?: string;
  /** The acting account is skipped — it already knows what it did. */
  excludeUserId?: string;
}

/**
 * ADM-11 (final round): the shared writer. Recipients are REAL active
 * SUPER_ADMIN holders read at event time. When `entityId` is given the write
 * is idempotent per (type, entity): a repeated event — a second sweep, a
 * retried request — never fills the inbox with the same notice twice.
 */
export async function notifyActiveSuperAdmins(input: SuperAdminNotice): Promise<number> {
  const recipients = await prisma.user.findMany({
    where: {
      isActive: true,
      deletedAt: null,
      ...(input.excludeUserId ? { id: { not: input.excludeUserId } } : {}),
      userRoles: { some: { role: { name: SUPER_ADMIN_ROLE, isActive: true } } },
    },
    select: { id: true },
  });
  if (recipients.length === 0) return 0;
  let targets = recipients.map((recipient) => recipient.id);
  if (input.entityId) {
    const existing = await prisma.$queryRaw<Array<{ uid: string }>>`
      SELECT user_id::text AS uid FROM notifications
       WHERE user_id = ANY(${targets}::uuid[])
         AND type = ${input.type}
         AND data->>'entityId' = ${input.entityId}`;
    const seen = new Set(existing.map((row) => row.uid));
    targets = targets.filter((id) => !seen.has(id));
  }
  if (targets.length === 0) return 0;
  const data = {
    ...(input.data && typeof input.data === "object" && !Array.isArray(input.data)
      ? (input.data as Record<string, unknown>)
      : {}),
    ...(input.entityId ? { entityId: input.entityId } : {}),
  };
  const result = await prisma.notification.createMany({
    data: targets.map((userId) => ({
      userId,
      type: input.type,
      title: input.title,
      message: input.message,
      data,
    })),
  });
  return result.count;
}

async function createForActiveSuperAdmins(input: {
  excludeUserId?: string;
  type: string;
  title: string;
  message: string;
  data?: Prisma.InputJsonValue;
}): Promise<number> {
  return notifyActiveSuperAdmins(input);
}

/** Notify the owners that a role, grant or mapping changed. */
export function notifyRoleAccessChanged(input: {
  actorId: string;
  kind: RoleChangeKind;
  roleName: string;
  /** Permission key or user name — the object of the change. */
  target?: string;
}): Promise<number> {
  const detail = input.target ? ` «${input.target}»` : "";
  return createForActiveSuperAdmins({
    excludeUserId: input.actorId,
    type: "security.role_changed",
    title: "تغيير في صلاحيات الإدارة",
    message: `${ROLE_CHANGE_TEXT[input.kind]}: «${input.roleName}»${detail}.`,
    data: { kind: input.kind, role: input.roleName, ...(input.target ? { target: input.target } : {}) },
  });
}

/** Notify the owners that an admin account crossed the lockout threshold. */
export function notifyAccountLocked(input: { userId: string; userName: string }): Promise<number> {
  return createForActiveSuperAdmins({
    type: "security.account_locked",
    title: "قفل حساب إداري",
    message: `تم قفل حساب «${input.userName}» مؤقتًا بعد محاولات دخول فاشلة متكررة.`,
    data: { userId: input.userId },
  });
}

/**
 * ADM-11 (final round): a new order is a REAL backend event — the order row
 * exists and the pipeline confirmed it inside the same transaction, so this
 * is the "order received" signal the owners act on. The order number is read
 * back from the row (the caller's contract does not change) and the notice is
 * idempotent per order.
 */
export async function notifyOrderCreated(input: { orderId: string }): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ order_number: string; status: string }>>`
    SELECT order_number, status FROM orders WHERE id = ${input.orderId}::uuid LIMIT 1`;
  const order = rows[0];
  if (!order) return 0;
  return notifyActiveSuperAdmins({
    type: "order.created",
    title: "طلب جديد في المتجر",
    message: `وصل طلب جديد رقم ${order.order_number} وحالته ${order.status}.`,
    entityId: input.orderId,
    data: { orderNumber: order.order_number, status: order.status },
  });
}
