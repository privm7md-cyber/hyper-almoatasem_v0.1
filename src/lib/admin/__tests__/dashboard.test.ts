import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { KPI_CONTRACTS, type DashboardData, type KpiId, type ProductStockState } from "../dashboard-contract";
import { resolveDashboardRange } from "../date-range";

const { queryRaw } = vi.hoisted(() => ({ queryRaw: vi.fn() }));
// The entire DB singleton is replaced BEFORE importing the loader: no adapter,
// credentials, connection, or live database access is possible in this suite.
vi.mock("@/lib/db", () => ({ prisma: { $queryRaw: queryRaw } }));
import { listDashboardStockProducts, loadDashboardSnapshot } from "../dashboard";

const permissions = ["orders.view", "prices.view", "reports.view", "products.view", "inventory.view", "promotions.view"];
const now = new Date("2026-11-12T10:00:00.000Z");
const range = resolveDashboardRange({ range: "7d" }, now).range;
const sql = (query: Prisma.Sql) => query.text.replace(/\s+/g, " ").trim();
type QueryKind = "counts" | "daily" | "recent" | "average" | "catalog" | "stock" | "page" | "promotions";
function kind(query: Prisma.Sql): QueryKind {
  const text = sql(query);
  if (text.includes("FROM cursor_scope LEFT JOIN page")) return "page";
  if (text.includes("FROM averages c")) return "average";
  if (text.includes("FROM windows w JOIN orders o")) return "counts";
  if (text.includes("AT TIME ZONE 'Africa/Cairo'")) return "daily";
  if (text.includes('order_number AS "orderNumber"')) return "recent";
  if (text.includes("FROM classified_stock")) return "stock";
  if (text.includes("FROM promotions")) return "promotions";
  if (text.endsWith("FROM products")) return "catalog";
  throw new Error(`Unexpected fixture SQL: ${text}`);
}
const queries = (name: QueryKind): Prisma.Sql[] => queryRaw.mock.calls.map(([query]) => query as Prisma.Sql).filter((query) => kind(query) === name);
const metric = (data: DashboardData, id: KpiId) => data.metrics.find((entry) => entry.id === id)!;
const emptyAverage = () => ({
  deliveredCount: BigInt(0), finalCount: BigInt(0), average: null,
  previousDeliveredCount: BigInt(0), previousFinalCount: BigInt(0), previousAverage: null, changePercent: null,
});
let counts: { period: string; status: string; count: bigint | string | number }[];
let daily: { day: string; count: bigint }[];
let recent: { id: string; orderNumber: string; status: string; createdAt: string }[];
let average: ReturnType<typeof emptyAverage> | Record<string, unknown>;
let catalog: { displayed: bigint; hidden: bigint; archived: bigint }[];
let stock: Record<string, bigint>[];
let promotions: { id: string; name: string; endAt: string }[];
let failures: Set<QueryKind>;
let missingAggregates: Set<QueryKind>;
let pageOverride: unknown[] | null;

interface VariantFixture { active?: boolean; deleted?: boolean; available: string | null; threshold: string | null }
interface ProductFixture { id: string; name: string; active?: boolean; deleted?: boolean; variants: VariantFixture[] }
const uuid = (number: number) => `00000000-0000-4000-8000-${number.toString().padStart(12, "0")}`;
const decimal = (value: string) => {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  const result = BigInt(whole) * BigInt(1000) + BigInt(fraction.padEnd(3, "0"));
  return negative ? -result : result;
};
// Independent exact-decimal fixture oracle. Structural assertions below pin
// the production SQL predicates too; these tests do not execute PostgreSQL.
function fixtureProducts(products: ProductFixture[]) {
  return products.filter((product) => product.active !== false && !product.deleted).map((product) => {
    const variants = product.variants.filter((variant) => variant.active !== false && !variant.deleted);
    const known = variants.filter((variant) => variant.available !== null);
    const positive = known.filter((variant) => decimal(variant.available!) > BigInt(0));
    const complete = known.length === variants.length;
    const low = complete && positive.length > 0 && positive.every((variant) =>
      variant.threshold !== null && decimal(variant.available!) <= decimal(variant.threshold));
    const state: ProductStockState = positive.length > 0 ? low ? "low" : "available"
      : variants.length > 0 && complete ? "out" : "unknown";
    return { id: product.id, name: product.name, state, variantCount: variants.length, knownCount: known.length };
  }).sort((a, b) => a.id.localeCompare(b.id));
}
let products: ProductFixture[];
function fixturePage(query: Prisma.Sql) {
  const state = query.values.find((value) => ["available", "low", "out", "unknown"].includes(value as string)) as ProductStockState;
  const cursor = query.values.find((value) => typeof value === "string" && /^[0-9a-f-]{36}$/.test(value)) as string | undefined;
  const limit = query.values[query.values.length - 1] as number;
  const classified = fixtureProducts(products);
  const cursorValid = !cursor || classified.some((product) => product.id === cursor && product.state === state);
  const rows = cursorValid ? classified.filter((product) => product.state === state && (!cursor || product.id > cursor)).slice(0, limit) : [];
  return rows.length > 0 ? rows.map((row) => ({ ...row, cursorValid }))
    : [{ cursorValid, id: null, name: null, state: null, variantCount: null, knownCount: null }];
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  counts = []; daily = []; recent = []; average = emptyAverage();
  catalog = [{ displayed: BigInt(0), hidden: BigInt(0), archived: BigInt(0) }];
  stock = [{ total: BigInt(0), available: BigInt(0), low: BigInt(0), out: BigInt(0), unknown: BigInt(0) }];
  promotions = []; products = []; failures = new Set(); missingAggregates = new Set(); pageOverride = null;
  queryRaw.mockReset();
  queryRaw.mockImplementation(async (query: Prisma.Sql) => {
    const name = kind(query);
    if (failures.has(name)) throw new Error("Fixture read failure (not an empty database)");
    if (missingAggregates.has(name)) return [];
    return { counts, daily, recent, average: [average], catalog, stock, promotions,
      page: pageOverride ?? (name === "page" ? fixturePage(query) : []),
    }[name];
  });
});
afterEach(() => vi.useRealTimers());

describe("permission isolation and source states", () => {
  it("returns the exact 14-contract order, never zero for denied sources, and does no queries without permissions", async () => {
    const data = await loadDashboardSnapshot([], range);
    expect(data.metrics.map((entry) => entry.id)).toEqual(KPI_CONTRACTS.map((entry) => entry.id));
    expect(data.metrics).toHaveLength(14);
    expect(data.metrics.every((entry) => entry.value === null && entry.previous === null && entry.changePercent === null)).toBe(true);
    expect(data.metrics.filter((entry) => entry.id !== "sales-total").every((entry) => entry.state === "denied")).toBe(true);
    expect(metric(data, "sales-total").state).toBe("unavailable");
    expect([data.orders.state, data.inventory.state, data.promotions.state]).toEqual(["denied", "denied", "denied"]);
    expect(queryRaw).not.toHaveBeenCalled();
    expect(data.range).toBe(range);
    expect(data.capturedAt).toBe(now.toISOString());
  });
  it.each([
    ["orders.view", ["counts", "daily", "recent"]],
    ["prices.view", []], ["products.view", ["catalog"]],
    ["inventory.view", []], ["promotions.view", ["promotions"]],
    ["customers.view", []], ["coupons.view", []],
  ])("queries only permitted sources for %s", async (permission, expected) => {
    await loadDashboardSnapshot([permission as string], range);
    expect(queryRaw.mock.calls.map(([query]) => kind(query))).toEqual(expected);
    if (permission !== "prices.view") {
      for (const [query] of queryRaw.mock.calls) expect(sql(query)).not.toMatch(/total_final|total_estimated|customer_|phone|delivery_/);
    }
  });
  it("requires BOTH order and price permissions before reading any amount", async () => {
    const denied = await loadDashboardSnapshot(["orders.view"], range);
    expect(metric(denied, "order-average").state).toBe("denied");
    expect(queries("average")).toHaveLength(0);
    await loadDashboardSnapshot(["orders.view", "prices.view"], range);
    expect(queries("average")).toHaveLength(0);
  });
  it("E-3: the financial aggregate also needs `reports.view` (the reporting capability)", async () => {
    // Without the reporting capability the amount tile is DENIED — never zero
    // and never a partially revealed number.
    const denied = await loadDashboardSnapshot(["orders.view", "prices.view"], range);
    expect(metric(denied, "order-average").state).toBe("denied");
    expect(metric(denied, "order-average").value).toBeNull();
    expect(queries("average")).toHaveLength(0);
    // Adding the reporting capability restores the read.
    await loadDashboardSnapshot(["orders.view", "prices.view", "reports.view"], range);
    expect(queries("average")).toHaveLength(1);
  });
  it("requires BOTH product and inventory permissions for stock", async () => {
    for (const permission of ["products.view", "inventory.view"]) {
      const data = await loadDashboardSnapshot([permission], range);
      expect(data.inventory.state).toBe("denied");
      expect(metric(data, "stock-low").value).toBeNull();
      expect(metric(data, "stock-out").value).toBeNull();
    }
    expect(queries("stock")).toHaveLength(0);
    expect((await loadDashboardSnapshot(["products.view", "inventory.view"], range)).inventory.state).toBe("ready");
    expect(queries("stock")).toHaveLength(1);
  });
  it("proves empty counts as zero but empty AOV and collected sales remain unavailable", async () => {
    const data = await loadDashboardSnapshot(permissions, range);
    expect(metric(data, "orders-total")).toMatchObject({ state: "ready", value: 0, previous: 0, changePercent: 0 });
    expect(metric(data, "products-displayed")).toMatchObject({ state: "ready", value: 0, previous: null });
    expect(metric(data, "order-average")).toMatchObject({ state: "unavailable", value: null, previous: null });
    expect(metric(data, "sales-total")).toMatchObject({ state: "unavailable", value: null });
    expect(data.inventory).toEqual({ state: "ready", data: { total: 0, available: 0, low: 0, out: 0, unknown: 0 } });
    expect(data.promotions).toEqual({ state: "ready", data: [] });
    expect(queryRaw).toHaveBeenCalledTimes(7);
  });
  it.each(["counts", "daily", "recent", "average", "catalog", "stock", "promotions"] as const)("isolates %s read errors without reporting zeros or losing unrelated sources", async (failed) => {
    failures.add(failed);
    const data = await loadDashboardSnapshot(permissions, range);
    if (["counts", "daily", "recent"].includes(failed)) expect(data.orders).toMatchObject({ state: "error", data: null });
    else expect(data.orders.state).toBe("ready");
    const failedId = failed === "counts" ? "orders-total" : failed === "average" ? "order-average"
      : failed === "catalog" ? "products-displayed" : failed === "stock" ? "stock-low" : null;
    if (failedId) expect(metric(data, failedId)).toMatchObject({ state: "error", value: null, previous: null, changePercent: null });
    if (failed !== "counts") expect(metric(data, "orders-total").state).toBe("ready");
    expect(data.inventory.state).toBe(failed === "stock" ? "error" : "ready");
    expect(data.promotions.state).toBe(failed === "promotions" ? "error" : "ready");
    expect(queryRaw).toHaveBeenCalledTimes(7);
    expect(JSON.stringify(data)).not.toContain("Fixture read failure");
  });
  it.each(["average", "catalog", "stock"] as const)("does not manufacture zero from a missing %s aggregate row", async (failed) => {
    missingAggregates.add(failed);
    const data = await loadDashboardSnapshot(permissions, range);
    expect(metric(data, failed === "average" ? "order-average" : failed === "catalog" ? "products-displayed" : "stock-low").state).toBe("error");
  });
  it.each([null, "not-a-count", -1, 0.5, "9007199254740992"])("rejects malformed/unsafe order counts: %s", async (bad) => {
    counts = [{ period: "current", status: "NEW", count: bad as unknown as number }];
    const data = await loadDashboardSnapshot(["orders.view"], range);
    expect(metric(data, "orders-total")).toMatchObject({ state: "error", value: null });
  });
});

describe("selected order windows and narrow projections", () => {
  it("retains all seven official statuses and unknown statuses in the denominator without double-counting the NEW alias", async () => {
    const statuses = ["NEW", "CONFIRMED", "PREPARING", "READY_FOR_DELIVERY", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED", "FUTURE_STATE"];
    counts = statuses.map((status, index) => ({ period: "current", status, count: BigInt(index + 1) }));
    counts.push({ period: "previous", status: "NEW", count: BigInt(2) }, { period: "previous", status: "LEGACY", count: BigInt(3) });
    const data = await loadDashboardSnapshot(["orders.view"], range);
    expect(metric(data, "orders-total")).toMatchObject({ value: 36, previous: 5, changePercent: 620 });
    expect(metric(data, "orders-new").value).toBe(1);
    expect(metric(data, "orders-awaiting")).toEqual({ ...metric(data, "orders-new"), id: "orders-awaiting" });
    expect(metric(data, "orders-completed").value).toBe(6);
    expect(metric(data, "orders-cancelled").value).toBe(7);
    expect(data.orders.state).toBe("ready");
    if (data.orders.state === "ready") {
      expect(data.orders.data.byStatus).toHaveLength(9);
      expect(data.orders.data.byStatus.find((row) => row.status === "FUTURE_STATE")).toEqual({ status: "FUTURE_STATE", count: 8, previous: 0 });
      expect(data.orders.data.byStatus.find((row) => row.status === "LEGACY")).toEqual({ status: "LEGACY", count: 0, previous: 3 });
    }
    expect(sql(queries("counts")[0])).not.toMatch(/status\s+(IN|=)|SUM\(/);
  });
  it.each([[0, 0, 0], [2, 0, null], [0, 2, -100], [3, 2, 50]])("compares count %s to %s as %s", async (current, previous, changePercent) => {
    if (current) counts.push({ period: "current", status: "NEW", count: BigInt(current) });
    if (previous) counts.push({ period: "previous", status: "NEW", count: BigInt(previous) });
    const data = await loadDashboardSnapshot(["orders.view"], range);
    expect(metric(data, "orders-total").changePercent).toBe(changePercent);
    expect(metric(data, "orders-total").note === null).toBe(changePercent !== null);
  });
  it.each([
    { range: "today" }, { range: "previous-month" },
    { range: "custom", from: "2026-10-29", to: "2026-10-29" },
  ])("passes the exact supplied ISO-string windows and identical elapsed comparison, including Cairo DST: %j", async (params) => {
    const selected = resolveDashboardRange(params, now).range;
    await loadDashboardSnapshot(["orders.view", "prices.view", "reports.view"], selected);
    const expected = [selected.start, selected.endExclusive, selected.previousStart, selected.previousEndExclusive];
    for (const name of ["counts", "average"] as const) {
      const query = queries(name)[0];
      expect(query.values).toEqual(expected);
      expect(query.values.every((value) => typeof value === "string")).toBe(true);
      expect(sql(query).match(/::timestamptz/g)).toHaveLength(4);
      expect(sql(query)).toContain("o.created_at >= w.start_at AND o.created_at < w.end_at");
    }
    expect(Date.parse(selected.endExclusive) - Date.parse(selected.start)).toBe(Date.parse(selected.previousEndExclusive) - Date.parse(selected.previousStart));
    if (params.range === "custom") expect(Date.parse(selected.endExclusive) - Date.parse(selected.start)).toBe(25 * 60 * 60 * 1000);
    for (const name of ["daily", "recent"] as const) expect(queries(name)[0].values).toEqual(expected.slice(0, 2));
  });
  it("uses Cairo calendar grouping and fills proven-empty days, without timestamp decoding", async () => {
    daily = [{ day: range.fromDay, count: BigInt(2) }, { day: range.toDay, count: BigInt(1) }];
    const data = await loadDashboardSnapshot(["orders.view"], range);
    if (data.orders.state !== "ready") throw new Error("Expected fixture orders");
    expect(data.orders.data.daily).toHaveLength(7);
    expect(data.orders.data.daily[0]).toEqual({ day: range.fromDay, count: 2 });
    expect(data.orders.data.daily[1].count).toBe(0);
    expect(data.orders.data.daily[6]).toEqual({ day: range.toDay, count: 1 });
    expect(sql(queries("daily")[0])).toContain("to_char(created_at AT TIME ZONE 'Africa/Cairo', 'YYYY-MM-DD') AS day");
    expect(sql(queries("daily")[0])).toMatch(/created_at >= \$\d+::timestamptz AND created_at < \$\d+::timestamptz/);
  });
  it("selects only the six most recent current-window IDs/numbers/statuses and UTC strings; no PII or amounts", async () => {
    recent = [{ id: uuid(1), orderNumber: "ORD-1", status: "NEW", createdAt: "2026-11-11T22:10:05.123Z" }];
    const data = await loadDashboardSnapshot(["orders.view"], range);
    if (data.orders.state !== "ready") throw new Error("Expected fixture orders");
    expect(data.orders.data.recent).toEqual(recent);
    expect(Object.keys(data.orders.data.recent[0])).toEqual(["id", "orderNumber", "status", "createdAt"]);
    const text = sql(queries("recent")[0]);
    expect(text).toContain('SELECT id::text AS id, order_number AS "orderNumber", status, to_char(created_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "createdAt"');
    expect(text).toContain("ORDER BY created_at DESC, id DESC LIMIT 6");
    expect(text).not.toMatch(/SELECT \*|customer|phone|total_|amount|Date/);
  });
});

describe("delivered AOV and catalog semantics", () => {
  it("keeps SQL-rounded decimal strings exact and uses SQL decimal comparison, not JS sums", async () => {
    average = { deliveredCount: BigInt(2), finalCount: BigInt(2), average: "99999999.99", previousDeliveredCount: BigInt(1),
      previousFinalCount: BigInt(1), previousAverage: "99999999.98", changePercent: "0.00" };
    const data = await loadDashboardSnapshot(["orders.view", "prices.view", "reports.view"], range);
    expect(metric(data, "order-average")).toMatchObject({ state: "ready", value: "99999999.99", previous: "99999999.98", changePercent: 0 });
    const text = sql(queries("average")[0]);
    expect(text).toContain("ROUND(AVG(o.total_final), 2)");
    expect(text).toContain("c.average::text AS average");
    expect(text).toContain("COUNT(o.id) = COUNT(o.total_final)");
    expect(text).toContain("o.status = 'DELIVERED'");
    expect(text).toContain("ROUND((c.average - p.average) / p.average * 100, 2)::text");
    expect(text).not.toMatch(/float8|total_estimated|payment|refund/);
  });
  it("honors the SQL half-cent rounded average and allows a genuine zero delivered average", async () => {
    average = { deliveredCount: BigInt(2), finalCount: BigInt(2), average: "10.01", previousDeliveredCount: BigInt(1),
      previousFinalCount: BigInt(1), previousAverage: "10.00", changePercent: "0.10" };
    expect(metric(await loadDashboardSnapshot(["orders.view", "prices.view", "reports.view"], range), "order-average").value).toBe("10.01");
    average = { deliveredCount: BigInt(1), finalCount: BigInt(1), average: "0.00", previousDeliveredCount: BigInt(1),
      previousFinalCount: BigInt(1), previousAverage: "0.00", changePercent: "0" };
    expect(metric(await loadDashboardSnapshot(["orders.view", "prices.view", "reports.view"], range), "order-average")).toMatchObject({ state: "ready", value: "0.00", changePercent: 0 });
  });
  it("makes AOV unavailable if ANY delivered final is NULL, instead of averaging the known subset", async () => {
    average = { ...emptyAverage(), deliveredCount: BigInt(3), finalCount: BigInt(2), average: null };
    const data = await loadDashboardSnapshot(["orders.view", "prices.view", "reports.view"], range);
    expect(metric(data, "order-average")).toMatchObject({ state: "unavailable", value: null, previous: null, changePercent: null });
    expect(metric(data, "order-average").note).toMatch(/النهائي/);
  });
  it.each([
    { previousDeliveredCount: BigInt(0), previousFinalCount: BigInt(0), previousAverage: null },
    { previousDeliveredCount: BigInt(2), previousFinalCount: BigInt(1), previousAverage: null },
    { previousDeliveredCount: BigInt(1), previousFinalCount: BigInt(1), previousAverage: "0.00" },
  ])("keeps a valid current AOV with unavailable comparison: %s", async (previous) => {
    average = { ...emptyAverage(), deliveredCount: BigInt(1), finalCount: BigInt(1), average: "12.34", ...previous };
    const entry = metric(await loadDashboardSnapshot(["orders.view", "prices.view", "reports.view"], range), "order-average");
    expect(entry).toMatchObject({ state: "ready", value: "12.34", changePercent: null });
    expect(entry.previous).toBe(previous.previousAverage);
    expect(entry.note).not.toBeNull();
  });
  it("reports malformed decimal data as error, not ready/unavailable zero", async () => {
    average = { ...emptyAverage(), deliveredCount: BigInt(1), finalCount: BigInt(1), average: "NaN" };
    expect(metric(await loadDashboardSnapshot(["orders.view", "prices.view", "reports.view"], range), "order-average")).toMatchObject({ state: "error", value: null });
  });
  it("uses three exclusive current catalog buckets, with no invented historical comparison", async () => {
    catalog = [{ displayed: BigInt(12), hidden: BigInt(4), archived: BigInt(3) }];
    const data = await loadDashboardSnapshot(["products.view"], range);
    for (const [id, value] of [["products-displayed", 12], ["products-hidden", 4], ["products-archived", 3]] as const) {
      expect(metric(data, id)).toMatchObject({ state: "ready", value, previous: null, changePercent: null });
      expect(metric(data, id).note).not.toBeNull();
    }
    const text = sql(queries("catalog")[0]);
    expect(text).toContain("WHERE is_active = true AND deleted_at IS NULL");
    expect(text).toContain("WHERE is_active = false AND deleted_at IS NULL");
    expect(text).toContain("WHERE deleted_at IS NOT NULL");
    expect(queries("catalog")[0].values).toEqual([]);
    expect(text).not.toMatch(/created_at|history|variant|category|brand/);
  });
});

describe("disjoint product stock and scoped keyset drilldown", () => {
  function mixedStockFixtures() {
    const variants: VariantFixture[][] = [
      [{ available: "0.001", threshold: "0.001" }], // exact decimal equality = low
      [{ available: "0.001", threshold: "0.000" }], // any tiny positive above threshold = available
      [{ available: "2.000", threshold: "3.000" }, { available: "0.000", threshold: null }], // low; zero need not have threshold
      [{ available: "2.000", threshold: "3.000" }, { available: null, threshold: "5.000" }], // incomplete + positive = available
      [{ available: "0.000", threshold: null }, { available: "-1.001", threshold: null }], // complete nonpositive = out
      [{ available: null, threshold: null }], // missing inventory OR NULL generated balance = unknown
      [], // no active variants = unknown
      [{ available: "1.000", threshold: null }], // positive without threshold = available
      [{ available: "1.000", threshold: "2.000" }, { available: "5.000", threshold: "3.000" }], // above threshold mixed with low = available
      [{ available: "0.000", threshold: null }, { available: null, threshold: null }], // unknown, never out
      [{ available: "0.000", threshold: null }, { available: "99.000", threshold: null, active: false }, { available: "99.000", threshold: null, deleted: true }], // inactive/deleted ignored = out
    ];
    products = variants.map((rows, index) => ({ id: uuid(index + 1), name: `Product ${index + 1}`, variants: rows }));
    products.push({ id: uuid(12), name: "Hidden", active: false, variants: variants[0] }, { id: uuid(13), name: "Archived", deleted: true, variants: variants[0] });
    const classified = fixtureProducts(products);
    stock = [{ total: BigInt(classified.length), available: BigInt(0), low: BigInt(0), out: BigInt(0), unknown: BigInt(0) }];
    for (const product of classified) stock[0][product.state]++;
    return classified;
  }
  it("counts displayed PRODUCTS, not inventory/variants, as a complete disjoint partition", async () => {
    const classified = mixedStockFixtures();
    const data = await loadDashboardSnapshot(["products.view", "inventory.view"], range);
    expect(data.inventory).toEqual({ state: "ready", data: { total: 11, available: 4, low: 2, out: 2, unknown: 3 } });
    expect(classified.map((product) => product.state)).toEqual(["low", "available", "low", "available", "out", "unknown", "unknown", "available", "available", "unknown", "out"]);
    expect(metric(data, "stock-low")).toMatchObject({ value: 2, previous: null, changePercent: null });
    expect(metric(data, "stock-out").value).toBe(2);
    const text = sql(queries("stock")[0]);
    expect(text).toContain("LEFT JOIN product_variants v ON v.product_id = p.id AND v.is_active = true AND v.deleted_at IS NULL");
    expect(text).toContain("LEFT JOIN inventory i ON i.product_variant_id = v.id");
    expect(text).toContain("WHERE p.is_active = true AND p.deleted_at IS NULL");
    expect(text).toContain("COUNT(v.id)::bigint AS variant_count");
    expect(text).toContain("COUNT(i.available_quantity)::bigint AS known_count");
    expect(text).toContain("i.available_quantity > 0 AND (i.low_stock_threshold IS NULL OR i.available_quantity > i.low_stock_threshold)");
    expect(text).toContain("CASE WHEN positive_count > 0 THEN CASE WHEN known_count = variant_count AND above_threshold_count = 0 THEN 'low' ELSE 'available' END WHEN variant_count > 0 AND known_count = variant_count THEN 'out' ELSE 'unknown' END AS state");
    expect(text).toContain("COUNT(*) FILTER (WHERE state = 'unknown')::bigint AS unknown FROM classified_stock");
    expect(text).not.toMatch(/float8|SUM\(|COALESCE\(i\.|quantity -|price|customer/);
    expect(queries("stock")).toHaveLength(1);
  });
  it("rejects inconsistent aggregate partitions rather than fabricating a count", async () => {
    stock = [{ total: BigInt(3), available: BigInt(1), low: BigInt(1), out: BigInt(1), unknown: BigInt(1) }];
    expect((await loadDashboardSnapshot(["products.view", "inventory.view"], range)).inventory.state).toBe("error");
  });
  it.each(["available", "low", "out", "unknown"] as const)("uses the IDENTICAL SQL classifier for the %s page and narrow product fields", async (state) => {
    const classified = mixedStockFixtures();
    await loadDashboardSnapshot(["products.view", "inventory.view"], range);
    const page = await listDashboardStockProducts(state, null);
    expect(page).toEqual({ rows: classified.filter((product) => product.state === state), nextCursor: null, invalidCursor: false });
    expect(Object.keys(page.rows[0])).toEqual(["id", "name", "state", "variantCount", "knownCount"]);
    const inventorySql = sql(queries("stock")[0]);
    const pageSql = sql(queries("page")[0]);
    expect(inventorySql.split(" SELECT COUNT(*)::bigint AS total")[0]).toBe(pageSql.split(", cursor_scope AS (")[0]);
    expect(pageSql).toContain("ORDER BY id ASC LIMIT");
    expect(pageSql).not.toMatch(/OFFSET|float8|price|amount|customer/);
    expect(queries("page")).toHaveLength(1);
    expect(queries("page")[0].values.at(-1)).toBe(21);
  });
  it("paginates by ascending product ID with no duplicates, using the last returned row rather than the lookahead", async () => {
    mixedStockFixtures();
    const first = await listDashboardStockProducts("available", null, 2);
    expect(first.rows.map((row) => row.id)).toEqual([uuid(2), uuid(4)]);
    expect(first.nextCursor).toBe(`available:${uuid(4)}`);
    const second = await listDashboardStockProducts("available", first.nextCursor, 2);
    expect(second.rows.map((row) => row.id)).toEqual([uuid(8), uuid(9)]);
    expect(second.nextCursor).toBeNull();
    expect(second.invalidCursor).toBe(false);
    expect(queries("page")).toHaveLength(2);
    expect(sql(queries("page")[1])).toMatch(/id > \$\d+::uuid/);
  });
  it.each(["", "garbage", uuid(1), `low:not-uuid`, `out:${uuid(1)}`, `available:${uuid(1)}`])("flags missing-scope/malformed/foreign-status cursor %s without querying", async (cursor) => {
    expect(await listDashboardStockProducts("low", cursor)).toEqual({ rows: [], nextCursor: null, invalidCursor: true });
    expect(queryRaw).not.toHaveBeenCalled();
  });
  it.each([99, 2, 12, 13])("flags syntactically valid but missing/foreign/hidden/archived cursor product %s", async (id) => {
    mixedStockFixtures();
    expect(await listDashboardStockProducts("low", `low:${uuid(id)}`)).toEqual({ rows: [], nextCursor: null, invalidCursor: true });
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(sql(queries("page")[0])).toMatch(/EXISTS \( SELECT 1 FROM classified_stock WHERE id = \$\d+::uuid AND state = \$\d+/);
  });
  it("distinguishes a genuine empty/end page from an invalid cursor", async () => {
    expect(await listDashboardStockProducts("unknown", null)).toEqual({ rows: [], nextCursor: null, invalidCursor: false });
    mixedStockFixtures();
    expect(await listDashboardStockProducts("low", `low:${uuid(3)}`)).toEqual({ rows: [], nextCursor: null, invalidCursor: false });
  });
  it("does not swallow drilldown read failures into false empty pages", async () => {
    failures.add("page");
    await expect(listDashboardStockProducts("low", null)).rejects.toThrow("Fixture read failure");
    failures.clear(); missingAggregates.add("page");
    await expect(listDashboardStockProducts("low", null)).rejects.toThrow("Missing cursor validation");
  });
  it.each([0, -1, 1.5, 101, NaN, Infinity])("rejects invalid page limit %s before reading", async (limit) => {
    await expect(listDashboardStockProducts("low", null, limit)).rejects.toThrow(RangeError);
    expect(queryRaw).not.toHaveBeenCalled();
  });
});

describe("frozen promotion time semantics", () => {
  it("queries only nondeleted ACTIVE promotions effective NOW and expiring within seven days, preserving actual UTC endAt", async () => {
    promotions = [{ id: uuid(70), name: "Real expiring promotion", endAt: "2026-11-18T22:15:30.125Z" }];
    const data = await loadDashboardSnapshot(["promotions.view"], range);
    expect(data.promotions).toEqual({ state: "ready", data: promotions });
    const query = queries("promotions")[0];
    const text = sql(query);
    expect(text).toContain("deleted_at IS NULL AND status = 'ACTIVE'");
    expect(text).toContain("(start_at IS NULL OR start_at <= now())");
    expect(text).toContain("end_at > now() AND end_at <= now() + interval '7 days'");
    expect(text).toContain('to_char(end_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "endAt"');
    expect(text).toContain("ORDER BY end_at ASC, id ASC");
    expect(query.values).toEqual([]); // SQL clock, not JS now or selected range.
    expect(text).not.toMatch(/DRAFT|DISABLED|COUNT\(|LIMIT|amount|percent|coupon|SELECT \*/);
  });
});
