import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { $queryRaw: db.query } }));
import { listAudit } from "../queries";
import { listOrderQueue } from "@/lib/orders/admin-queue";

beforeEach(() => { db.query.mockReset(); db.query.mockResolvedValue([]); });
function lastSql() {
  const [strings, ...values] = db.query.mock.calls.at(-1)!;
  return Prisma.sql(strings, ...values);
}
describe("date-filter parameterized SQL contracts (no database)", () => {
  it("orders retain microseconds with an exclusive next-day boundary", async () => {
    await listOrderQueue({ limit: 20, cursor: null, status: null, search: null, dateFrom: "2026-10-28T21:00:00.000Z", dateTo: null, dateBefore: "2026-10-29T22:00:00.000Z" });
    const sql = lastSql();
    expect(sql.text).toMatch(/o\.created_at >= \$\d+::timestamptz/);
    expect(sql.text).toMatch(/o\.created_at < \$\d+::timestamptz/);
    expect(sql.text).not.toContain("o.created_at <=");
    expect(sql.values).toContain("2026-10-29T22:00:00.000Z");
    expect(sql.text).not.toContain("2026-10-29");
  });
  it("audit retains microseconds with the same exclusive boundary", async () => {
    await listAudit({ limit: 20, cursor: null, userId: null, action: null, entityType: null, entityId: null, since: "2026-10-28T21:00:00.000Z", until: null, untilExclusive: "2026-10-29T22:00:00.000Z" });
    const sql = lastSql();
    expect(sql.text).toMatch(/created_at >= \$\d+::timestamptz/);
    expect(sql.text).toMatch(/created_at < \$\d+::timestamptz/);
    expect(sql.text).not.toContain("created_at <=");
    expect(sql.values).toContain("2026-10-29T22:00:00.000Z");
  });
});
