// @vitest-environment node
// SQL construction only. Prisma is replaced by an in-memory mock; no execution.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
const m = vi.hoisted(() => ({ query: vi.fn(), users: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { $queryRaw: m.query, user: { findMany: m.users } } }));
import { listOrderQueue, type OrderQueueFilter } from "../admin-queue";
const cursor = "00000000-0000-4000-8000-000000000001";
const base: OrderQueueFilter = { limit: 2, cursor: null, status: "PREPARING", search: "0100", dateFrom: "2026-10-01T21:00:00Z", dateTo: null, dateBefore: "2026-10-03T21:00:00Z" };
const queryAt = (n: number) => {
  const [parts, ...values] = m.query.mock.calls[n];
  return Prisma.sql(parts, ...values);
};
beforeEach(() => { vi.resetAllMocks(); m.query.mockImplementation(() => { throw new Error("Unexpected read"); }); });

describe("ADM05 queue cursor validation and exact SQL anchor", () => {
  it.each(["bad", "", "1' OR 1=1", "00000000-0000-4000-8000-000000000001x"])("rejects %j before database access", async (bad) => {
    await expect(listOrderQueue({ ...base, cursor: bad })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(m.query).not.toHaveBeenCalled();
  });
  it("rejects a missing/nonmatching anchor instead of showing an empty/first page", async () => {
    m.query.mockResolvedValueOnce([]);
    await expect(listOrderQueue({ ...base, cursor })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(m.query).toHaveBeenCalledTimes(1);
    const anchor = queryAt(0);
    expect(anchor.sql).toContain("o.id = ?::uuid");
    expect(anchor.sql).toContain("o.status = ?");
    expect(anchor.sql).toContain("o.created_at >= ?::timestamptz");
    expect(anchor.sql).toContain("o.created_at < ?::timestamptz");
    expect(anchor.sql).not.toContain("o.created_at = (SELECT");
    expect(anchor.values).toEqual(expect.arrayContaining([cursor, "PREPARING", "%0100%", base.dateFrom, base.dateBefore]));
  });
  it("uses SQL microsecond anchor and created_at DESC/id ASC after same-filter validation", async () => {
    m.query.mockResolvedValueOnce([{ id: cursor }]).mockResolvedValueOnce([{ id: "a" }, { id: "b" }, { id: "c" }]);
    const result = await listOrderQueue({ ...base, cursor });
    expect(result).toEqual({ rows: [{ id: "a" }, { id: "b" }], nextCursor: "b" });
    const page = queryAt(1);
    expect(page.sql).toContain("o.created_at < (SELECT created_at FROM orders WHERE id = ?::uuid)");
    expect(page.sql).toContain("AND o.id > ?::uuid");
    expect(page.sql).toContain("ORDER BY o.created_at DESC, o.id ASC");
    expect(page.values.some((v) => v instanceof Date)).toBe(false);
    expect(page.values).toEqual(expect.arrayContaining(queryAt(0).values));
  });
  it("first page does not read an anchor and ends without a next cursor", async () => {
    m.query.mockResolvedValueOnce([{ id: cursor }]);
    expect(await listOrderQueue(base)).toEqual({ rows: [{ id: cursor }], nextCursor: null });
    expect(m.query).toHaveBeenCalledTimes(1);
  });
  it("failed cursor resolution returns validation for a filter-preserving restart", async () => {
    m.query.mockRejectedValueOnce(new Error("read unavailable"));
    await expect(listOrderQueue({ ...base, cursor })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(m.query).toHaveBeenCalledTimes(1);
  });
});
