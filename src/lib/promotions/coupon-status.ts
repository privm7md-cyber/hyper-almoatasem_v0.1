// ============================================================================
// COUPON STATUS — the admin-facing state of a coupon code
// ============================================================================
// The coupons table only stores a boolean flag; the customer-facing truth
// needs more: the window, the global usage limit, and the parent offer's
// state all decide whether the code actually works at the checkout.
//
// ONE ordered rule list drives BOTH:
//   • the TypeScript classifier (used by the list, the detail screen, the API)
//   • the SQL CASE expression (used by the list query and its status filter)
// so the filter and the badge can never disagree.
//
// The SQL side is a mirror of the SQL the checkout reads
// (`findCouponForApply` → `own_ok` / `parent_ok`). The rules are pure (the
// caller passes `now`) so they are unit-testable without a database.
// ============================================================================

export const COUPON_STATUS = {
  /** Usable right now. */
  ACTIVE: "ACTIVE",
  /** The admin switched the code off. */
  INACTIVE: "INACTIVE",
  /** The start date is in the future. */
  NOT_STARTED: "NOT_STARTED",
  /** The end date has passed. */
  EXPIRED: "EXPIRED",
  /** The global usage limit is used up. */
  LIMIT_REACHED: "LIMIT_REACHED",
  /** The parent offer is not live (disabled, outside its window, deleted). */
  PARENT_UNAVAILABLE: "PARENT_UNAVAILABLE",
  /** The parent offer's discount type has no coupon semantics. */
  TYPE_UNSUPPORTED: "TYPE_UNSUPPORTED",
} as const;

export type CouponStatusValue = (typeof COUPON_STATUS)[keyof typeof COUPON_STATUS];

export interface CouponStatusInput {
  isActive: boolean;
  startAt: Date | null;
  endAt: Date | null;
  usageLimit: number | null;
  usedCount: number;
  /** The parent offer is live (SQL-computed `parent_ok`). */
  parentOk: boolean;
  /** The parent offer's discount type. */
  promoType: string;
}

export interface CouponStatus {
  status: CouponStatusValue;
  /** True when the code can be applied to a basket right now. */
  usable: boolean;
  /** The Arabic label shown in the admin. */
  labelAr: string;
  /** A stable machine key (never rendered raw). */
  reasonKey: CouponStatusValue;
}

/* -------------------------------------------------------------- SQL parts */

/** The coupon's own window is open (the checkout's `own_ok` window part). */
export const SQL_WINDOW_OPEN = "(c.start_at IS NULL OR c.start_at <= now()) AND (c.end_at IS NULL OR c.end_at > now())";
/** The parent offer is live (the checkout's `parent_ok`). */
export const SQL_PARENT_OK =
  "(p.status = 'ACTIVE' AND p.deleted_at IS NULL AND (p.start_at IS NULL OR p.start_at <= now()) AND (p.end_at IS NULL OR p.end_at > now()))";
/** The offer types the coupon layer supports. */
export const SQL_SUPPORTED_TYPES = "('PERCENTAGE','FIXED_AMOUNT')";

/* ---------------------------------------------------------------- rules */

interface CouponStatusRule {
  status: CouponStatusValue;
  labelAr: string;
  /** The TypeScript predicate (the row already carries the SQL flags). */
  ts: (input: CouponStatusInput, now: Date) => boolean;
  /** The SQL predicate, relative to the table aliases `c` (coupon) and `p` (offer). */
  sql: string;
  /** The SQL conditions of the PREVIOUS rules that must hold for this arm. */
  sqlPrefix: string;
}

/**
 * The ordered rule list. The order IS the precedence: a customer hits the
 * first matching reason.
 */
export const COUPON_STATUS_RULES: readonly CouponStatusRule[] = [
  {
    status: COUPON_STATUS.INACTIVE,
    labelAr: "موقوف",
    ts: (i) => !i.isActive,
    sql: "NOT c.is_active",
    sqlPrefix: "",
  },
  {
    status: COUPON_STATUS.NOT_STARTED,
    labelAr: "لسه ما بدأش",
    ts: (i, now) => i.isActive && i.startAt !== null && i.startAt.getTime() > now.getTime(),
    sql: "c.start_at IS NOT NULL AND c.start_at > now()",
    sqlPrefix: "c.is_active",
  },
  {
    status: COUPON_STATUS.EXPIRED,
    labelAr: "منتهي",
    ts: (i, now) =>
      i.isActive &&
      (i.startAt === null || i.startAt.getTime() <= now.getTime()) &&
      i.endAt !== null &&
      i.endAt.getTime() <= now.getTime(),
    sql: "c.end_at IS NOT NULL AND c.end_at <= now()",
    sqlPrefix: `c.is_active AND (c.start_at IS NULL OR c.start_at <= now())`,
  },
  {
    status: COUPON_STATUS.LIMIT_REACHED,
    labelAr: "وصل الحد الأقصى",
    ts: (i) =>
      i.isActive &&
      i.usageLimit !== null &&
      i.usedCount >= i.usageLimit,
    sql: "c.usage_limit IS NOT NULL AND c.used_count >= c.usage_limit",
    sqlPrefix: `c.is_active AND ${SQL_WINDOW_OPEN}`,
  },
  {
    status: COUPON_STATUS.PARENT_UNAVAILABLE,
    labelAr: "العرض اللي وراه مش شغّال",
    ts: (i) => !i.parentOk,
    sql: `NOT ${SQL_PARENT_OK}`,
    sqlPrefix: `c.is_active AND ${SQL_WINDOW_OPEN}`,
  },
  {
    status: COUPON_STATUS.TYPE_UNSUPPORTED,
    labelAr: "نوع الخصم غير مدعوم",
    ts: (i) => i.promoType !== "PERCENTAGE" && i.promoType !== "FIXED_AMOUNT",
    sql: `p.type NOT IN ${SQL_SUPPORTED_TYPES}`,
    sqlPrefix: `c.is_active AND ${SQL_WINDOW_OPEN} AND ${SQL_PARENT_OK}`,
  },
  {
    status: COUPON_STATUS.ACTIVE,
    labelAr: "نشط",
    ts: () => true,
    sql: "TRUE",
    sqlPrefix: `c.is_active AND ${SQL_WINDOW_OPEN} AND ${SQL_PARENT_OK} AND p.type IN ${SQL_SUPPORTED_TYPES}`,
  },
];

/**
 * The SQL CASE expression that computes the same status in the database.
 * `c` = the coupons alias, `p` = the promotions alias.
 */
export function couponStatusSqlCase(): string {
  const arms = COUPON_STATUS_RULES.map((rule) => {
    const prefix = rule.sqlPrefix ? `(${rule.sqlPrefix}) AND ` : "";
    return `WHEN ${prefix}${rule.sql} THEN '${rule.status}'`;
  }).join(" ");
  return `CASE ${arms} ELSE '${COUPON_STATUS.INACTIVE}' END`;
}

/**
 * Classify one coupon. Precedence follows what a customer would hit first:
 * an explicit stop beats a window, a window beats a limit, and the parent
 * offer's state is the last reason.
 */
export function classifyCouponStatus(input: CouponStatusInput, now: Date): CouponStatus {
  for (const rule of COUPON_STATUS_RULES) {
    if (rule.ts(input, now)) {
      return {
        status: rule.status,
        usable: rule.status === COUPON_STATUS.ACTIVE,
        labelAr: rule.labelAr,
        reasonKey: rule.status,
      };
    }
  }
  // Unreachable: the last rule always matches.
  return {
    status: COUPON_STATUS.INACTIVE,
    usable: false,
    labelAr: "موقوف",
    reasonKey: COUPON_STATUS.INACTIVE,
  };
}

/** The label for a status value (for renderers that only have the key). */
export function couponStatusLabel(status: CouponStatusValue): string {
  return COUPON_STATUS_RULES.find((rule) => rule.status === status)?.labelAr ?? status;
}

/** Every status value, for filter dropdowns. */
export const COUPON_STATUS_VALUES = Object.values(COUPON_STATUS) as CouponStatusValue[];
