// Phase 07 (P07-T01) — cart-lines store tests. Contract-level service tests with a
// mocked apiRequest (no network, no DB): snapshot parsing, the identity ladder,
// per-line single flight, the send-order (stale-response) rule, held publishes,
// and the confirmed-space ops (+ aggregate POST / PATCH absolute / DELETE at 1).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/frontend/api-client";

const h = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  token: vi.fn<() => string | null>(() => null),
  writeToken: vi.fn(),
  clearToken: vi.fn(),
}));

vi.mock("@/lib/frontend/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/frontend/api-client")>();
  return { ...actual, apiRequest: h.apiRequest };
});

vi.mock("@/components/store/guest-cart-token", () => ({
  readGuestCartToken: h.token,
  writeGuestCartToken: h.writeToken,
  clearGuestCartToken: h.clearToken,
}));

import {
  cartLineForProduct,
  publishCartSnapshot,
  resetCartStore,
  useCartLinesStore,
} from "@/lib/frontend/cart-lines-store";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A full-cart wire shape (serialize.ts subset). */
function cartOf(lines: Array<Record<string, unknown>>): unknown {
  return { lines };
}

function line(over: Partial<Record<string, string | null>> & { productVariantId: string; quantity: string }) {
  return {
    productId: "p-x",
    productName: "منتج",
    variantName: "صنف",
    productType: "PIECE",
    lineTotal: null,
    ...over,
  };
}

const EXACTLY_ONE = new AppError("VALIDATION", "Exactly one of guest token / customer session is required.");

beforeEach(() => {
  h.apiRequest.mockReset();
  h.token.mockReset();
  h.token.mockReturnValue(null);
  h.writeToken.mockReset();
  h.clearToken.mockReset();
  resetCartStore();
});

describe("cart-lines store — mount probe (sync)", () => {
  it("applies a confirmed full-cart snapshot (server text preserved verbatim)", async () => {
    h.apiRequest.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url === "/api/store/cart" && !init?.method) {
        return { data: { cart: cartOf([line({ productVariantId: "v-1", quantity: "0.500" })]) } };
      }
      throw new Error(`unexpected ${url} ${init?.method ?? ""}`);
    });
    await useCartLinesStore.getState().sync();
    const s = useCartLinesStore.getState();
    expect(s.syncLoaded).toBe(true);
    expect(s.syncError).toBeNull();
    expect(s.lines["v-1"]?.quantity).toBe("0.500");
    expect(s.lines["v-1"]?.productId).toBe("p-x");
  });

  it("identity-less / no-active-cart probe results apply the honest empty truth", async () => {
    h.apiRequest.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url === "/api/store/cart" && !init?.method) {
        return { data: { cart: cartOf([line({ productVariantId: "v-1", quantity: "2" })]) } };
      }
      throw new Error(`unexpected ${url}`);
    });
    await useCartLinesStore.getState().sync();
    expect(useCartLinesStore.getState().lines["v-1"]).toBeTruthy();

    // Fresh visitor (no identity): VALIDATION → empty truth, token not touched.
    h.apiRequest.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url === "/api/store/cart" && !init?.method) throw EXACTLY_ONE;
      throw new Error(`unexpected ${url}`);
    });
    await useCartLinesStore.getState().sync();
    expect(useCartLinesStore.getState().lines).toEqual({});
    expect(h.clearToken).not.toHaveBeenCalled();

    // Stale token + VALIDATION (both sides / bad token): empty truth + token cleared ONCE, same as CartView.
    h.token.mockReturnValue("a".repeat(64));
    await useCartLinesStore.getState().sync();
    expect(useCartLinesStore.getState().lines).toEqual({});
    expect(h.clearToken).toHaveBeenCalledTimes(1);

    // 404 (no ACTIVE cart): empty truth without touching identity (the earlier
    // VALIDATION step cleared it exactly once).
    h.token.mockReturnValue("b".repeat(64));
    h.apiRequest.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url === "/api/store/cart" && !init?.method) throw new AppError("NOT_FOUND", "Active cart not found.");
      throw new Error(`unexpected ${url}`);
    });
    await useCartLinesStore.getState().sync();
    expect(useCartLinesStore.getState().lines).toEqual({});
    expect(h.clearToken).toHaveBeenCalledTimes(1); // NOT_FOUND does not clear identity
  });

  it("transport/server probe failures surface syncError and never fabricate cart lines", async () => {
    h.apiRequest.mockImplementation(async () => {
      throw new TypeError("offline");
    });
    await useCartLinesStore.getState().sync();
    const s = useCartLinesStore.getState();
    expect(s.syncError).not.toBeNull();
    expect(s.lines).toEqual({});
  });
});

describe("cart-lines store — confirmed ops (card + stepper contract)", () => {
  it("addPack sends POST quantity '1' (aggregates) and adopts the confirmed line", async () => {
    h.apiRequest.mockImplementation(async (url: string, init?: { method?: string; body?: unknown }) => {
      if (url === "/api/store/cart/items" && init?.method === "POST") {
        expect(init.body).toMatchObject({ productVariantId: "v-1", quantity: "1" });
        return { data: { cart: cartOf([line({ productVariantId: "v-1", quantity: "3" })]) } };
      }
      throw new Error(`unexpected ${url}`);
    });
    const res = await useCartLinesStore.getState().addPack("v-1");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.line?.quantity).toBe("3");
    expect(useCartLinesStore.getState().lines["v-1"]?.quantity).toBe("3");
    expect(useCartLinesStore.getState().ops["v-1"]).toBeUndefined();
  });

  it("a second tap while the line op is inflight is rejected with no second request", async () => {
    const d = deferred<unknown>();
    h.apiRequest.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === "/api/store/cart/items" && init?.method === "POST") return d.promise;
      throw new Error(`unexpected ${url}`);
    });
    const p1 = useCartLinesStore.getState().addPack("v-1");
    const p2 = await useCartLinesStore.getState().addPack("v-1");
    expect(p2).toEqual({ ok: false, error: null, duplicatedRejected: true });
    const itemsCalls = h.apiRequest.mock.calls.filter(
      (c) => c[0] === "/api/store/cart/items",
    ).length;
    expect(itemsCalls).toBe(1);
    d.resolve({ data: { cart: cartOf([line({ productVariantId: "v-1", quantity: "1" })]) } });
    const r1 = await p1;
    expect(r1.ok).toBe(true);
    expect(useCartLinesStore.getState().ops["v-1"]).toBeUndefined();
  });

  it("an in-cart + step uses POST aggregate; − uses PATCH absolute; − at 1 uses DELETE", async () => {
    // Start in cart: v-1 qty 2 (published from a confirmed response).
    publishCartSnapshot(cartOf([line({ productVariantId: "v-1", quantity: "2" })]));
    expect(useCartLinesStore.getState().ops).toEqual({});

    h.apiRequest.mockImplementation(async (url: string, init?: { method?: string; body?: unknown }) => {
      const q = String(Number(init?.body && typeof init.body === "object" ? (init.body as { quantity?: string }).quantity : NaN));
      if (url === "/api/store/cart/items" && init?.method === "POST") {
        return { data: { cart: cartOf([line({ productVariantId: "v-1", quantity: q === "1" ? "3" : "2" })]) } };
      }
      if (url === "/api/store/cart/items/v-1" && init?.method === "PATCH") {
        return { data: { cart: cartOf([line({ productVariantId: "v-1", quantity: (init.body as { quantity: string }).quantity })]) } };
      }
      if (url === "/api/store/cart/items/v-1" && init?.method === "DELETE") {
        return { data: { cart: cartOf([]) } };
      }
      throw new Error(`unexpected ${url} ${init?.method ?? ""}`);
    });

    await useCartLinesStore.getState().addPack("v-1");
    expect(useCartLinesStore.getState().lines["v-1"]?.quantity).toBe("3");

    await useCartLinesStore.getState().setQuantity("v-1", "2");
    expect(useCartLinesStore.getState().lines["v-1"]?.quantity).toBe("2");

    await useCartLinesStore.getState().removeLine("v-1");
    expect(useCartLinesStore.getState().lines["v-1"]).toBeUndefined();
  });

  it("setQuantity is ABSOLUTE (never incremental): PATCH body is the exact requested value", async () => {
    const bodies: Array<unknown> = [];
    h.apiRequest.mockImplementation(async (url: string, init?: { method?: string; body?: unknown }) => {
      if (url === "/api/store/cart/items/v-1" && init?.method === "PATCH") {
        bodies.push(init.body);
        return { data: { cart: cartOf([line({ productVariantId: "v-1", quantity: (init.body as { quantity: string }).quantity })]) } };
      }
      throw new Error(`unexpected ${url}`);
    });
    await useCartLinesStore.getState().setQuantity("v-1", "2");
    expect(bodies).toEqual([{ quantity: "2" }]);
  });
});

describe("cart-lines store — response order + publish rules (stale-protection)", () => {
  it("a LATE response for an earlier-sent op is discarded (never overwrites newer truth) and a reconcile probe converges", async () => {
    const dA = deferred<unknown>();
    // Op A (older send) — delayed response with a snapshot that LACKS op B's line.
    h.apiRequest.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url === "/api/store/cart/items/v-1" && init?.method === "PATCH") return dA.promise;
      if (url === "/api/store/cart/items/v-2" && init?.method === "PATCH") {
        return { data: { cart: cartOf([line({ productVariantId: "v-2", quantity: "5" })]) } };
      }
      if (url === "/api/store/cart" && !init?.method) {
        // Reconcile probe: merged server truth (both lines).
        return {
          data: {
            cart: cartOf([
              line({ productVariantId: "v-1", quantity: "3" }),
              line({ productVariantId: "v-2", quantity: "5" }),
            ]),
          },
        };
      }
      throw new Error(`unexpected ${url}`);
    });

    const pA = useCartLinesStore.getState().setQuantity("v-1", "3");
    const pB = useCartLinesStore.getState().setQuantity("v-2", "5");
    await pB;
    expect(useCartLinesStore.getState().lines["v-2"]?.quantity).toBe("5");

    // The late, older response arrives now: it must NOT regress the store.
    dA.resolve({ data: { cart: cartOf([line({ productVariantId: "v-1", quantity: "3" })]) } });
    await pA;
    expect(useCartLinesStore.getState().lines["v-2"]?.quantity).toBe("5"); // newer truth intact

    // The discard scheduled a reconcile probe — the store converges to merged truth.
    const s = useCartLinesStore.getState();
    if (s._probeQueued) await s.sync();
    await vi.waitFor(() => {
      expect(useCartLinesStore.getState().lines["v-1"]?.quantity).toBe("3");
      expect(useCartLinesStore.getState().lines["v-2"]?.quantity).toBe("5");
    });
  });

  it("publishCartSnapshot while a store op is inflight is HELD and converges via the settle probe", async () => {
    // One flexible impl: the add is delayed; the reconcile probe (whenever it runs)
    // returns the merged server truth.
    const dPost: { promise: Promise<unknown>; resolve: (v: unknown) => void } = deferred();
    h.apiRequest.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url === "/api/store/cart/items" && init?.method === "POST") return dPost.promise;
      if (url === "/api/store/cart" && !init?.method) {
        return {
          data: {
            cart: cartOf([
              line({ productVariantId: "v-1", quantity: "1" }),
              line({ productVariantId: "v-9", quantity: "7" }),
            ]),
          },
        };
      }
      throw new Error(`unexpected ${url}`);
    });
    const p = useCartLinesStore.getState().addPack("v-1");
    // A publisher (PDP/cart page) sends its own confirmed snapshot mid-op.
    publishCartSnapshot(cartOf([line({ productVariantId: "v-9", quantity: "7" })]));
    expect(useCartLinesStore.getState().lines["v-9"]).toBeUndefined(); // held, not applied
    expect(useCartLinesStore.getState()._probeQueued).toBe(true);

    dPost.resolve({ data: { cart: cartOf([line({ productVariantId: "v-1", quantity: "1" })]) } });
    await p;
    // The op's own response applied v-1; the settle probe brings the v-9 line.
    expect(useCartLinesStore.getState().lines["v-1"]?.quantity).toBe("1");
    await vi.waitFor(() => {
      expect(useCartLinesStore.getState().lines["v-9"]?.quantity).toBe("7");
    });
  });

  it("publishCartSnapshot with no inflight ops applies immediately; a malformed publish never corrupts state and bounds the probe", async () => {
    h.apiRequest.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url === "/api/store/cart" && !init?.method) {
        return { data: { cart: cartOf([line({ productVariantId: "v-1", quantity: "1" })]) } };
      }
      throw new Error(`unexpected ${url}`);
    });
    publishCartSnapshot(cartOf([line({ productVariantId: "v-1", quantity: "1" })]));
    expect(useCartLinesStore.getState().lines["v-1"]?.quantity).toBe("1");

    // Malformed publish (line missing its variant id): never applied, previous
    // confirmed truth stays VERBATIM, syncError is surfaced (no probe was run —
    // publish does not fire requests; a probe loop here would be unbounded).
    publishCartSnapshot({ lines: [{}] });
    expect(useCartLinesStore.getState().lines["v-1"]?.quantity).toBe("1");
    expect(useCartLinesStore.getState().syncError).not.toBeNull();
  });
});

describe("cart-lines store — identity ladder (contract-exact, no invented endpoints)", () => {
  it("stale guest token + VALIDATION both-sides: clear once, retry WITHOUT the header (session side); no mint", async () => {
    h.token.mockReturnValue("c".repeat(64));
    let call = 0;
    h.apiRequest.mockImplementation(async (url: string, init?: { method?: string; headers?: Record<string, string> }) => {
      if (url === "/api/store/cart/items" && init?.method === "POST") {
        call += 1;
        if (call === 1) {
          throw EXACTLY_ONE;
        }
        // Second attempt must carry NO guest-token header (session side resolves).
        expect(init?.headers).toBeUndefined();
        return { data: { cart: cartOf([line({ productVariantId: "v-1", quantity: "1" })]) } };
      }
      throw new Error(`unexpected ${url}`);
    });
    const res = await useCartLinesStore.getState().addPack("v-1");
    expect(res.ok).toBe(true);
    expect(h.clearToken).toHaveBeenCalledTimes(1);
    expect(h.writeToken).not.toHaveBeenCalled(); // no mint endpoint was used
  });

  it("fresh visitor: mint-once-then-retry writes the minted token and retries WITH it", async () => {
    let itemsCalls = 0;
    h.apiRequest.mockImplementation(async (url: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) => {
      if (url === "/api/store/cart/items" && init?.method === "POST") {
        itemsCalls += 1;
        if (itemsCalls === 1) throw EXACTLY_ONE;
        expect(init?.headers).toMatchObject({ "x-guest-token": "d".repeat(64) });
        return { data: { cart: cartOf([line({ productVariantId: "v-1", quantity: "1" })]) } };
      }
      if (url === "/api/store/cart" && init?.method === "POST") {
        return { data: { cart: cartOf([]), guestToken: "d".repeat(64) } };
      }
      throw new Error(`unexpected ${url}`);
    });
    const res = await useCartLinesStore.getState().addPack("v-1");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.line?.quantity).toBe("1");
    expect(useCartLinesStore.getState().lines["v-1"]?.quantity).toBe("1");
    expect(useCartLinesStore.getState()._probeQueued).toBe(false);
    expect(h.writeToken).toHaveBeenCalledWith("d".repeat(64));
    expect(itemsCalls).toBe(2);
  });

  it("a failed second identity attempt surfaces the error once (no loops, no state lies)", async () => {
    h.token.mockReturnValue("e".repeat(64));
    h.apiRequest.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url === "/api/store/cart/items" && init?.method === "POST") {
        throw EXACTLY_ONE; // both attempts fail: first with header, retry without
      }
      throw new Error(`unexpected ${url}`);
    });
    const res = await useCartLinesStore.getState().addPack("v-1");
    expect(res.ok).toBe(false);
    if (!res.ok && "error" in res) expect(res.error?.code).toBe("VALIDATION");
    expect(useCartLinesStore.getState().ops["v-1"]).toBeUndefined();
    expect(useCartLinesStore.getState().lines).toEqual({});
  });
});

describe("cart-lines store — P09 uncertainty policy (timeout/transport/verification)", () => {
  it("an un-parsed failure (transport TypeError) is UNCERTAIN: no success, no fake failure, ONE reconcile probe, no write resend", async () => {
    publishCartSnapshot(cartOf([line({ productVariantId: "v-1", quantity: "2" })]));
    let writes = 0;
    h.apiRequest.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url === "/api/store/cart/items/v-1" && init?.method === "PATCH") {
        writes += 1;
        throw new TypeError("offline");
      }
      if (url === "/api/store/cart" && !init?.method) {
        // Reconcile GET: the server truth shows the (hypothetical) applied op.
        return { data: { cart: cartOf([line({ productVariantId: "v-1", quantity: "5" })]) } };
      }
      throw new Error(`unexpected ${url} ${init?.method ?? ""}`);
    });
    const res = await useCartLinesStore.getState().setQuantity("v-1", "7");
    expect(res.ok).toBe(false);
    if (res.ok || "duplicatedRejected" in res) throw new Error("unexpected result shape");
    expect(res.uncertain).toBe(true); // never shades unknown as definitive failure
    // A raw (mocked) transport throw is never normalized into a code — the
    // uncertainty itself is the public result; production apiRequest always
    // wraps these as AppError INTERNAL.
    expect(res.error).toBeNull();
    expect(writes).toBe(1); // a second write is NEVER auto-sent (P09 §6.1)
    await vi.waitFor(() => {
      // One reconcile read converges the display to server truth.
      expect(useCartLinesStore.getState().lines["v-1"]?.quantity).toBe("5");
      expect(useCartLinesStore.getState()._probeQueued).toBe(false);
    });
  });

  it("an INTERNAL AppError (timeout/abort/5xx) is uncertain too — same policy", async () => {
    publishCartSnapshot(cartOf([line({ productVariantId: "v-1", quantity: "2" })]));
    let writes = 0;
    h.apiRequest.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url === "/api/store/cart/items" && init?.method === "POST") {
        writes += 1;
        throw new AppError("INTERNAL", "أُلغي الطلب."); // timeout/abort shape
      }
      if (url === "/api/store/cart" && !init?.method) {
        return { data: { cart: cartOf([line({ productVariantId: "v-1", quantity: "2" })]) } }; // op did NOT apply
      }
      throw new Error(`unexpected ${url}`);
    });
    const res = await useCartLinesStore.getState().addPack("v-1");
    expect(res.ok).toBe(false);
    if (res.ok || "duplicatedRejected" in res) throw new Error("unexpected result shape");
    expect(res.uncertain).toBe(true);
    expect(writes).toBe(1);
    await vi.waitFor(() => {
      expect(useCartLinesStore.getState().lines["v-1"]?.quantity).toBe("2"); // settle probe truth
    });
  });

  it("an add 404 «Active cart not found.» (verified BA-A rejection) mints ONCE and retries the same write", async () => {
    h.token.mockReturnValue("f".repeat(64));
    let itemsCalls = 0;
    h.apiRequest.mockImplementation(
      async (url: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) => {
        if (url === "/api/store/cart/items" && init?.method === "POST") {
          itemsCalls += 1;
          if (itemsCalls === 1) throw new AppError("NOT_FOUND", "Active cart not found.");
          // The retry carries the MINTED token (the stale one was consumed).
          expect(init?.headers).toMatchObject({ "x-guest-token": "e".repeat(64) });
          return { data: { cart: cartOf([line({ productVariantId: "v-1", quantity: "1" })]) } };
        }
        if (url === "/api/store/cart" && init?.method === "POST") {
          return { data: { cart: cartOf([]), guestToken: "e".repeat(64) } };
        }
        throw new Error(`unexpected ${url}`);
      },
    );
    const res = await useCartLinesStore.getState().addPack("v-1");
    expect(res.ok).toBe(true);
    expect(itemsCalls).toBe(2);
    expect(h.writeToken).toHaveBeenCalledWith("e".repeat(64));
  });

  it("P1208-D02: authenticated customer with no ACTIVE cart (404 Active cart not found, mint returns no guestToken) initializes customer cart ONCE and retries session-side", async () => {
    h.token.mockReturnValue(null);
    let itemsCalls = 0;
    let mintCalls = 0;
    h.apiRequest.mockImplementation(
      async (url: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) => {
        if (url === "/api/store/cart/items" && init?.method === "POST") {
          itemsCalls += 1;
          if (itemsCalls === 1) throw new AppError("NOT_FOUND", "Active cart not found.");
          expect(init?.headers).toBeUndefined();
          return { data: { cart: cartOf([line({ productVariantId: "v-1", quantity: "1" })]) } };
        }
        if (url === "/api/store/cart" && init?.method === "POST") {
          mintCalls += 1;
          // Authenticated customer cart creation returns { cart } with NO guestToken
          return { data: { cart: cartOf([]) } };
        }
        throw new Error(`unexpected ${url}`);
      },
    );
    const res = await useCartLinesStore.getState().addPack("v-1");
    expect(res.ok).toBe(true);
    expect(mintCalls).toBe(1);
    expect(itemsCalls).toBe(2);
    expect(h.writeToken).not.toHaveBeenCalled();
    expect(useCartLinesStore.getState().lines["v-1"]?.quantity).toBe("1");
  });

  it("P1208-D02: an add 404 «Variant not found.» does NOT mint a cart", async () => {
    h.token.mockReturnValue(null);
    h.apiRequest.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url === "/api/store/cart/items" && init?.method === "POST") {
        throw new AppError("NOT_FOUND", "Variant not found.");
      }
      if (url === "/api/store/cart" && !init?.method) {
        return { data: { cart: cartOf([]) } };
      }
      throw new Error(`unexpected ${url} ${init?.method ?? ""}`);
    });
    const res = await useCartLinesStore.getState().addPack("v-missing");
    expect(res.ok).toBe(false);
    expect(h.writeToken).not.toHaveBeenCalled();
  });

  it("a set/remove 404 «Cart line not found.» is a verified rejection: reconcile probe, no mint, no resend", async () => {
    publishCartSnapshot(cartOf([line({ productVariantId: "v-1", quantity: "2" })]));
    let removes = 0;
    h.apiRequest.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url === "/api/store/cart/items/v-1" && init?.method === "DELETE") {
        removes += 1;
        throw new AppError("NOT_FOUND", "Cart line not found.");
      }
      if (url === "/api/store/cart" && !init?.method) {
        return { data: { cart: cartOf([]) } }; // the line is indeed gone server-side
      }
      throw new Error(`unexpected ${url}`);
    });
    const res = await useCartLinesStore.getState().removeLine("v-1");
    expect(res.ok).toBe(false);
    if (res.ok || "duplicatedRejected" in res) throw new Error("unexpected result shape");
    expect(res.uncertain).toBe(false);
    expect(res.error?.code).toBe("NOT_FOUND");
    expect(removes).toBe(1);
    await vi.waitFor(() => {
      expect(useCartLinesStore.getState().lines["v-1"]).toBeUndefined(); // converge via read
    });
    expect(h.writeToken).not.toHaveBeenCalled();
  });

  it("a DEFINITE contract rejection (422) is not uncertain and schedule no probe", async () => {
    publishCartSnapshot(cartOf([line({ productVariantId: "v-1", quantity: "2" })]));
    h.apiRequest.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url === "/api/store/cart/items/v-1" && init?.method === "PATCH") {
        throw new AppError("BUSINESS_RULE", "Weight quantity violates the sale step.");
      }
      throw new Error(`unexpected ${url}`);
    });
    const res = await useCartLinesStore.getState().setQuantity("v-1", "1.250");
    expect(res.ok).toBe(false);
    if (res.ok || "duplicatedRejected" in res) throw new Error("unexpected result shape");
    expect(res.uncertain).toBe(false);
    expect(res.error?.code).toBe("BUSINESS_RULE");
    expect(useCartLinesStore.getState()._probeQueued).toBe(false);
    expect(useCartLinesStore.getState().lines["v-1"]?.quantity).toBe("2"); // last confirmed stays
  });

  it("an un-confirmed mint never precedes any write: mint-timeout → the op ends uncertain with no retry", async () => {
    h.token.mockReturnValue(null);
    let itemsWrites = 0;
    h.apiRequest.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url === "/api/store/cart" && init?.method === "POST") {
        throw new TypeError("offline"); // the mint itself is an unknown write
      }
      if (url === "/api/store/cart/items" && init?.method === "POST") {
        itemsWrites += 1;
        throw EXACTLY_ONE;
      }
      throw new Error(`unexpected ${url}`);
    });
    const res = await useCartLinesStore.getState().addPack("v-1");
    expect(res.ok).toBe(false);
    if (res.ok || "duplicatedRejected" in res) throw new Error("unexpected result shape");
    expect(res.uncertain).toBe(true);
    expect(itemsWrites).toBe(1); // the original identity-less attempt only
  });
});

describe("cart-lines store — line matching helpers", () => {
  it("cartLineForProduct: one match resolves; two matches return null (no invented aggregate)", () => {
    const lines = {
      "v-1": { variantId: "v-1", productId: "p-1", productName: null, variantName: "أ", quantity: "1", lineTotal: null },
      "v-2": { variantId: "v-2", productId: "p-1", productName: null, variantName: "ب", quantity: "2", lineTotal: null },
      "v-3": { variantId: "v-3", productId: "p-2", productName: null, variantName: "ج", quantity: "1", lineTotal: null },
    };
    expect(cartLineForProduct(lines, "p-2")?.variantId).toBe("v-3");
    expect(cartLineForProduct(lines, "p-1")).toBeNull();
  });

  it("reset empties the confirmed space (post-checkout posture)", () => {
    publishCartSnapshot(cartOf([line({ productVariantId: "v-1", quantity: "2" })]));
    resetCartStore();
    const s = useCartLinesStore.getState();
    expect(s.lines).toEqual({});
    expect(s.syncLoaded).toBe(true);
  });
});
