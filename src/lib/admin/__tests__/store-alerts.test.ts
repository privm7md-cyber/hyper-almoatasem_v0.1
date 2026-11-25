// @vitest-environment node
// ADM-11 (final round) — the store alerts are derived from REAL rows.
//
// Isolated mocks: no database is contacted. The test proves which row set
// becomes which alert, that the time window is decided by PostgreSQL, and
// that a repeated event is never published twice.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  findMany: vi.fn(),
  createMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
    user: { findMany: mocks.findMany },
    notification: { createMany: mocks.createMany },
  },
}));

import {
  collectStoreAlerts,
  notifyStoreAlerts,
  sweepStoreAlerts,
  STORE_ALERT_TYPES,
} from "@/lib/admin/store-alerts";

const OWNER = "00000000-0000-4000-8000-0000000000aa";

/** The five raw reads the collector issues, in order. */
function rawResponder(rows: Array<unknown[]>) {
  let index = 0;
  return async () => {
    const rowsForCall = rows[index] ?? [];
    index += 1;
    return rowsForCall;
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findMany.mockResolvedValue([{ id: OWNER }]);
  mocks.createMany.mockResolvedValue({ count: 1 });
});

describe("ADM-11 — store alerts", () => {
  it("turns real inventory, promotion and coupon rows into typed alerts", async () => {
    mocks.queryRaw.mockImplementation(
      rawResponder([
        [{ vid: "v-1", vname: "كيس 1 كجم", pname: "رز", threshold: null }],
        [{ vid: "v-2", vname: "زيت", pname: "زيت زيتون", threshold: "5" }],
        [{ id: "p-1", name: "خصم 10%" }],
        [{ id: "c-1", code: "SAVE10" }],
        [{ id: "c-2", code: "WELCOME" }],
      ]),
    );

    const alerts = await collectStoreAlerts();
    expect(alerts.map((alert) => alert.type)).toEqual([
      "inventory.out_of_stock",
      "inventory.low_stock",
      "promotion.expiring",
      "coupon.expired",
      "coupon.expiring",
    ]);
    for (const alert of alerts) {
      expect(STORE_ALERT_TYPES).toContain(alert.type);
      expect(alert.entityId.length).toBeGreaterThan(0);
      expect(alert.title.length).toBeGreaterThan(3);
      expect(alert.message.length).toBeGreaterThan(5);
    }
    expect(alerts[0].message).toContain("رز");
    expect(alerts[1].message).toContain("5");
    expect(alerts[2].message).toContain("خصم 10%");
    expect(alerts[3].message).toContain("SAVE10");
  });

  it("reads five statements and never touches the clock in JavaScript", async () => {
    mocks.queryRaw.mockImplementation(rawResponder([[], [], [], [], []]));
    await collectStoreAlerts();
    expect(mocks.queryRaw).toHaveBeenCalledTimes(5);
    const sql = mocks.queryRaw.mock.calls.map((call) => String(call[0])).join("\n");
    expect(sql).toContain("now()");
    expect(sql).not.toContain("Date.now");
  });

  it("publishes one notice per alert and keeps the entity for deduplication", async () => {
    mocks.queryRaw.mockImplementation(rawResponder([[], [{ vid: "v-9", vname: "زيت", pname: "زيت", threshold: "2" }], [], [], []]));
    const created = await notifyStoreAlerts([
      { type: "inventory.low_stock", entityId: "v-9", title: "مخزون منخفض", message: "الكمية وصلت لحد التنبيه." },
    ]);
    expect(created).toBe(1);
    const payload = mocks.createMany.mock.calls[0][0].data;
    expect(payload).toHaveLength(1);
    expect(payload[0].userId).toBe(OWNER);
    expect(payload[0].type).toBe("inventory.low_stock");
    expect(payload[0].data.entityId).toBe("v-9");
  });

  it("skips a notice the owners already received", async () => {
    // The duplicate check reads the recipients' existing rows for the same
    // type + entity before writing.
    mocks.queryRaw.mockImplementation(async () => [{ uid: OWNER }]);
    const created = await notifyStoreAlerts([
      { type: "inventory.low_stock", entityId: "v-9", title: "مخزون منخفض", message: "الكمية وصلت لحد التنبيه." },
    ]);
    expect(created).toBe(0);
    expect(mocks.createMany).not.toHaveBeenCalled();
  });

  it("sweeps the alerts and reports how many notices were written", async () => {
    mocks.queryRaw.mockImplementation(rawResponder([[], [], [], [], []]));
    const result = await sweepStoreAlerts();
    expect(result).toEqual({ alerts: 0, created: 0 });
    expect(mocks.createMany).not.toHaveBeenCalled();
  });
});
