// @vitest-environment node
// ADM-11 (final round) — the sweep endpoint is a mutation and is gated as one.
//
// Isolated mocks: the route is exercised without a database and without a
// session; the gate decides the outcome.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  denyAll: vi.fn(),
  previewWrite: vi.fn(),
  sweep: vi.fn(),
}));

vi.mock("@/lib/api/route-auth", () => ({ denyUnlessAll: mocks.denyAll }));
vi.mock("@/lib/auth/admin-read-only-preview", () => ({ assertAdminPreviewWritesAllowed: mocks.previewWrite }));
vi.mock("@/lib/admin/store-alerts", () => ({ sweepStoreAlerts: mocks.sweep }));

import { POST as sweepRoute } from "../sweep/route";
import { ApiError } from "@/lib/api/errors";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.previewWrite.mockReturnValue(undefined);
  mocks.denyAll.mockResolvedValue(null);
  mocks.sweep.mockResolvedValue({ alerts: 3, created: 2 });
});

describe("ADM-11 — notification sweep route", () => {
  it("publishes the store alerts for an authorised admin", async () => {
    const response = await sweepRoute();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { alerts: 3, created: 2 } });
    expect(mocks.denyAll).toHaveBeenCalledWith(["inventory.view", "promotions.view"]);
  });

  it("refuses the write in the read-only preview before any effect", async () => {
    mocks.previewWrite.mockImplementation(() => {
      throw new ApiError("FORBIDDEN", "Admin read-only preview.");
    });
    const response = await sweepRoute();
    expect(response.status).toBe(403);
    expect(mocks.sweep).not.toHaveBeenCalled();
    expect(mocks.denyAll).not.toHaveBeenCalled();
  });

  it("returns the guard answer unchanged when a permission is missing", async () => {
    const denied = new Response(JSON.stringify({ error: { code: "FORBIDDEN" } }), { status: 403 });
    mocks.denyAll.mockResolvedValue(denied);
    expect(await sweepRoute()).toBe(denied);
    expect(mocks.sweep).not.toHaveBeenCalled();
  });

  it("reports a read failure as a server error instead of an empty result", async () => {
    mocks.sweep.mockRejectedValue(new Error("db down"));
    const response = await sweepRoute();
    expect(response.status).toBe(500);
  });
});
