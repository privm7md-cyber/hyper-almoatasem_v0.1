// @vitest-environment node
// In-memory transaction doubles only; no Prisma client construction or DB access.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";

const m = vi.hoisted(() => ({ transaction: vi.fn(), lock: vi.fn(), find: vi.fn(), update: vi.fn(), audit: vi.fn(), preview: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { $transaction: m.transaction } }));
vi.mock("@/lib/api/audit", () => ({ auditInTx: m.audit }));
vi.mock("@/lib/auth/admin-read-only-preview", () => ({ assertAdminPreviewWritesAllowed: m.preview }));
import { lifecycleInputSchema, transitionProduct, type LifecycleInput } from "../lifecycle";

const ID = "00000000-0000-4000-8000-000000000001";
const TOKEN = "2026-11-12T10:00:00.000Z";
const NEXT = "2026-11-12T10:01:00.000Z";
const input: LifecycleInput = { confirmed: true, reason: "  مراجعة الكتالوج  ", expectedUpdatedAt: TOKEN };
let row: { id: string; deletedAt: Date | null; isActive: boolean; updatedAt: Date };
const tx = { $queryRaw: m.lock, product: { findUnique: m.find, update: m.update } };

beforeEach(() => {
  vi.resetAllMocks();
  row = { id: ID, deletedAt: null, isActive: true, updatedAt: new Date(TOKEN) };
  m.lock.mockResolvedValue([{ id: ID }]);
  m.find.mockImplementation(async () => ({ ...row }));
  m.update.mockImplementation(async ({ data }) => ({ ...row, ...data, updatedAt: new Date(NEXT) }));
  // Commit a provisional update only when the full callback (including audit)
  // resolves; this verifies pairing with the supplied tx, not live DB rollback.
  m.transaction.mockImplementation(async (callback) => {
    const result = await callback(tx);
    if (m.update.mock.calls.length) row = { ...row, ...m.update.mock.calls.at(-1)![0].data, updatedAt: new Date(NEXT) };
    return result;
  });
});

describe("product lifecycle narrow transitions", () => {
  it.each([true, false])("archives nonarchived active=%s without dependent writes", async (active) => {
    row.isActive = active;
    const result = await transitionProduct(ID, "archive", input, "server-actor");
    expect(result).toMatchObject({ id: ID, isActive: false, updatedAt: NEXT, alreadyApplied: false });
    expect(Date.parse(result.deletedAt!)).toBeGreaterThan(0);
    expect(m.lock.mock.calls[0][0].join("?")).toMatch(/products WHERE id = \?::uuid FOR UPDATE/);
    expect(m.lock.mock.calls[0].slice(1)).toEqual([ID]);
    expect(m.lock.mock.invocationCallOrder[0]).toBeLessThan(m.find.mock.invocationCallOrder[0]);
    expect(m.find.mock.invocationCallOrder[0]).toBeLessThan(m.update.mock.invocationCallOrder[0]);
    expect(m.update).toHaveBeenCalledWith({ where: { id: ID }, data: { deletedAt: expect.any(Date), isActive: false }, select: { id: true, deletedAt: true, isActive: true, updatedAt: true } });
    expect(m.audit).toHaveBeenCalledExactlyOnceWith(tx, {
      action: "products.archive", userId: "server-actor", entityType: "products", entityId: ID,
      oldValues: { deletedAt: null, isActive: active }, newValues: { deletedAt: result.deletedAt, isActive: false }, reason: "مراجعة الكتالوج",
    });
  });
  it("restores archived product hidden with exact before/after audit", async () => {
    row.deletedAt = new Date("2026-11-11T10:00:00Z"); row.isActive = false;
    const result = await transitionProduct(ID, "restore", input, "actor");
    expect(result).toEqual({ id: ID, deletedAt: null, isActive: false, updatedAt: NEXT, alreadyApplied: false });
    expect(m.update.mock.calls[0][0].data).toEqual({ deletedAt: null, isActive: false });
    expect(m.audit.mock.calls[0]).toEqual([tx, { action: "products.restore", userId: "actor", entityType: "products", entityId: ID,
      oldValues: { deletedAt: "2026-11-11T10:00:00.000Z", isActive: false }, newValues: { deletedAt: null, isActive: false }, reason: "مراجعة الكتالوج" }]);
  });
  it.each(["archive", "restore"] as const)("safe current-token %s repeat is stable and unaudited", async (operation) => {
    row.isActive = false; row.deletedAt = operation === "archive" ? new Date(TOKEN) : null;
    const first = await transitionProduct(ID, operation, input, "actor");
    const second = await transitionProduct(ID, operation, input, "actor");
    expect(first).toEqual(second); expect(first.alreadyApplied).toBe(true);
    expect(first.updatedAt).toBe(TOKEN); expect(m.update).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
  });
  it("does not hide an already-restored but now published product", async () => {
    await expect(transitionProduct(ID, "restore", input, "actor")).rejects.toMatchObject({ code: "CONFLICT" });
    expect(m.update).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
  });
  it.each(["archive", "restore"] as const)("rejects stale version for %s even when final state matches", async (operation) => {
    row.isActive = false; row.deletedAt = operation === "archive" ? new Date(TOKEN) : null;
    await expect(transitionProduct(ID, operation, { ...input, expectedUpdatedAt: NEXT }, "actor")).rejects.toMatchObject({ code: "CONFLICT", details: { currentUpdatedAt: TOKEN } });
    expect(m.update).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
  });
  it("accepts a timestamp with the same instant and an explicit offset", async () => {
    await expect(transitionProduct(ID, "archive", { ...input, expectedUpdatedAt: "2026-11-12T12:00:00+02:00" }, "actor")).resolves.toMatchObject({ alreadyApplied: false });
  });
  it("does not permit a second original-token mutation after confirmed archive", async () => {
    await transitionProduct(ID, "archive", input, "actor");
    await expect(transitionProduct(ID, "restore", input, "actor")).rejects.toMatchObject({ code: "CONFLICT" });
    expect(m.update).toHaveBeenCalledTimes(1); expect(m.audit).toHaveBeenCalledTimes(1);
  });
  it.each(["lock", "find"])("missing product at %s is NOT_FOUND without writes", async (stage) => {
    if (stage === "lock") m.lock.mockResolvedValue([]); else m.find.mockResolvedValue(null);
    await expect(transitionProduct(ID, "archive", input, "actor")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(m.update).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
  });
  it("audit failure rejects and prevents the transaction double committing", async () => {
    const before = { ...row }; m.audit.mockRejectedValue(new Error("audit unavailable"));
    await expect(transitionProduct(ID, "archive", input, "actor")).rejects.toThrow("audit unavailable");
    expect(row).toEqual(before); expect(m.audit.mock.calls[0][0]).toBe(tx);
  });
  it("write failure cannot produce an audit", async () => {
    m.update.mockRejectedValue(new Error("write unavailable"));
    await expect(transitionProduct(ID, "archive", input, "actor")).rejects.toThrow("write unavailable");
    expect(m.audit).not.toHaveBeenCalled();
  });
  it("preview veto runs before transaction, lock, read or audit", async () => {
    m.preview.mockImplementation(() => { throw new ApiError("FORBIDDEN", "Admin read-only preview."); });
    await expect(transitionProduct(ID, "archive", input, "actor")).rejects.toMatchObject({ code: "FORBIDDEN" });
    for (const fn of [m.transaction, m.lock, m.find, m.update, m.audit]) expect(fn).not.toHaveBeenCalled();
  });
});

describe("lifecycle values fail before effects", () => {
  it.each([
    { confirmed: false }, { confirmed: undefined }, { reason: " " }, { reason: "x".repeat(501) },
    { reason: null }, { expectedUpdatedAt: undefined }, { expectedUpdatedAt: "*" }, { expectedUpdatedAt: "nonsense" },
    { expectedUpdatedAt: "2026-11-12" }, { expectedUpdatedAt: null }, { actorId: "untrusted" }, { isActive: true }, { deletedAt: null },
  ])("rejects $confirmed $reason $expectedUpdatedAt and unknown fields", async (patch) => {
    const value = { ...input, ...patch };
    expect(lifecycleInputSchema.safeParse(value).success).toBe(false);
    await expect(transitionProduct(ID, "archive", value as LifecycleInput, "actor")).rejects.toMatchObject({ code: "VALIDATION" });
    expect(m.transaction).not.toHaveBeenCalled();
  });
});
