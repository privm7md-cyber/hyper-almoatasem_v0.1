// BA-8 promotion/coupon read domain.
//
// Prisma owns representable reads (graphs, lookups, lists). Raw SQL owns
// only DB-time effectiveness gates (SQL now() — CC-1 rule: no JS clock in
// time decisions) and the category-subtree probe input.
// Time windows are evaluated by PostgreSQL in the loading queries; the
// pure engine receives pre-filtered promos (clean query/engine split).
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

const promoGraph = {
  include: {
    targets: true,
    rules: true,
    buyGetRules: true,
  },
};

export function getPromotion(id: string) {
  return prisma.promotion.findUnique({ where: { id }, ...promoGraph });
}

/** Creation choices include drafts and disabled offers; checkout effectiveness is separate. */
export function listCouponOfferOptions() {
  return prisma.promotion.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, status: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: 201,
  });
}

export interface PromotionListFilter {
  limit: number;
  cursor: string | null;
  status: string | null;
  type: string | null;
  scope: string | null;
  search: string | null;
  /**
   * Effective state of the offer (LIVE / SCHEDULED / EXPIRED / DRAFT /
   * DISABLED). The backend decides effectiveness with SQL now(); this filter
   * mirrors that rule for the operator's view of the campaign list, and the
   * counts on the same page are computed from the same helper — so the
   * number and the list can never disagree.
   */
  state?: string | null;
  /** Reference instant for the effective state (injected; no hidden clock). */
  now?: Date;
}

/** The effective-state predicate, mirroring the backend's own window rule. */
function stateWhere(state: string, now: Date): Prisma.PromotionWhereInput {
  if (state === "DRAFT") return { status: "DRAFT" };
  if (state === "DISABLED") return { status: "DISABLED" };
  if (state === "SCHEDULED") return { status: "ACTIVE", startAt: { gt: now } };
  if (state === "EXPIRED") {
    return {
      status: "ACTIVE",
      endAt: { lte: now },
      AND: [{ OR: [{ startAt: null }, { startAt: { lte: now } }] }],
    };
  }
  // LIVE: active, already started, not finished yet (the end is exclusive).
  return {
    status: "ACTIVE",
    AND: [{ OR: [{ startAt: null }, { startAt: { lte: now } }] }, { OR: [{ endAt: null }, { endAt: { gt: now } }] }],
  };
}

export async function listPromotions(filter: PromotionListFilter) {
  const now = filter.now ?? new Date();
  const rows = await prisma.promotion.findMany({
    where: {
      ...(filter.cursor ? { id: { gt: filter.cursor } } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.type ? { type: filter.type } : {}),
      ...(filter.scope ? { scope: filter.scope } : {}),
      ...(filter.search ? { name: { contains: filter.search, mode: "insensitive" as const } } : {}),
      ...(filter.state ? stateWhere(filter.state, now) : {}),
    },
    include: { _count: { select: { targets: true, coupons: true } } },
    orderBy: [{ id: "asc" as const }],
    take: filter.limit + 1,
  });
  return rows;
}

/**
 * The state of every offer (small table) — the counts on the campaigns page
 * are computed from these rows with the same helper the list filter uses.
 */
export async function listPromotionStates(): Promise<
  Array<{ id: string; status: string; startAt: Date | null; endAt: Date | null }>
> {
  return prisma.promotion.findMany({
    where: { deletedAt: null },
    select: { id: true, status: true, startAt: true, endAt: true },
  });
}

/**
 * Effective promotions for evaluation: admin ACTIVE + in-window, decided
 * by SQL now(). Soft-deleted rows (deleted_at set) are excluded — a
 * deleted promo must never discount (deleted ⇒ DISABLED by CHECK, plus
 * this explicit filter for defense in depth).
 */
export async function loadEffectivePromotions(ids: string[] | null) {
  const idFilter =
    ids === null ? Prisma.empty : Prisma.sql`AND p.id = ANY(${ids}::uuid[])`;
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      name: string;
      type: string;
      scope: string;
      priority: number;
      is_stackable: boolean;
      created_at: Date;
      discount_percent: string | null;
      discount_amount: string | null;
      fixed_price: string | null;
      minimum_quantity: string | null;
      minimum_amount: string | null;
      maximum_discount: string | null;
      buy_quantity: string | null;
      get_quantity: string | null;
      buy_pct: string | null;
      free_variant_id: string | null;
      usage_limit: number | null;
    }>
  >`
    SELECT p.id::text AS id, p.name, p.type, p.scope, p.priority, p.is_stackable, p.created_at,
      p.discount_percent::text, p.discount_amount::text, p.fixed_price::text,
      pr.minimum_quantity::text, pr.minimum_amount::text, pr.maximum_discount::text,
      b.buy_quantity::text, b.get_quantity::text, b.discount_percent::text AS buy_pct,
      b.free_variant_id::text AS free_variant_id, p.usage_limit
      FROM promotions p
      LEFT JOIN promotion_rules pr ON pr.promotion_id = p.id
      LEFT JOIN promotion_buy_get_rules b ON b.promotion_id = p.id
     WHERE p.status = 'ACTIVE' AND p.deleted_at IS NULL
       AND (p.start_at IS NULL OR p.start_at <= now())
       AND (p.end_at IS NULL OR p.end_at > now())
       ${idFilter}`;
  const targets = await prisma.$queryRaw<Array<{ pid: string; tt: string; tid: string }>>`
    SELECT promotion_id::text AS pid, target_type AS tt, target_id::text AS tid
      FROM promotion_targets WHERE promotion_id = ANY(${rows.map((r) => r.id)}::uuid[])`;
  const byPromo = new Map<string, Array<{ tt: string; tid: string }>>();
  for (const tg of targets) {
    const arr = byPromo.get(tg.pid) ?? [];
    arr.push({ tt: tg.tt, tid: tg.tid });
    byPromo.set(tg.pid, arr);
  }
  return rows.map((r) => ({ ...r, targets: byPromo.get(r.id) ?? [] }));
}

/** Category parent map for subtree matching (small table, one query). */
export async function loadCategoryTree(): Promise<Map<string, string | null>> {
  const rows = await prisma.$queryRaw<Array<{ id: string; parent: string | null }>>`
    SELECT id::text AS id, parent_id::text AS parent FROM categories`;
  return new Map(rows.map((r) => [r.id, r.parent]));
}

/** Subtree probe: true iff lineCid equals or descends from targetCid. */
export function inSubtree(tree: Map<string, string | null>, lineCid: string, targetCid: string): boolean {
  let cur: string | null | undefined = lineCid;
  let depth = 0;
  while (cur !== null && cur !== undefined && depth < 100) {
    if (cur === targetCid) return true;
    cur = tree.get(cur);
    depth++;
  }
  return false;
}

export interface CouponListFilter {
  limit: number;
  cursor: string | null;
  search: string | null;
  active: boolean | null;
}

export async function listCoupons(filter: CouponListFilter) {
  const rows = await prisma.coupon.findMany({
    where: {
      ...(filter.cursor ? { id: { gt: filter.cursor } } : {}),
      ...(filter.search ? { code: { contains: filter.search, mode: "insensitive" as const } } : {}),
      ...(filter.active === null || filter.active === undefined ? {} : { isActive: filter.active }),
    },
    orderBy: [{ id: "asc" as const }],
    take: filter.limit + 1,
  });
  return rows;
}

export function getCoupon(id: string) {
  return prisma.coupon.findUnique({
    where: { id },
    include: { promotion: { select: { id: true, name: true, status: true } } },
  });
}

export interface CouponUsageListFilter {
  limit: number;
  cursor: string | null;
}

/** Coupon usage ledger (read-only reporting; reads never bump counters). */
export async function listCouponUsages(couponId: string, filter: CouponUsageListFilter) {
  const rows = await prisma.couponUsage.findMany({
    where: {
      couponId,
      ...(filter.cursor ? { id: { gt: filter.cursor } } : {}),
    },
    orderBy: [{ id: "asc" as const }],
    take: filter.limit + 1,
  });
  return rows;
}

/**
 * Coupon validation read: normalized code + parent + rule in one row, with
 * BOTH windows and flags decided by SQL now(). Returns null for unknown
 * codes (caller maps 404); inapplicable codes are distinguished by rule.
 *
 * `client` lets the order write path read the coupon through the SAME
 * transaction connection. A read through the global client inside a
 * transaction needs a second pooled connection: when the pool is saturated
 * that read waits, the interactive transaction's budget expires, and a
 * legitimate order fails with an opaque 500 instead of a coupon answer.
 */
export async function findCouponForApply(
  code: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const rows = await client.$queryRaw<
    Array<{
      id: string;
      promotion_id: string;
      promo_name: string;
      promo_status: string;
      promo_deleted: Date | null;
      promo_type: string;
      promo_scope: string;
      pdp: string | null;
      pda: string | null;
      usage_limit: number | null;
      used_count: number;
      per_customer_limit: number | null;
      minimum_order_amount: string | null;
      is_active: boolean;
      own_ok: boolean;
      parent_ok: boolean;
      promo_max: string | null;
    }>
  >`
    SELECT c.id::text AS id, c.promotion_id::text AS promotion_id, p.name AS promo_name,
      p.status AS promo_status, p.deleted_at AS promo_deleted, p.type AS promo_type, p.scope AS promo_scope,
      p.discount_percent::text AS pdp, p.discount_amount::text AS pda,
      c.usage_limit, c.used_count, c.per_customer_limit, c.minimum_order_amount::text,
      c.is_active,
      (c.is_active AND (c.start_at IS NULL OR c.start_at <= now())
        AND (c.end_at IS NULL OR c.end_at > now())) AS own_ok,
      (p.status = 'ACTIVE' AND p.deleted_at IS NULL
        AND (p.start_at IS NULL OR p.start_at <= now())
        AND (p.end_at IS NULL OR p.end_at > now())) AS parent_ok,
      pr.maximum_discount::text AS promo_max
      FROM coupons c JOIN promotions p ON p.id = c.promotion_id
      LEFT JOIN promotion_rules pr ON pr.promotion_id = p.id
     WHERE c.code = ${code} AND c.deleted_at IS NULL`;
  return rows.length === 0 ? null : rows[0];
}

/** Active (non-cancelled) usage count for one coupon+customer. */
export async function countActiveUsages(
  tx: Prisma.TransactionClient,
  couponId: string,
  customerId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ n: string }>>`
    SELECT COUNT(*)::text AS n FROM coupon_usages u JOIN orders o ON o.id = u.order_id
     WHERE u.coupon_id = ${couponId}::uuid AND u.customer_id = ${customerId}::uuid
       AND o.status <> 'CANCELLED'`;
  return Number(rows[0].n);
}
