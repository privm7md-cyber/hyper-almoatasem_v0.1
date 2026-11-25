import "server-only";

import { prisma } from "@/lib/db";
import type { AdminContext } from "@/lib/auth/rbac";

export function countOwnUnreadNotifications(admin: AdminContext) {
  return prisma.notification.count({ where: { userId: admin.user.id, readAt: null } });
}

type NotificationJsonRow = {
  id: string;
  title: string;
  message: string;
  readAt: string | null;
  createdAt: string;
};

type NotificationEnvelope = { anchorValid: boolean; rows: NotificationJsonRow[] };

/**
 * ADM-11: the notification types this build actually writes. The filter
 * offers only these; rows of any other type stay visible under "all" and are
 * never mislabelled.
 */
export const NOTIFICATION_TYPE_OPTIONS = [
  { value: "security.role_changed", label: "تغيير في صلاحيات الإدارة" },
  { value: "security.account_locked", label: "قفل حساب إداري" },
  { value: "order.created", label: "طلب جديد" },
  { value: "inventory.out_of_stock", label: "منتج خلص من المخزون" },
  { value: "inventory.low_stock", label: "مخزون منخفض" },
  { value: "promotion.expiring", label: "عرض قارب على الانتهاء" },
  { value: "coupon.expiring", label: "كود خصم قارب على الانتهاء" },
  { value: "coupon.expired", label: "كود خصم انتهت صلاحيته" },
] as const;

const NOTIFICATION_TYPE_VALUES: readonly string[] = NOTIFICATION_TYPE_OPTIONS.map((option) => option.value);

/** True only for a type this build writes (the API never accepts free text). */
export function isKnownNotificationType(value: string): boolean {
  return NOTIFICATION_TYPE_VALUES.includes(value);
}

export function notificationTypeLabel(value: string): string {
  return NOTIFICATION_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? "إشعار من النظام";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listOwnNotifications(
  admin: AdminContext,
  cursor: string | null,
  unreadOnly: boolean,
  type: string | null = null,
) {
  if (cursor !== null && (cursor.length !== 36 || !UUID_RE.test(cursor))) {
    return { rows: [], nextCursor: null, invalidCursor: true };
  }
  if (type !== null && !isKnownNotificationType(type)) {
    return { rows: [], nextCursor: null, invalidCursor: true };
  }

  // One statement/snapshot: neither anchor precision nor validity round-trips through JS.
  const [envelope] = await prisma.$queryRaw<NotificationEnvelope[]>`
    WITH input AS (
      SELECT ${admin.user.id}::uuid AS user_id, ${cursor}::uuid AS cursor,
             ${unreadOnly}::boolean AS unread_only,
             ${type}::text AS type_filter
    ), scoped AS (
      SELECT n.id, n.title, n.message, n.read_at, n.created_at
      FROM notifications AS n CROSS JOIN input AS i
      WHERE n.user_id = i.user_id AND (NOT i.unread_only OR n.read_at IS NULL)
        AND (i.type_filter IS NULL OR n.type = i.type_filter)
    ), anchor AS (
      SELECT s.id, s.created_at
      FROM scoped AS s CROSS JOIN input AS i
      WHERE s.id = i.cursor
    ), page AS (
      SELECT s.id, s.title, s.message, s.read_at, s.created_at
      FROM scoped AS s CROSS JOIN input AS i
      WHERE i.cursor IS NULL OR (s.created_at, s.id) < (
        SELECT a.created_at, a.id FROM anchor AS a
      )
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT 21
    )
    SELECT (i.cursor IS NULL OR EXISTS (SELECT 1 FROM anchor)) AS "anchorValid",
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
               'id', p.id, 'title', p.title, 'message', p.message,
               'readAt', to_char(p.read_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
               'createdAt', to_char(p.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
             ) ORDER BY p.created_at DESC, p.id DESC)
             FROM page AS p
           ), '[]'::jsonb) AS rows
    FROM input AS i
  `;
  if (!envelope) throw new Error("Notification page unavailable");
  if (!envelope.anchorValid) return { rows: [], nextCursor: null, invalidCursor: true };

  // Dates are display-only; pagination uses the last displayed ID, never a JS timestamp.
  const rows = envelope.rows.slice(0, 20).map(({ id, title, message, readAt, createdAt }) => ({
    id, title, message, readAt: readAt === null ? null : new Date(readAt), createdAt: new Date(createdAt),
  }));
  return { rows, nextCursor: envelope.rows.length > 20 ? rows[rows.length - 1].id : null, invalidCursor: false };
}

/**
 * ADM-11: mark ONE notification of the signed-in account as read.
 *
 * The lookup and the update are both scoped by `userId`; a notification that
 * belongs to another account is indistinguishable from a missing one. Already
 * read rows keep their original read time (idempotent by design).
 */
export async function markOwnNotificationRead(
  admin: AdminContext,
  notificationId: string,
): Promise<"updated" | "already-read" | "missing"> {
  if (!UUID_RE.test(notificationId)) return "missing";
  const row = await prisma.notification.findFirst({
    where: { id: notificationId, userId: admin.user.id },
    select: { id: true, readAt: true },
  });
  if (!row) return "missing";
  if (row.readAt !== null) return "already-read";
  await prisma.notification.updateMany({
    where: { id: row.id, userId: admin.user.id, readAt: null },
    data: { readAt: new Date() },
  });
  return "updated";
}

/** ADM-11: mark every unread notification of the signed-in account as read. */
export async function markAllOwnNotificationsRead(admin: AdminContext): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { userId: admin.user.id, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}
