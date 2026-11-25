// Phase 07 (P07-T01, FE-11.2 continuation) — the shared CLIENT cart-lines store.
// The server is the only truth: every entity here entered through a CONFIRMED
// full-cart response (`CartShape` subset; serialize.ts). Nothing is optimistic,
// nothing lives in localStorage (that file holds the guest bearer only).
// One deduped read probe per mount wave (`sync`); publishers (PDP island, cart
// page, checkout) feed confirmed snapshots here so card ⇄ PDP ⇄ cart agree.
//
// Concurrency rules (Phase 07 §7):
// - per-line single flight: a second op for the same line while one is inflight
//   is REJECTED in logic (real guard, not a cosmetic disabled button).
// - monotonic response rule: every request is stamped `seq` AT SEND; a response
//   applies only when `seq >= appliedSeq` — a late response can never overwrite
//   a newer confirmed snapshot; a discarded response schedules a deduped
//   reconcile probe (GET /cart) so the store converges from server truth.
// - external publishes (`publishCartSnapshot`) are held while any store op is
//   inflight (never regress), and a probe runs after the op settles.
// - P09 §6 uncertainty policy: every write attempt is bounded
//   (mutationTimeoutSignal). A failure that is NOT a parsed contract rejection
//   (transport/timeout/bad envelope/5xx) is carried upward as `uncertain:true`
//   — never a retry signal, never a success claim — and schedules ONE deduped
//   reconcile probe (fresh GET /cart) after the ops settle. A verified 404
//   line/cart rejection also reconciles from server truth (no resend).
// - identity ladder per contract (no invented endpoints): stored guest token XOR
//   session; stale-token/both-sides → clear once + retry session-side (CartView
//   posture); fresh visitor → mint-once-then-retry (approved FE-4 semantics);
//   an add hitting a VERIFIED 404 no-active-cart also mints once (BA-A) then
//   retries the same write — the original write was confirmed NOT applied.
"use client";

import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import {
  AppError,
  apiRequest,
  isUncertainOutcome,
  mutationTimeoutSignal,
  type ApiSuccess,
} from "@/lib/frontend/api-client";
import {
  clearGuestCartToken,
  readGuestCartToken,
  writeGuestCartToken,
} from "@/components/store/guest-cart-token";

/** The line snapshot the store persists from a confirmed full-cart response.
 * Strict identifiers; optional display fields default to null when a
 * simplified payload omits them (real server responses always send them). */
export interface CartLineSnapshot {
  variantId: string;
  productId: string | null;
  productName: string | null;
  variantName: string;
  /** Server wire text, VERBATIM (NUMERIC(12,3) semantics; display never re-rounds). */
  quantity: string;
  lineTotal: string | null;
}

/** In-flight per-line operation values (real logic guard). */
export type LineOp = "adding" | "updating" | "removing";

export type OpResult =
  | { ok: true; line: CartLineSnapshot | null }
  | { ok: false; error: AppError | null; duplicatedRejected: true }
  | { ok: false; error: AppError | null; uncertain: boolean };

interface LineMap {
  [variantId: string]: CartLineSnapshot;
}

export interface CartLinesState {
  /** A confirmed server snapshot exists (empty or not). */
  syncLoaded: boolean;
  lines: LineMap;
  ops: Record<string, LineOp>;
  /** Probe surfaced failure (cards still render the add button — adding is safe
   * under server aggregation; this is honest internal state, never a claim). */
  syncError: string | null;
  _seq: number;
  _appliedSeq: number;
  _probeQueued: boolean;
  _syncInflight: Promise<void> | null;
  sync(): Promise<void>;
  addPack(variantId: string): Promise<OpResult>;
  setQuantity(variantId: string, quantity: string): Promise<OpResult>;
  removeLine(variantId: string): Promise<OpResult>;
  publishCartSnapshot(cart: unknown): void;
  resetCartStore(): void;
}

/** Parse a wire cart into the store shape. Any structural violation rejects the
 * whole snapshot (a reconcile probe is scheduled instead — never a partial state). */
function parseSnapshot(cart: unknown): CartLineSnapshot[] | null {
  if (cart === null || typeof cart !== "object" || Array.isArray(cart)) return null;
  const raw = (cart as { lines?: unknown }).lines;
  if (!Array.isArray(raw)) return null;
  const parsed: CartLineSnapshot[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return null;
    const l = item as Record<string, unknown>;
    if (typeof l.productVariantId !== "string" || l.productVariantId === "") return null;
    if (typeof l.quantity !== "string" || l.quantity === "") return null;
    parsed.push({
      variantId: l.productVariantId,
      productId: typeof l.productId === "string" ? l.productId : null,
      productName: typeof l.productName === "string" ? l.productName : null,
      variantName: typeof l.variantName === "string" ? l.variantName : "",
      quantity: l.quantity,
      lineTotal: typeof l.lineTotal === "string" ? l.lineTotal : null,
    });
  }
  return parsed;
}

function lineMapFrom(parsed: CartLineSnapshot[]): LineMap {
  const lines: LineMap = {};
  for (const l of parsed) lines[l.variantId] = l;
  return lines;
}

/** Monotonic send-side sequence stamp. */
function takeSeq(): number {
  const next = useCartLinesStore.getState()._seq + 1;
  useCartLinesStore.setState({ _seq: next });
  return next;
}

/** Apply a confirmed snapshot under the monotonic rule. A MALFORMED snapshot is
 * an honesty failure, not a retry signal: it never corrupts state and never
 * schedules an unbounded probe loop (the last confirmed truth stays; syncError
 * surfaces it; the user's next real action reconciles). */
function applyResponse(cart: unknown, seq: number): void {
  const parsed = parseSnapshot(cart);
  if (parsed === null) {
    // Contract violation from the server (or from a bad publisher shape): keep
    // the last confirmed truth verbatim, surface it, bound any queued probe.
    useCartLinesStore.setState({ syncError: "استجابة سلة غير صالحة من الخادم — حاول مجددًا." });
    return;
  }
  if (seq < useCartLinesStore.getState()._appliedSeq) {
    // A genuinely stale-but-well-formed response: discard and converge once via
    // the deduped reconcile probe (a fresh probe always applies — it is newer).
    scheduleProbe();
    return;
  }
  useCartLinesStore.setState({ lines: lineMapFrom(parsed), _appliedSeq: seq, syncLoaded: true });
}

/** Confirmed "no ACTIVE cart / no identity" — the honest empty truth, under the
 * same monotonic rule as a normal snapshot application. */
function applyEmptyTruth(seq: number): void {
  if (seq < useCartLinesStore.getState()._appliedSeq) {
    scheduleProbe();
    return;
  }
  useCartLinesStore.setState({ lines: {}, _appliedSeq: seq, syncLoaded: true });
}

function scheduleProbe(): void {
  if (useCartLinesStore.getState()._syncInflight) {
    useCartLinesStore.setState({ _probeQueued: true });
    return;
  }
  void useCartLinesStore.getState().sync();
}

/** After an op settles: if publishes were held or responses were discarded while
 * ops were inflight, run ONE deduped reconcile probe. */
function settleProbe(): void {
  const s = useCartLinesStore.getState();
  if (Object.keys(s.ops).length > 0) return; // another op still inflight
  if (s._probeQueued) {
    useCartLinesStore.setState({ _probeQueued: false });
    void s.sync();
  }
}

/** Initialize or resolve the owner's ACTIVE cart once (approved FE-4 / BA-5
 * semantics: mints a guest cart + bearer token for guests, or creates the
 * customer's ACTIVE cart when authenticated via session cookie).
 * P09 §6: the mint is a WRITE — an un-confirmed mint is an UNKNOWN outcome, it
 * never precedes a line write, and it is never a retry signal. */
async function mintActiveCart(): Promise<{
  ok: boolean;
  token: string | null;
  error: AppError | null;
  unknown: boolean;
}> {
  const leg = await mutationAttempt<{ cart: unknown; guestToken?: unknown }>("/api/store/cart", {
    method: "POST",
  });
  if (leg.kind === "uncertain") return { ok: false, token: null, error: leg.error, unknown: true };
  if (leg.kind === "rejected") return { ok: false, token: null, error: leg.error, unknown: false };
  const token = typeof leg.data.data?.guestToken === "string" ? leg.data.data.guestToken : null;
  if (token) writeGuestCartToken(token);
  applyResponse(leg.data.data?.cart, takeSeq());
  return { ok: true, token, error: null, unknown: false };
}

/** P09 §6: one bounded attempt. Any failure that is not a parsed contract
 * rejection is an UNKNOWN outcome — it is carried upward as `uncertain` and
 * is NEVER a retry signal (a retried write could duplicate a committed one).
 * A reconcile read is scheduled by the op layer instead. */
type MutLeg<T> =
  | { kind: "ok"; data: ApiSuccess<T> }
  | { kind: "rejected"; error: AppError | null }
  | { kind: "uncertain"; error: AppError | null };

async function mutationAttempt<T extends { cart?: unknown }>(
  path: string,
  init: { method: "POST" | "PATCH" | "DELETE"; body?: unknown; headers?: Record<string, string> },
): Promise<MutLeg<T>> {
  try {
    return {
      kind: "ok",
      data: await apiRequest<T>(path, { ...init, signal: mutationTimeoutSignal() }),
    };
  } catch (error) {
    if (isUncertainOutcome(error)) {
      return { kind: "uncertain", error: error instanceof AppError ? error : null };
    }
    return { kind: "rejected", error: error instanceof AppError ? error : null };
  }
}

interface MutationInput {
  path: string;
  method: "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** Add-flavored only: a VERIFIED 404 «Active cart not found.» is a definite
   * rejection (the write did NOT apply — BA-A: expired/consumed guest carts
   * behave as absent), so mint-once-then-retry is safe (no duplication).
   * set/remove 404s mean a missing LINE instead — reconcile, never mint-retry. */
  mintOnCartNotFound?: boolean;
}

type MutationOut<T> =
  | { ok: true; data: ApiSuccess<T>; seq: number }
  | { ok: false; error: AppError | null; uncertain: boolean };

function finishLeg<T>(leg: MutLeg<T>, seq: number): MutationOut<T> {
  if (leg.kind === "ok") return { ok: true, data: leg.data, seq };
  return { ok: false, error: leg.error, uncertain: leg.kind === "uncertain" };
}

/** One cart mutation under the identity ladder (contract names only), now with
 * the P09 timeout/uncertainty policy: no legs are ever retried after an
 * UNKNOWN outcome; a confirmed mint may precede an un-issued write. Each send
 * leg receives a fresh monotonic `seq` so an intermediate mint snapshot never
 * marks this operation's own post-mint write response as stale. */
async function cartMutation<T extends { cart?: unknown }>(
  input: MutationInput,
): Promise<MutationOut<T>> {
  const token = readGuestCartToken();
  const seq1 = takeSeq();
  const first = await mutationAttempt<T>(input.path, {
    method: input.method,
    ...(input.body === undefined ? {} : { body: input.body }),
    ...(token ? { headers: { "x-guest-token": token } } : {}),
  });
  if (first.kind === "ok" || first.kind === "uncertain") return finishLeg(first, seq1);

  if (
    input.mintOnCartNotFound &&
    first.error?.code === "NOT_FOUND" &&
    /Active cart not found/i.test(first.error.message)
  ) {
    const mint = await mintActiveCart();
    if (mint.unknown) return { ok: false, error: mint.error, uncertain: true };
    if (mint.ok) {
      if (!mint.token && token) clearGuestCartToken();
      const retrySeq = takeSeq();
      return finishLeg(
        await mutationAttempt<T>(input.path, {
          method: input.method,
          ...(input.body === undefined ? {} : { body: input.body }),
          ...(mint.token ? { headers: { "x-guest-token": mint.token } } : {}),
        }),
        retrySeq,
      );
    }
    return finishLeg(first, seq1);
  }

  const exactOne =
    first.error !== null &&
    first.error.code === "VALIDATION" &&
    /Exactly one of guest token/.test(first.error.message);
  if (!exactOne) return finishLeg(first, seq1);
  if (token) {
    // Stale guest token alongside a session: clear ONCE and let the session
    // side resolve (CartView's refresh posture). If the authenticated customer
    // also has no ACTIVE cart yet (404 Active cart not found), initialize it once.
    clearGuestCartToken();
    const retrySeq = takeSeq();
    const sessionLeg = await mutationAttempt<T>(input.path, {
      method: input.method,
      ...(input.body === undefined ? {} : { body: input.body }),
    });
    if (
      input.mintOnCartNotFound &&
      sessionLeg.kind === "rejected" &&
      sessionLeg.error?.code === "NOT_FOUND" &&
      /Active cart not found/i.test(sessionLeg.error.message)
    ) {
      const mint = await mintActiveCart();
      if (mint.unknown) return { ok: false, error: mint.error, uncertain: true };
      if (mint.ok) {
        const postMintSeq = takeSeq();
        return finishLeg(
          await mutationAttempt<T>(input.path, {
            method: input.method,
            ...(input.body === undefined ? {} : { body: input.body }),
            ...(mint.token ? { headers: { "x-guest-token": mint.token } } : {}),
          }),
          postMintSeq,
        );
      }
    }
    return finishLeg(sessionLeg, retrySeq);
  }
  // Fresh visitor: mint ONCE, then retry with the minted token.
  const mint = await mintActiveCart();
  if (mint.unknown) return { ok: false, error: mint.error, uncertain: true };
  if (mint.ok) {
    const retrySeq = takeSeq();
    return finishLeg(
      await mutationAttempt<T>(input.path, {
        method: input.method,
        ...(input.body === undefined ? {} : { body: input.body }),
        ...(mint.token ? { headers: { "x-guest-token": mint.token } } : {}),
      }),
      retrySeq,
    );
  }
  return finishLeg(first, seq1);
}

/** P09 §6/T10: any failing op that leaves the server outcome unknown (or a
 * NOT_FOUND — the line/cart may already reflect a different server truth)
 * schedules ONE deduped reconcile probe after the ops settle. The probe is a
 * fresh GET — never a resend of the write. */
function applyOpFailure<T extends { cart?: unknown }>(
  out: Extract<MutationOut<T>, { ok: false }>,
): OpResult {
  if (out.uncertain || out.error?.code === "NOT_FOUND") {
    useCartLinesStore.setState({ _probeQueued: true });
  }
  return { ok: false, error: out.error, uncertain: out.uncertain };
}

export const useCartLinesStore = create<CartLinesState>()((set, get) => ({
  syncLoaded: false,
  lines: {},
  ops: {},
  syncError: null,
  _seq: 0,
  _appliedSeq: 0,
  _probeQueued: false,
  _syncInflight: null,

  sync: () => {
    const inflight = get()._syncInflight;
    if (inflight) return inflight;
    const probe = (async () => {
      const seq = takeSeq();
      const token = readGuestCartToken();
      try {
        const res = await apiRequest<{ cart: unknown }>("/api/store/cart", {
          ...(token ? { headers: { "x-guest-token": token } } : {}),
          signal: mutationTimeoutSignal(),
        });
        applyResponse(res.data?.cart, seq);
        set({ syncError: null });
      } catch (error) {
        const isApp = error instanceof AppError;
        if (isApp && (error.code === "VALIDATION" || error.code === "NOT_FOUND")) {
          // Fresh visitor (no identity) or no ACTIVE cart: honest empty truth.
          // A VALIDATION alongside a token means stale identity — clear like CartView.
          if (error.code === "VALIDATION" && token) clearGuestCartToken();
          applyEmptyTruth(seq);
          set({ syncError: null });
        } else if (isApp && error.code === "UNAUTHENTICATED") {
          // Broken session: honest empty for store purposes (owner truth is elsewhere).
          applyEmptyTruth(seq);
          set({ syncError: null });
        } else {
          set({ syncError: isApp ? error.message : "تعذّر جلب حالة السلة." });
        }
      } finally {
        set({ _syncInflight: null });
        const s = get();
        if (s._probeQueued) {
          set({ _probeQueued: false });
          void s.sync();
        }
      }
    })();
    set({ _syncInflight: probe });
    return probe;
  },

  addPack: async (variantId) => {
    if (get().ops[variantId]) return { ok: false, error: null, duplicatedRejected: true };
    set((s) => ({ ops: { ...s.ops, [variantId]: "adding" } }));
    try {
      const out = await cartMutation<{ cart?: unknown }>({
        path: "/api/store/cart/items",
        method: "POST",
        body: { productVariantId: variantId, quantity: "1" },
        mintOnCartNotFound: true,
      });
      if (!out.ok) return applyOpFailure(out);
      applyResponse(out.data.data?.cart, out.seq);
      return { ok: true, line: get().lines[variantId] ?? null };
    } finally {
      set((s) => {
        const ops = { ...s.ops };
        delete ops[variantId];
        return { ops };
      });
      settleProbe();
    }
  },

  setQuantity: async (variantId, quantity) => {
    if (get().ops[variantId]) return { ok: false, error: null, duplicatedRejected: true };
    set((s) => ({ ops: { ...s.ops, [variantId]: "updating" } }));
    try {
      const out = await cartMutation<{ cart?: unknown }>({
        path: `/api/store/cart/items/${variantId}`,
        method: "PATCH",
        body: { quantity },
      });
      if (!out.ok) return applyOpFailure(out);
      applyResponse(out.data.data?.cart, out.seq);
      return { ok: true, line: get().lines[variantId] ?? null };
    } finally {
      set((s) => {
        const ops = { ...s.ops };
        delete ops[variantId];
        return { ops };
      });
      settleProbe();
    }
  },

  removeLine: async (variantId) => {
    if (get().ops[variantId]) return { ok: false, error: null, duplicatedRejected: true };
    set((s) => ({ ops: { ...s.ops, [variantId]: "removing" } }));
    try {
      const out = await cartMutation<{ cart?: unknown }>({
        path: `/api/store/cart/items/${variantId}`,
        method: "DELETE",
      });
      if (!out.ok) return applyOpFailure(out);
      applyResponse(out.data.data?.cart, out.seq);
      return { ok: true, line: get().lines[variantId] ?? null };
    } finally {
      set((s) => {
        const ops = { ...s.ops };
        delete ops[variantId];
        return { ops };
      });
      settleProbe();
    }
  },

  publishCartSnapshot: (cart) => {
    if (Object.keys(get().ops).length > 0) {
      // Hold: the inflight op's own confirmed response (or the settle probe)
      // will publish the authoritative state; holding cannot regress newer truth.
      set({ _probeQueued: true });
      return;
    }
    applyResponse(cart, takeSeq());
  },

  resetCartStore: () => {
    set((s) => {
      const seq = s._seq + 1;
      // A full reset also drops in-flight markers: any op response arriving
      // later is discarded by the monotonic rule (stale vs the bumped seq).
      return { lines: {}, ops: {}, _seq: seq, _appliedSeq: seq, syncLoaded: true, syncError: null };
    });
  },
}));

/** Public publisher for confirmed full-cart responses produced OUTSIDE the store
 * (PDP island, cart page). Import-friendly: `publishCartSnapshot(res.data.cart)`. */
export function publishCartSnapshot(cart: unknown): void {
  useCartLinesStore.getState().publishCartSnapshot(cart);
}

/** Order placement consumed the ACTIVE cart server-side: the store must stop
 * showing IN_CART quantities for a cart that no longer exists. */
export function resetCartStore(): void {
  useCartLinesStore.getState().resetCartStore();
}

/** The card-relevant slice for ONE product: the store's confirmed line when
 * EXACTLY one line matches the product's id (never an invented aggregate when
 * several match), plus that line's in-flight op (real guard source). */
export interface ProductCartSlice {
  syncLoaded: boolean;
  line: CartLineSnapshot | null;
  /** Exactly one line matches this productId (quantity displayable). */
  lineUniqueForProduct: boolean;
  /** ≥2 lines match this productId → quantity aggregation would be invented). */
  inCartAmbiguous: boolean;
  op: LineOp | null;
}

export function cartLineForProduct(lines: LineMap, productId: string): CartLineSnapshot | null {
  const matches = Object.values(lines).filter((l) => l.productId === productId);
  return matches.length === 1 ? matches[0] : null;
}

export function useProductCartSlice(productId: string): ProductCartSlice {
  return useCartLinesStore(
    useShallow((s) => {
      const line = cartLineForProduct(s.lines, productId);
      const matching = Object.values(s.lines).filter((l) => l.productId === productId);
      return {
        syncLoaded: s.syncLoaded,
        line,
        lineUniqueForProduct: line !== null,
        inCartAmbiguous: matching.length >= 2,
        op: line !== null ? (s.ops[line.variantId] ?? null) : null,
      };
    }),
  );
}
