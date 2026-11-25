// Phase 11 mutation-adapter tests: cancel/replacement decision timeouts must
// never be reported as success or as a definite failure. The adapter re-reads
// the authoritative order snapshot and only reports success when the expected
// server state is observed; otherwise the outcome stays explicitly unknown.
import { afterEach, describe, expect, it, vi } from "vitest";

const jar: Array<{ name: string; value: string }> = [];
let host: string | null = "localhost:3210";

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({
    get: (key: string) => {
      if (key === "host") return host;
      return null;
    },
  }),
  cookies: vi.fn().mockResolvedValue({
    getAll: () => jar,
    get: (name: string) => jar.find((c) => c.name === name),
    set: () => undefined,
  }),
}));

import { cancelOrderAction, decideReplacementAction } from "@/app/actions/orders";

const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const REPLACEMENT_ID = "22222222-2222-4222-8222-222222222222";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const ORDER_STATE = (status: string) => ({ data: { order: { id: ORDER_ID, status } } });

describe("cancelOrderAction", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    jar.length = 0;
    host = "localhost:3210";
  });

  it("reports success only for a confirmed 2xx backend response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ data: { order: { status: "CANCELLED" } } })));
    const res = await cancelOrderAction(ORDER_ID);
    expect(res).toEqual({ ok: true });
  });

  it("reconciles a transport timeout by reading CANCELLED from the server", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("aborted", "AbortError"))
      .mockResolvedValueOnce(jsonResponse(ORDER_STATE("CANCELLED")))
      .mockResolvedValueOnce(jsonResponse({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await cancelOrderAction(ORDER_ID);
    expect(res).toEqual({ ok: true, reconciled: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("keeps the outcome unknown when the server still shows the old state", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("aborted", "AbortError"))
      .mockResolvedValueOnce(jsonResponse(ORDER_STATE("CONFIRMED")))
      .mockResolvedValueOnce(jsonResponse({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await cancelOrderAction(ORDER_ID);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.ambiguous).toBe(true);
      expect(res.code).toBe("TRANSPORT");
      expect(res.message).toContain("لم نتمكن من تأكيد نتيجة الإلغاء");
    }
  });

  it("keeps the outcome unknown when reconciliation cannot be read", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("aborted", "AbortError"))
      .mockRejectedValueOnce(new Error("read failed"));
    vi.stubGlobal("fetch", fetchMock);
    const res = await cancelOrderAction(ORDER_ID);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.ambiguous).toBe(true);
  });

  it("maps a confirmed 409 to its Arabic conflict copy (no ambiguity)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ error: { code: "CONFLICT", message: "Order cannot be cancelled." } }, 409),
      ),
    );
    const res = await cancelOrderAction(ORDER_ID);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("CONFLICT");
      expect(res.ambiguous).toBeUndefined();
      expect(res.message).toContain("لم يعد الإجراء متاحًا");
    }
  });

  it("forwards the order-scoped guest credential as a header, never in the result", async () => {
    jar.push({ name: `guest-order-${ORDER_ID}`, value: "a".repeat(64) });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { order: { status: "CANCELLED" } } }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await cancelOrderAction(ORDER_ID);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["x-guest-order-token"]).toBe("a".repeat(64));
    expect(JSON.stringify(res)).not.toContain("a".repeat(64));
  });
});

describe("decideReplacementAction", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    jar.length = 0;
  });

  it("reconciles a timeout when the server shows the requested rejection", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("aborted", "AbortError"))
      .mockResolvedValueOnce(jsonResponse(ORDER_STATE("CONFIRMED")))
      .mockResolvedValueOnce(
        jsonResponse({ data: [{ id: REPLACEMENT_ID, status: "CUSTOMER_REJECTED" }] }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const res = await decideReplacementAction(ORDER_ID, REPLACEMENT_ID, "reject");
    expect(res).toEqual({ ok: true, reconciled: true });
  });

  it("does not claim success when the server shows a different decision", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("aborted", "AbortError"))
      .mockResolvedValueOnce(jsonResponse(ORDER_STATE("CONFIRMED")))
      .mockResolvedValueOnce(
        jsonResponse({ data: [{ id: REPLACEMENT_ID, status: "CUSTOMER_REJECTED" }] }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const res = await decideReplacementAction(ORDER_ID, REPLACEMENT_ID, "approve");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("CONFLICT");
  });

  it("keeps the outcome unknown while the proposal is still open", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("aborted", "AbortError"))
      .mockResolvedValueOnce(jsonResponse(ORDER_STATE("CONFIRMED")))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: REPLACEMENT_ID, status: "PROPOSED" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await decideReplacementAction(ORDER_ID, REPLACEMENT_ID, "approve");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.ambiguous).toBe(true);
      expect(res.message).toContain("لم نتمكن من تأكيد نتيجة القرار");
    }
  });

  it("rejects malformed identifiers before any network call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await decideReplacementAction("not-a-uuid", REPLACEMENT_ID, "approve");
    expect(res.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
