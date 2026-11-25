// ADM-11 (final completion round) — notifications that have a REAL source.
//
// Every alert below is derived from rows the store already owns: the inventory
// table, the promotions table and the coupons table. Nothing is invented and
// no notice is raised for an event that has no source — "an order awaiting
// confirmation", for example, is NOT emitted, because the order pipeline
// confirms the order inside the same transaction and no pending row exists.
//
// The sweep is read-then-write and idempotent per (type, entity): running it
// twice never fills the inbox with the same notice twice. The audit log stays
// the authoritative record of what happened.
import "server-only";

import { prisma } from "@/lib/db";
import { notifyActiveSuperAdmins } from "@/lib/admin/notification-events";

export const STORE_ALERT_TYPES = [
  "inventory.out_of_stock",
  "inventory.low_stock",
  "promotion.expiring",
  "coupon.expired",
  "coupon.expiring",
] as const;

export type StoreAlertType = (typeof STORE_ALERT_TYPES)[number];

export interface StoreAlert {
  type: StoreAlertType;
  entityId: string;
  title: string;
  message: string;
}

type AlertDb = Pick<typeof prisma, "$queryRaw">;

interface VariantStockRow {
  vid: string;
  vname: string;
  pname: string;
  threshold: string | null;
}

interface PromoRow {
  id: string;
  name: string;
}

interface CouponRow {
  id: string;
  code: string;
}

/**
 * The alerts the store can prove right now. The time comparisons are decided
 * by PostgreSQL (`now()`), never by a JavaScript clock, and every row is
 * filtered to live catalogue data (active, not deleted).
 */
export async function collectStoreAlerts(db: AlertDb = prisma): Promise<StoreAlert[]> {
  const [outOfStock, lowStock, expiringPromotions, expiredCoupons, expiringCoupons] =
    await Promise.all([
      db.$queryRaw<VariantStockRow[]>`
        SELECT i.product_variant_id::text AS vid, v.name AS vname, p.name AS pname,
               NULL::text AS threshold
          FROM inventory i
          JOIN product_variants v ON v.id = i.product_variant_id AND v.deleted_at IS NULL AND v.is_active
          JOIN products p ON p.id = v.product_id AND p.deleted_at IS NULL AND p.is_active
         WHERE (i.quantity - i.reserved_quantity) <= 0`,
      db.$queryRaw<VariantStockRow[]>`
        SELECT i.product_variant_id::text AS vid, v.name AS vname, p.name AS pname,
               i.low_stock_threshold::text AS threshold
          FROM inventory i
          JOIN product_variants v ON v.id = i.product_variant_id AND v.deleted_at IS NULL AND v.is_active
          JOIN products p ON p.id = v.product_id AND p.deleted_at IS NULL AND p.is_active
         WHERE i.low_stock_threshold IS NOT NULL
           AND (i.quantity - i.reserved_quantity) > 0
           AND (i.quantity - i.reserved_quantity) <= i.low_stock_threshold`,
      db.$queryRaw<PromoRow[]>`
        SELECT id::text AS id, name FROM promotions
         WHERE status = 'ACTIVE' AND deleted_at IS NULL AND end_at IS NOT NULL
           AND end_at > now() AND end_at <= now() + interval '24 hours'`,
      db.$queryRaw<CouponRow[]>`
        SELECT id::text AS id, code FROM coupons
         WHERE is_active AND deleted_at IS NULL AND end_at IS NOT NULL AND end_at <= now()`,
      db.$queryRaw<CouponRow[]>`
        SELECT id::text AS id, code FROM coupons
         WHERE is_active AND deleted_at IS NULL AND end_at IS NOT NULL
           AND end_at > now() AND end_at <= now() + interval '24 hours'`,
    ]);

  const alerts: StoreAlert[] = [];
  for (const row of outOfStock) {
    alerts.push({
      type: "inventory.out_of_stock",
      entityId: row.vid,
      title: "منتج خلص من المخزون",
      message: `«${row.pname} — ${row.vname}» دلوقتي غير متاح للبيع (الكمية المتاحة صفر).`,
    });
  }
  for (const row of lowStock) {
    alerts.push({
      type: "inventory.low_stock",
      entityId: row.vid,
      title: "مخزون منخفض",
      message: `«${row.pname} — ${row.vname}» وصل لحد التنبيه (${row.threshold ?? "—"}).`,
    });
  }
  for (const row of expiringPromotions) {
    alerts.push({
      type: "promotion.expiring",
      entityId: row.id,
      title: "عرض قارب على الانتهاء",
      message: `العرض «${row.name}» بينتهي خلال 24 ساعة.`,
    });
  }
  for (const row of expiredCoupons) {
    alerts.push({
      type: "coupon.expired",
      entityId: row.id,
      title: "كود خصم انتهت صلاحيته",
      message: `كود الخصم ${row.code} انتهت صلاحيته وهو لسه مفعّل في الإعدادات.`,
    });
  }
  for (const row of expiringCoupons) {
    alerts.push({
      type: "coupon.expiring",
      entityId: row.id,
      title: "كود خصم قارب على الانتهاء",
      message: `كود الخصم ${row.code} بينتهي خلال 24 ساعة.`,
    });
  }
  return alerts;
}

/** Push the collected alerts to the owners. Returns how many rows were written. */
export async function notifyStoreAlerts(alerts: StoreAlert[]): Promise<number> {
  let created = 0;
  for (const alert of alerts) {
    created += await notifyActiveSuperAdmins({
      type: alert.type,
      title: alert.title,
      message: alert.message,
      entityId: alert.entityId,
      data: { entityId: alert.entityId },
    });
  }
  return created;
}

/** Read the store's real alerts and publish the ones that are new. */
export async function sweepStoreAlerts(db: AlertDb = prisma): Promise<{ alerts: number; created: number }> {
  const alerts = await collectStoreAlerts(db);
  const created = await notifyStoreAlerts(alerts);
  return { alerts: alerts.length, created };
}
