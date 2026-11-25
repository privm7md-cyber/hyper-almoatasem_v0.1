import { describe, expect, it } from "vitest";
import { addCalendarDays, calendarDayAt, cairoDayBounds, readCalendarDay, resolveDashboardRange } from "../date-range";
import { KPI_CONTRACTS, metricHref } from "../dashboard-contract";

const now = new Date("2026-11-12T10:00:00Z");
describe("Cairo calendar range contracts", () => {
  it.each([
    ["2026-04-24", "2026-04-23T22:00:00.000Z", "2026-04-24T21:00:00.000Z", 23],
    ["2026-10-29", "2026-10-28T21:00:00.000Z", "2026-10-29T22:00:00.000Z", 25],
    ["2026-11-12", "2026-11-11T22:00:00.000Z", "2026-11-12T22:00:00.000Z", 24],
  ])("uses exact half-open bounds for %s", (day, start, end, hours) => {
    const bounds = cairoDayBounds(day as string);
    expect(bounds.start.toISOString()).toBe(start);
    expect(bounds.endExclusive.toISOString()).toBe(end);
    expect((bounds.endExclusive.getTime() - bounds.start.getTime()) / 3_600_000).toBe(hours);
    expect(calendarDayAt(new Date(bounds.start.getTime() - 1))).toBe(addCalendarDays(day as string, -1));
    expect(calendarDayAt(bounds.start)).toBe(day);
    expect(calendarDayAt(new Date(bounds.endExclusive.getTime() - 1))).toBe(day);
    expect(calendarDayAt(bounds.endExclusive)).toBe(addCalendarDays(day as string, 1));
  });
  it.each(["2026-02-29", "2026-04-31", "2026-13-01", "2026-00-01", "not-a-date", "2026-1-01", "0000-01-01", "9999-12-31", ["2026-11-12"], undefined])("rejects invalid boundary input %j", value => {
    expect(readCalendarDay(value)).toBeNull();
  });
  it("accepts leap days and crosses year and month boundaries", () => {
    expect(readCalendarDay("2024-02-29")).toBe("2024-02-29");
    expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addCalendarDays("2024-03-01", -1)).toBe("2024-02-29");
  });
  it.each([
    ["today", "2026-11-12", "2026-11-12", 1],
    ["yesterday", "2026-11-11", "2026-11-11", 1],
    ["7d", "2026-11-06", "2026-11-12", 7],
    ["30d", "2026-10-14", "2026-11-12", 30],
    ["month", "2026-11-01", "2026-11-12", 12],
    ["previous-month", "2026-10-01", "2026-10-31", 31],
  ])("resolves %s without mixing periods", (preset, from, to, days) => {
    const { range, error } = resolveDashboardRange({ range: preset as string }, now);
    expect(error).toBeNull();
    expect([range.fromDay, range.toDay, range.dayCount]).toEqual([from, to, days]);
    expect(Date.parse(range.endExclusive) - Date.parse(range.start)).toBe(Date.parse(range.previousEndExclusive) - Date.parse(range.previousStart));
    expect(range.previousEndExclusive).toBe(range.start);
  });
  it.each(["2026-04-24", "2026-10-29"])("compares equal elapsed windows even on DST day %s", day => {
    const { range, error } = resolveDashboardRange({ range: "custom", from: day, to: day }, now);
    expect(error).toBeNull();
    expect(Date.parse(range.endExclusive) - Date.parse(range.start)).toBe(Date.parse(range.previousEndExclusive) - Date.parse(range.previousStart));
  });
  it.each([
    { range: "custom", from: "2026-11-13", to: "2026-11-12" },
    { range: "custom", from: "2026-02-30", to: "2026-11-12" },
    { range: "custom", from: "2025-01-01", to: "2026-01-02" },
    { range: "custom" },
  ])("returns an explicit error for invalid custom range %j", params => {
    expect(resolveDashboardRange(params, now).error).not.toBeNull();
  });
  it("defaults unrecognized or repeated presets to seven days", () => {
    expect(resolveDashboardRange({ range: "WRONG" }, now).range.preset).toBe("7d");
    expect(resolveDashboardRange({ range: ["today", "yesterday"] }, now).range.preset).toBe("7d");
  });
  it("defines fourteen unique metrics and maps drills to their true scopes", () => {
    expect(KPI_CONTRACTS).toHaveLength(14);
    expect(new Set(KPI_CONTRACTS.map(item => item.id)).size).toBe(14);
    const { range } = resolveDashboardRange({ range: "today" }, now);
    expect(metricHref("orders-awaiting", range)).toBe(metricHref("orders-new", range));
    expect(metricHref("orders-completed", range)).toContain("status=DELIVERED");
    expect(metricHref("order-average", range)).toContain("status=DELIVERED");
    expect(metricHref("products-archived", range)).toBe("/admin/products?state=archived");
    expect(metricHref("stock-low", range)).toBe("/admin/inventory/product-status?status=low");
    expect(metricHref("stock-out", range)).toBe("/admin/inventory/product-status?status=out");
    expect(metricHref("sales-total", range)).toBeNull();
  });
});
