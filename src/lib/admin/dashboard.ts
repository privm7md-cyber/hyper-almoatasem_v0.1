import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { addCalendarDays, type DashboardRange } from "./date-range";
import {
  KPI_CONTRACTS,
  type DashboardData,
  type DashboardInventoryData,
  type DashboardMetric,
  type DashboardOrderData,
  type DashboardPromotionAlert,
  type DashboardStockPage,
  type DashboardStockProduct,
  type KpiId,
  type ProductStockState,
  type ReadResult,
} from "./dashboard-contract";

const ORDER_STATUSES = ["NEW", "CONFIRMED", "PREPARING", "READY_FOR_DELIVERY", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"];
const METRIC_STATUS: Partial<Record<KpiId, string>> = {
  "orders-new": "NEW", "orders-awaiting": "NEW", "orders-confirmed": "CONFIRMED",
  "orders-preparing": "PREPARING", "orders-completed": "DELIVERED", "orders-cancelled": "CANCELLED",
};
const DENIED = "ليس لديك صلاحية الاطلاع على هذا المصدر.";
const READ_ERROR = "تعذر قراءة هذا المصدر؛ لا تمثل هذه الحالة قيمة صفرية.";
const NO_BASELINE = "الفترة السابقة صفر؛ لا يمكن حساب نسبة التغير.";
const CURRENT_ONLY = "حالة حالية؛ لا تتوفر بيانات تاريخية للمقارنة.";
type Count = bigint | number | string;
type OrderCounts = Pick<DashboardOrderData, "byStatus" | "total" | "previousTotal">;
type OrderDetails = Pick<DashboardOrderData, "daily" | "recent">;
type CatalogCounts = { displayed: number; hidden: number; archived: number };
interface AverageRow {
  deliveredCount: Count;
  finalCount: Count;
  average: string | null;
  previousDeliveredCount: Count;
  previousFinalCount: Count;
  previousAverage: string | null;
  changePercent: string | null;
}

// Never turn a failed/malformed aggregate into a plausible zero.
function count(value: Count): number {
  if (typeof value !== "bigint" && typeof value !== "number" &&
      !(typeof value === "string" && /^\d+$/.test(value))) throw new Error("Invalid count");
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error("Invalid count");
  return result;
}
function money(value: string | null): string {
  if (typeof value !== "string" || !/^\d+\.\d{2}$/.test(value)) throw new Error("Invalid decimal average");
  return value;
}
async function read<T>(allowed: boolean, load: () => Promise<T>): Promise<ReadResult<T>> {
  if (!allowed) return { state: "denied", data: null, note: DENIED };
  try { return { state: "ready", data: await load() }; }
  catch { return { state: "error", data: null, note: READ_ERROR }; }
}
function blocked(id: KpiId, state: Exclude<DashboardMetric["state"], "ready">, note: string): DashboardMetric {
  return { id, state, value: null, previous: null, changePercent: null, note };
}
function comparison(current: number, previous: number): Pick<DashboardMetric, "changePercent" | "note"> {
  if (previous === 0) return current === 0
    ? { changePercent: 0, note: null } : { changePercent: null, note: NO_BASELINE };
  return { changePercent: Math.round(((current - previous) / previous) * 10_000) / 100, note: null };
}
function windows(range: DashboardRange): Prisma.Sql {
  // ISO strings + explicit casts avoid Prisma's offset-less Date encoding/decoding.
  return Prisma.sql`windows(period, start_at, end_at) AS (
    VALUES ('current', ${range.start}::timestamptz, ${range.endExclusive}::timestamptz),
           ('previous', ${range.previousStart}::timestamptz, ${range.previousEndExclusive}::timestamptz)
  )`;
}
async function loadOrderCounts(range: DashboardRange): Promise<OrderCounts> {
  const rows = await prisma.$queryRaw<{ period: string; status: string; count: Count }[]>(Prisma.sql`
    WITH ${windows(range)}
    SELECT w.period, o.status, COUNT(*)::bigint AS count
    FROM windows w JOIN orders o ON o.created_at >= w.start_at AND o.created_at < w.end_at
    GROUP BY w.period, o.status`);
  const byStatus = new Map(ORDER_STATUSES.map((status) => [status, { status, count: 0, previous: 0 }]));
  for (const row of rows) {
    if ((row.period !== "current" && row.period !== "previous") || typeof row.status !== "string") {
      throw new Error("Invalid order group");
    }
    // Future/unrecognized statuses remain visible and contribute to the total denominator.
    const entry = byStatus.get(row.status) ?? { status: row.status, count: 0, previous: 0 };
    entry[row.period === "current" ? "count" : "previous"] = count(row.count);
    byStatus.set(row.status, entry);
  }
  const groups = [...byStatus.values()];
  return {
    byStatus: groups,
    total: count(groups.reduce((total, row) => total + row.count, 0)),
    previousTotal: count(groups.reduce((total, row) => total + row.previous, 0)),
  };
}
async function loadOrderDetails(range: DashboardRange): Promise<OrderDetails> {
  const [dailyRows, recent] = await Promise.all([
    prisma.$queryRaw<{ day: string; count: Count }[]>(Prisma.sql`
      SELECT to_char(created_at AT TIME ZONE 'Africa/Cairo', 'YYYY-MM-DD') AS day,
             COUNT(*)::bigint AS count
      FROM orders WHERE created_at >= ${range.start}::timestamptz AND created_at < ${range.endExclusive}::timestamptz
      GROUP BY 1 ORDER BY 1 ASC`),
    prisma.$queryRaw<DashboardOrderData["recent"]>(Prisma.sql`
      SELECT id::text AS id, order_number AS "orderNumber", status,
             to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt"
      FROM orders WHERE created_at >= ${range.start}::timestamptz AND created_at < ${range.endExclusive}::timestamptz
      ORDER BY created_at DESC, id DESC LIMIT 6`),
  ]);
  const counts = new Map(dailyRows.map((row) => [row.day, count(row.count)]));
  // A successful whole-range read proves the absent calendar buckets are empty.
  const daily = Array.from({ length: range.dayCount }, (_, index) => {
    const day = addCalendarDays(range.fromDay, index);
    return { day, count: counts.get(day) ?? 0 };
  });
  return { daily, recent: recent.map(({ id, orderNumber, status, createdAt }) => ({ id, orderNumber, status, createdAt })) };
}
async function loadAverage(range: DashboardRange): Promise<AverageRow> {
  const rows = await prisma.$queryRaw<AverageRow[]>(Prisma.sql`
    WITH ${windows(range)}, averages AS (
      SELECT w.period, COUNT(o.id)::bigint AS delivered_count,
             COUNT(o.total_final)::bigint AS final_count,
             CASE WHEN COUNT(o.id) > 0 AND COUNT(o.id) = COUNT(o.total_final)
                  THEN ROUND(AVG(o.total_final), 2) END AS average
      FROM windows w LEFT JOIN orders o
        ON o.created_at >= w.start_at AND o.created_at < w.end_at AND o.status = 'DELIVERED'
      GROUP BY w.period
    )
    SELECT c.delivered_count AS "deliveredCount", c.final_count AS "finalCount", c.average::text AS average,
           p.delivered_count AS "previousDeliveredCount", p.final_count AS "previousFinalCount",
           p.average::text AS "previousAverage",
           CASE WHEN p.average > 0 AND c.average IS NOT NULL
                  THEN ROUND((c.average - p.average) / p.average * 100, 2)::text
                WHEN p.average = 0 AND c.average = 0 THEN '0' END AS "changePercent"
    FROM averages c CROSS JOIN averages p WHERE c.period = 'current' AND p.period = 'previous'`);
  if (rows.length !== 1) throw new Error("Missing average aggregate");
  const row = rows[0];
  count(row.deliveredCount); count(row.finalCount);
  count(row.previousDeliveredCount); count(row.previousFinalCount);
  if (count(row.deliveredCount) > 0 && count(row.deliveredCount) === count(row.finalCount)) money(row.average);
  if (count(row.previousDeliveredCount) > 0 && count(row.previousDeliveredCount) === count(row.previousFinalCount)) money(row.previousAverage);
  if (row.changePercent !== null && (typeof row.changePercent !== "string" || !Number.isFinite(Number(row.changePercent)))) {
    throw new Error("Invalid average comparison");
  }
  return row;
}
function averageMetric(result: ReadResult<AverageRow>): DashboardMetric {
  const id = "order-average";
  if (result.state !== "ready") return blocked(id, result.state, result.note);
  const row = result.data;
  if (count(row.deliveredCount) === 0) return blocked(id, "unavailable", "لا توجد طلبات مكتملة في الفترة لحساب المتوسط.");
  if (count(row.finalCount) !== count(row.deliveredCount)) {
    return blocked(id, "unavailable", "الإجمالي النهائي مفقود لبعض الطلبات المكتملة؛ لا يمكن حساب المتوسط.");
  }
  const previousReady = count(row.previousDeliveredCount) > 0 && count(row.previousFinalCount) === count(row.previousDeliveredCount);
  const previous = previousReady ? money(row.previousAverage) : null;
  return {
    id, state: "ready", value: money(row.average), previous,
    changePercent: previousReady && row.changePercent !== null ? Number(row.changePercent) : null,
    note: !previousReady ? "لا يتوفر متوسط مكتمل للفترة السابقة للمقارنة."
      : previous === "0.00" && row.average !== "0.00" ? NO_BASELINE : null,
  };
}
async function loadCatalog(): Promise<CatalogCounts> {
  const rows = await prisma.$queryRaw<{ displayed: Count; hidden: Count; archived: Count }[]>(Prisma.sql`
    SELECT COUNT(*) FILTER (WHERE is_active = true AND deleted_at IS NULL)::bigint AS displayed,
           COUNT(*) FILTER (WHERE is_active = false AND deleted_at IS NULL)::bigint AS hidden,
           COUNT(*) FILTER (WHERE deleted_at IS NOT NULL)::bigint AS archived
    FROM products`);
  if (rows.length !== 1) throw new Error("Missing catalog aggregate");
  return { displayed: count(rows[0].displayed), hidden: count(rows[0].hidden), archived: count(rows[0].archived) };
}

// One product-level classifier for dashboard totals AND the keyset drilldown.
// All quantity/threshold comparisons remain PostgreSQL NUMERIC, never float8/JS.
const STOCK_CLASSIFICATION = Prisma.sql`
  stock_balances AS (
    SELECT p.id, p.name, COUNT(v.id)::bigint AS variant_count,
           COUNT(i.available_quantity)::bigint AS known_count,
           COUNT(*) FILTER (WHERE i.available_quantity > 0)::bigint AS positive_count,
           COUNT(*) FILTER (WHERE i.available_quantity > 0 AND
             (i.low_stock_threshold IS NULL OR i.available_quantity > i.low_stock_threshold))::bigint AS above_threshold_count
    FROM products p
    LEFT JOIN product_variants v ON v.product_id = p.id AND v.is_active = true AND v.deleted_at IS NULL
    LEFT JOIN inventory i ON i.product_variant_id = v.id
    WHERE p.is_active = true AND p.deleted_at IS NULL
    GROUP BY p.id, p.name
  ), classified_stock AS (
    SELECT id, name, variant_count, known_count,
           CASE WHEN positive_count > 0 THEN
                  CASE WHEN known_count = variant_count AND above_threshold_count = 0 THEN 'low' ELSE 'available' END
                WHEN variant_count > 0 AND known_count = variant_count THEN 'out'
                ELSE 'unknown' END AS state
    FROM stock_balances
  )`;
async function loadInventory(): Promise<DashboardInventoryData> {
  const rows = await prisma.$queryRaw<{ total: Count; available: Count; low: Count; out: Count; unknown: Count }[]>(Prisma.sql`
    WITH ${STOCK_CLASSIFICATION}
    SELECT COUNT(*)::bigint AS total,
           COUNT(*) FILTER (WHERE state = 'available')::bigint AS available,
           COUNT(*) FILTER (WHERE state = 'low')::bigint AS low,
           COUNT(*) FILTER (WHERE state = 'out')::bigint AS out,
           COUNT(*) FILTER (WHERE state = 'unknown')::bigint AS unknown
    FROM classified_stock`);
  if (rows.length !== 1) throw new Error("Missing stock aggregate");
  const row = rows[0];
  const data = { total: count(row.total), available: count(row.available), low: count(row.low), out: count(row.out), unknown: count(row.unknown) };
  if (data.total !== data.available + data.low + data.out + data.unknown) throw new Error("Invalid stock partition");
  return data;
}
async function loadPromotions(): Promise<DashboardPromotionAlert[]> {
  // Frozen Phase 4: NULL start is open, ACTIVE is administrative, expiry is derived.
  const rows = await prisma.$queryRaw<DashboardPromotionAlert[]>(Prisma.sql`
    SELECT id::text AS id, name,
           to_char(end_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "endAt"
    FROM promotions WHERE deleted_at IS NULL AND status = 'ACTIVE'
      AND (start_at IS NULL OR start_at <= now())
      AND end_at > now() AND end_at <= now() + interval '7 days'
    ORDER BY end_at ASC, id ASC`);
  return rows.map(({ id, name, endAt }) => ({ id, name, endAt }));
}

export async function loadDashboardSnapshot(permissions: readonly string[], range: DashboardRange): Promise<DashboardData> {
  const can = (...keys: string[]) => keys.every((key) => permissions.includes(key));
  const [orderCounts, orderDetails, average, catalog, inventory, promotions] = await Promise.all([
    read(can("orders.view"), () => loadOrderCounts(range)),
    read(can("orders.view"), () => loadOrderDetails(range)),
    // E-3 closure: the average order value is the dashboard's FINANCIAL
    // aggregate, so it needs the reporting capability (`reports.view`) on top
    // of the order and the price capabilities. Without it the tile renders
    // "denied" — it never renders a zero and never leaks an amount.
    read(can("orders.view", "prices.view", "reports.view"), () => loadAverage(range)),
    read(can("products.view"), loadCatalog),
    read(can("products.view", "inventory.view"), loadInventory),
    read(can("promotions.view"), loadPromotions),
  ]);
  const orders: ReadResult<DashboardOrderData> = orderCounts.state !== "ready" ? orderCounts
    : orderDetails.state !== "ready" ? orderDetails
      : { state: "ready", data: { ...orderCounts.data, ...orderDetails.data } };
  const metrics = KPI_CONTRACTS.map(({ id }): DashboardMetric => {
    if (id === "sales-total") return blocked(id, "unavailable", "لا يسجل النظام مبالغ محصلة أو استردادات؛ إجمالي المبيعات غير متاح.");
    if (id === "order-average") return averageMetric(average);
    if (id.startsWith("orders-")) {
      if (orderCounts.state !== "ready") return blocked(id, orderCounts.state, orderCounts.note);
      const status = METRIC_STATUS[id];
      const row = orderCounts.data.byStatus.find((group) => group.status === status);
      const value = id === "orders-total" ? orderCounts.data.total : row!.count;
      const previous = id === "orders-total" ? orderCounts.data.previousTotal : row!.previous;
      return { id, state: "ready", value, previous, ...comparison(value, previous) };
    }
    if (id.startsWith("products-")) {
      if (catalog.state !== "ready") return blocked(id, catalog.state, catalog.note);
      const key = id.slice(9) as keyof CatalogCounts;
      return { id, state: "ready", value: catalog.data[key], previous: null, changePercent: null, note: CURRENT_ONLY };
    }
    if (inventory.state !== "ready") return blocked(id, inventory.state, inventory.note);
    return { id, state: "ready", value: inventory.data[id === "stock-low" ? "low" : "out"], previous: null, changePercent: null, note: CURRENT_ONLY };
  });
  return { range, capturedAt: new Date().toISOString(), metrics, orders, inventory, promotions };
}

interface StockPageRow {
  cursorValid: boolean;
  id: string | null;
  name: string | null;
  state: ProductStockState | null;
  variantCount: Count | null;
  knownCount: Count | null;
}
const STOCK_STATES: readonly ProductStockState[] = ["available", "low", "out", "unknown"];
const STOCK_CURSOR = /^(available|low|out|unknown):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** Caller must authorize BOTH products.view and inventory.view before calling.
 * Cursors are scoped as state:UUID; DB errors propagate, never masquerade as empty pages.
 */
export async function listDashboardStockProducts(status: ProductStockState, cursor: string | null, limit = 20): Promise<DashboardStockPage> {
  const invalid: DashboardStockPage = { rows: [], nextCursor: null, invalidCursor: true };
  if (!STOCK_STATES.includes(status)) return invalid;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError("Stock page limit must be 1–100");
  const parsed = cursor === null ? null : STOCK_CURSOR.exec(cursor);
  if (cursor !== null && (!parsed || parsed[1] !== status)) return invalid;
  const cursorId = parsed ? parsed[2].toLowerCase() : null;
  const raw = await prisma.$queryRaw<StockPageRow[]>(Prisma.sql`
    WITH ${STOCK_CLASSIFICATION}, cursor_scope AS (
      SELECT (${cursorId}::uuid IS NULL OR EXISTS (
        SELECT 1 FROM classified_stock WHERE id = ${cursorId}::uuid AND state = ${status}
      )) AS valid
    ), page AS (
      SELECT id, name, state, variant_count, known_count
      FROM classified_stock, cursor_scope
      WHERE cursor_scope.valid AND state = ${status} AND (${cursorId}::uuid IS NULL OR id > ${cursorId}::uuid)
      ORDER BY id ASC LIMIT ${limit + 1}
    )
    SELECT cursor_scope.valid AS "cursorValid", page.id::text AS id, page.name, page.state,
           page.variant_count AS "variantCount", page.known_count AS "knownCount"
    FROM cursor_scope LEFT JOIN page ON true ORDER BY page.id ASC`);
  if (raw.length === 0 || typeof raw[0].cursorValid !== "boolean") throw new Error("Missing cursor validation");
  if (!raw[0].cursorValid) return invalid;
  const products: DashboardStockProduct[] = raw.filter((row) => row.id !== null).map((row) => {
    if (row.name === null || row.state !== status || row.variantCount === null || row.knownCount === null) {
      throw new Error("Invalid stock page row");
    }
    return { id: row.id!, name: row.name, state: row.state, variantCount: count(row.variantCount), knownCount: count(row.knownCount) };
  });
  const rows = products.slice(0, limit);
  return { rows, nextCursor: products.length > limit ? `${status}:${rows[rows.length - 1].id}` : null, invalidCursor: false };
}
