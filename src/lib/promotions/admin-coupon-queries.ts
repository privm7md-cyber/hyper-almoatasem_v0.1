// ============================================================================
// ADMIN COUPON READS — the list/detail/preview data for the coupon screen
// ============================================================================
// These reads exist for the ADMIN screen only. They never write, never bump a
// counter and never touch a usage row.
//
// Two rules keep this honest:
//   1. The validity flags (`own_ok` / `parent_ok`) are the SAME SQL the
//      checkout reads (`queries.ts` → `findCouponForApply`). The status
//      CASE expression is generated from the same ordered rule list as the
//      TypeScript classifier (`coupon-status.ts`), so the badge and the
//      status filter can never disagree.
//   2. The usage money comes from `coupon_usages` (what was actually granted),
//      never from a counter that only says "how many".
// ============================================================================
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { couponStatusSqlCase, type CouponStatusValue } from "@/lib/promotions/coupon-status";

/** The validity flags — byte-for-byte the checkout's expressions. */
const VALIDITY_SQL = Prisma.sql`
  (c.is_active AND (c.start_at IS NULL OR c.start_at <= now())
    AND (c.end_at IS NULL OR c.end_at > now())) AS own_ok,
  (p.status = 'ACTIVE' AND p.deleted_at IS NULL
    AND (p.start_at IS NULL OR p.start_at <= now())
    AND (p.end_at IS NULL OR p.end_at > now())) AS parent_ok`;

export interface AdminCouponRow {
  id: string;
  promotion_id: string;
  code: string;
  usage_limit: number | null;
  used_count: number;
  per_customer_limit: number | null;
  minimum_order_amount: string | null;
  start_at: Date | null;
  end_at: Date | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  promo_name: string;
  promo_type: string;
  promo_scope: string;
  promo_status: string;
  promo_usage_limit: number | null;
  promo_used_count: number;
  pdp: string | null;
  pda: string | null;
  promo_max: string | null;
  own_ok: boolean;
  parent_ok: boolean;
  status: CouponStatusValue;
  usage_rows: number;
  total_discount: string;
  distinct_customers: number;
  last_used_at: Date | null;
}

const STATUS_SQL = couponStatusSqlCase();

function couponSelect() {
  return Prisma.sql`
    SELECT c.id::text AS id, c.promotion_id::text AS promotion_id, c.code,
      c.usage_limit, c.used_count, c.per_customer_limit,
      c.minimum_order_amount::text AS minimum_order_amount,
      c.start_at, c.end_at, c.is_active, c.created_at, c.updated_at,
      p.name AS promo_name, p.type AS promo_type, p.scope AS promo_scope,
      p.status AS promo_status, p.usage_limit AS promo_usage_limit, p.used_count AS promo_used_count,
      p.discount_percent::text AS pdp, p.discount_amount::text AS pda,
      pr.maximum_discount::text AS promo_max,
      ${VALIDITY_SQL},
      ${Prisma.raw(STATUS_SQL)} AS status,
      (SELECT COUNT(*)::int FROM coupon_usages u WHERE u.coupon_id = c.id) AS usage_rows,
      (SELECT COALESCE(SUM(COALESCE(u.final_discount_amount, u.estimated_discount_amount)), 0)::text
         FROM coupon_usages u WHERE u.coupon_id = c.id) AS total_discount,
      (SELECT COUNT(DISTINCT u.customer_id)::int FROM coupon_usages u WHERE u.coupon_id = c.id) AS distinct_customers,
      (SELECT MAX(u.created_at) FROM coupon_usages u WHERE u.coupon_id = c.id) AS last_used_at
    FROM coupons c
    JOIN promotions p ON p.id = c.promotion_id
    LEFT JOIN promotion_rules pr ON pr.promotion_id = p.id`;
}

export interface AdminCouponListFilter {
  limit: number;
  cursor: string | null;
  search: string | null;
  /** The `is_active` flag filter (kept separate from the status filter). */
  active: boolean | null;
  /** The computed status filter (server-side). */
  status: CouponStatusValue | null;
}

/** The admin coupon list, with the real status and the real usage money. */
export async function listCouponsAdmin(filter: AdminCouponListFilter): Promise<AdminCouponRow[]> {
  const where: Prisma.Sql[] = [Prisma.sql`c.deleted_at IS NULL`];
  if (filter.cursor) where.push(Prisma.sql`c.id > ${filter.cursor}::uuid`);
  if (filter.search) where.push(Prisma.sql`c.code ILIKE ${`%${filter.search}%`}`);
  if (filter.active !== null) where.push(Prisma.sql`c.is_active = ${filter.active}`);
  if (filter.status) where.push(Prisma.sql`${Prisma.raw(STATUS_SQL)} = ${filter.status}`);
  return prisma.$queryRaw<AdminCouponRow[]>(Prisma.sql`
    ${couponSelect()}
    WHERE ${Prisma.join(where, " AND ")}
    ORDER BY c.id ASC
    LIMIT ${filter.limit + 1}`);
}

/** One coupon with its status and usage money (the detail screen). */
export async function getCouponAdmin(id: string): Promise<AdminCouponRow | null> {
  const rows = await prisma.$queryRaw<AdminCouponRow[]>(Prisma.sql`
    ${couponSelect()}
    WHERE c.id = ${id}::uuid AND c.deleted_at IS NULL`);
  return rows.length === 0 ? null : rows[0];
}

/** The coupon's offer targets (the lines the coupon can discount). */
export async function listCouponOfferTargets(promotionId: string) {
  const rows = await prisma.$queryRaw<Array<{ tt: string; tid: string }>>(Prisma.sql`
    SELECT target_type AS tt, target_id::text AS tid
      FROM promotion_targets WHERE promotion_id = ${promotionId}::uuid`);
  return rows.map((row) => ({
    tt: row.tt as "VARIANT" | "PRODUCT" | "BRAND" | "CATEGORY",
    tid: row.tid,
  }));
}
