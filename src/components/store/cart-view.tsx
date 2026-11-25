// FE-5 cart view island ("use client"): reads + mutates the ACTIVE cart via route handlers.
// Owner: stored x-guest-token XOR session cookie (auto-sent). Server owns truth — this island
// renders echoes, never computes authoritative totals. NEVER touches x-guest-order-token.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AppError,
  apiRequest,
  isUncertainOutcome,
  mutationTimeoutSignal,
} from "@/lib/frontend/api-client";
import { publishCartSnapshot } from "@/lib/frontend/cart-lines-store";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { MOTION_DURATIONS_MS } from "@/lib/motion-tokens";
import { clearGuestCartToken, readGuestCartToken, writeGuestCartToken } from "./guest-cart-token";
import { notifyCartCount } from "./cart-badge";

interface CartLineDTO {
  productVariantId: string;
  variantName: string;
  productName: string;
  productType: string;
  quantity: string;
  unitSnapshot: string;
  unitPriceSnapshot: string | null;
  lineTotal: string | null;
}

interface CartDTO {
  id: string;
  status: string;
  guest: boolean;
  lines: CartLineDTO[];
  subtotal: string;
}

interface EstimateDTO {
  subtotal: string;
  discountTotal: string;
  deliveryFee: string;
  total: string;
  coupon: { code: string; applicable: boolean; reason: string | null; amount: string } | null;
}

type LoadState = "loading" | "ready" | "empty" | "gone" | "error";

function guestHeaders(): Record<string, string> {
  const token = readGuestCartToken();
  return token ? { "x-guest-token": token } : {};
}

/** P09 §7: response honesty for the estimate — the contract always sends the
 * money strings; a malformed/unusable estimate is NOT displayed with blank
 * values and NEVER re-derived locally (missing field ≠ 0). */
function parseEstimate(raw: unknown): EstimateDTO | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const money = (v: unknown): boolean => typeof v === "string" && /^\d+(\.\d{1,2})?$/.test(v);
  const coupon = (() => {
    const c = r.coupon;
    if (c === null || typeof c !== "object" || Array.isArray(c)) return null;
    const cc = c as Record<string, unknown>;
    if (typeof cc.code !== "string" || typeof cc.applicable !== "boolean") return null;
    return {
      code: cc.code,
      applicable: cc.applicable,
      reason: typeof cc.reason === "string" ? cc.reason : null,
      amount: typeof cc.amount === "string" ? cc.amount : "0.00",
    };
  })();
  if (!money(r.subtotal) || !money(r.discountTotal) || !money(r.deliveryFee) || !money(r.total)) {
    return null;
  }
  return {
    subtotal: r.subtotal as string,
    discountTotal: r.discountTotal as string,
    deliveryFee: r.deliveryFee as string,
    total: r.total as string,
    coupon,
  };
}

/** Contract-derived quantity format (mirrors zod `cartQuantitySchema`:
 * NUMERIC(12,3) text, strictly > 0) — a client pre-check against the SAME
 * frozen shape, not a new rule; the server remains the only enforcer. */
function isValidQuantityText(v: string): boolean {
  return /^\d+(\.\d{1,3})?$/.test(v) && Number(v) > 0;
}

export function CartView({ initialEmpty = false }: { initialEmpty?: boolean } = {}) {
  const { notify } = useToast();
  const [state, setState] = useState<LoadState>(() => (initialEmpty ? "gone" : "loading"));
  const [cart, setCart] = useState<CartDTO | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [coupon, setCoupon] = useState("");
  const [estimate, setEstimate] = useState<EstimateDTO | null>(null);
  const [couponNote, setCouponNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingOp, setPendingOp] = useState<{ variantId: string; type: "update" | "remove" } | null>(null);
  const subtotalRef = useRef<HTMLParagraphElement | null>(null);
  const prevSubtotalKeyRef = useRef<string | null>(null);
  /** P09 (D3): a real JS re-entrancy guard — `disabled` arrives after render;
   * a same-tick double click must never send a second write. */
  const busyRef = useRef(false);
  /** P09 (D4): draft quantities — an edit keeps the SERVER's confirmed text as
   * the fallback; a rejected/uncertain edit always reverts to it (never pins an
   * unconfirmed value). */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const mounted = useRef(true);

  useEffect(() => {
    if (!cart) {
      prevSubtotalKeyRef.current = null;
      subtotalRef.current?.removeAttribute("data-subtotal-pulse");
      return;
    }
    const nextKey = `${cart.subtotal}|${estimate?.total ?? ""}`;
    if (prevSubtotalKeyRef.current === null) {
      prevSubtotalKeyRef.current = nextKey;
      return;
    }
    if (prevSubtotalKeyRef.current === nextKey) return;
    prevSubtotalKeyRef.current = nextKey;
    const el = subtotalRef.current;
    if (!el) return;
    el.setAttribute("data-subtotal-pulse", "true");
    const timer = window.setTimeout(() => {
      if (mounted.current) subtotalRef.current?.removeAttribute("data-subtotal-pulse");
    }, MOTION_DURATIONS_MS.normal);
    return () => window.clearTimeout(timer);
  }, [cart, estimate?.total]);

  useEffect(() => {
    mounted.current = true;
    if (initialEmpty) {
      const token = readGuestCartToken();
      if (!token) {
        // Confirmed fresh visitor without cart: keep SSR empty state with zero network contention
        return;
      }
    }
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [initialEmpty]);

  function setDraft(variantId: string, v: string | undefined) {
    setDrafts((d) => {
      const n = { ...d };
      if (v === undefined) delete n[variantId];
      else n[variantId] = v;
      return n;
    });
  }

  async function refresh() {
    setProblem(null);
    const token = readGuestCartToken();
    const hasCustomerCookie =
      typeof document !== "undefined" &&
      (document.cookie.includes("__Host-customer-session") ||
        document.cookie.includes("hyper-customer-session-dev"));

    if (!token && !hasCustomerCookie) {
      if (!mounted.current) return;
      notifyCartCount(0);
      setCart(null);
      setState("gone");
      return;
    }

    try {
      const res = await apiRequest<{ cart: CartDTO }>("/api/store/cart", {
        headers: guestHeaders(),
        signal: mutationTimeoutSignal(),
      });
      if (!mounted.current) return;
      setCart(res.data.cart);
      notifyCartCount(res.data.cart.lines.length);
      setEstimate(null);
      setState(res.data.cart.lines.length === 0 ? "empty" : "ready");
      // Phase 07: publish the confirmed snapshot to the shared cart-lines store
      // (cards reflect it; held/skipped while a line op is inflight — never regresses).
      publishCartSnapshot(res.data.cart);
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof AppError && (error.code === "NOT_FOUND" || error.code === "UNAUTHENTICATED")) {
        notifyCartCount(0);
        setState("gone");
      } else if (error instanceof AppError && error.code === "VALIDATION") {
        // No identity yet (fresh visitor, no token, no session): behave as a fresh
        // empty cart with a mint path — never a dead error screen.
        clearGuestCartToken();
        notifyCartCount(0);
        setCart(null);
        setState("gone");
      } else {
        setProblem(error instanceof AppError ? error.message : "تعذّر تحميل السلة.");
        setState("error");
      }
    }
  }

  /** P09 §6 (D2): a fresh READ to converge after an unknown/ambiguous mutation
   * outcome — the probe is a read; the write is never auto-resent. The current
   * cart stays on screen until the probe confirms the truth. */
  async function reconcile() {
    try {
      const res = await apiRequest<{ cart: CartDTO }>("/api/store/cart", {
        headers: guestHeaders(),
        signal: mutationTimeoutSignal(),
      });
      if (!mounted.current) return;
      setCart(res.data.cart);
      setEstimate(null);
      setState(res.data.cart.lines.length === 0 ? "empty" : "ready");
      publishCartSnapshot(res.data.cart);
      setProblem(null);
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof AppError && (error.code === "NOT_FOUND" || error.code === "UNAUTHENTICATED")) {
        setState("gone");
        setProblem(null);
        return;
      }
      if (error instanceof AppError && error.code === "VALIDATION") {
        clearGuestCartToken();
        setCart(null);
        setState("gone");
        setProblem(null);
        return;
      }
      // The reconcile read itself failed: keep the last confirmed cart visible
      // and say the outcome stays unknown (no auto-retry loop).
      setProblem(
        "لم يُمكن التحقق من حالة السلة — النتيجة تبقى غير مؤكدة. تُعرض آخر حالة مؤكدة؛ أعد المحاولة بعد قليل.",
      );
    }
  }

  async function mutate<T>(fn: () => Promise<T>, okMessage: string | null): Promise<boolean> {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const res = await fn();
      const next = (res as { data: { cart: CartDTO } }).data.cart;
      if (!mounted.current) return false;
      setCart(next);
      notifyCartCount(next.lines.length);
      setEstimate(null);
      setState(next.lines.length === 0 ? "empty" : "ready");
      // Phase 07: every confirmed mutation response also updates the shared store.
      publishCartSnapshot(next);
      if (okMessage) notify("success", okMessage);
      return true;
    } catch (error) {
      if (!mounted.current) return false;
      if (isUncertainOutcome(error)) {
        // P09 §6: timeout/transport/5xx — the operation MAY have been applied.
        // Honest state, one reconcile read, no automatic second write.
        setProblem("تعذّر التأكد من نتيجة العملية — جارٍ التحقق من حالة السلة.");
        await reconcile();
        return false;
      }
      const definite = error instanceof AppError ? error : null;
      setProblem(definite?.message ?? "تعذّرت العملية.");
      if (definite?.code === "NOT_FOUND") {
        // Verified «line/cart not found»: convergence via a fresh read (a re-issued
        // identical write can never be assumed idempotent on this contract).
        await reconcile();
      }
      return false;
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function setQty(variantId: string, quantity: string) {
    if (!busyRef.current) setPendingOp({ variantId, type: "update" });
    try {
      return await mutate(
        () =>
          apiRequest<{ cart: CartDTO }>(`/api/store/cart/items/${variantId}`, {
            method: "PATCH",
            body: { quantity },
            headers: guestHeaders(),
            signal: mutationTimeoutSignal(),
          }),
        null,
      );
    } finally {
      if (mounted.current) setPendingOp(null);
    }
  }

  async function removeLine(variantId: string) {
    if (!busyRef.current) setPendingOp({ variantId, type: "remove" });
    try {
      return await mutate(
        () =>
          apiRequest<{ cart: CartDTO }>(`/api/store/cart/items/${variantId}`, {
            method: "DELETE",
            headers: guestHeaders(),
            signal: mutationTimeoutSignal(),
          }),
        "تم حذف السطر.",
      );
    } finally {
      if (mounted.current) setPendingOp(null);
    }
  }

  function reprice() {
    return mutate(
      () =>
        apiRequest<{ cart: CartDTO }>("/api/store/cart/reprice", {
          method: "POST",
          headers: guestHeaders(),
          signal: mutationTimeoutSignal(),
        }),
      "تم تحديث الأسعار من المصدر.",
    );
  }

  async function merge() {
    // P09 (D1 fix): ApiSuccess wraps the payload in `data` — the session probe
    // must inspect `res.data.customer`, not the envelope. Without a session the
    // operation cannot succeed; say so before firing the merge.
    try {
      const res = await apiRequest<{ customer?: unknown }>("/api/store/customers/session", {
        signal: mutationTimeoutSignal(),
      });
      const hasCustomer = res?.data?.customer != null;
      if (!hasCustomer) {
        setCouponNote("سجّل الدخول أولًا لدمج سلتك مع حسابك.");
        return;
      }
    } catch {
      setCouponNote("تعذّر التحقق من الجلسة. سجّل الدخول ثم أعد المحاولة.");
      return;
    }
    return mutate(
      () =>
        apiRequest<{ cart: CartDTO }>("/api/store/cart/merge", {
          method: "POST",
          headers: guestHeaders(),
          signal: mutationTimeoutSignal(),
        }),
      "تم دمج سلة الضيف في حسابك.",
    );
  }

  async function applyCoupon() {
    if (!cart || cart.lines.length === 0) return;
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setCouponNote(null);
    try {
      // Estimate envelope: ok(EstimateResult) → data IS the result (lines/coupon/totals).
      const res = await apiRequest<EstimateDTO>("/api/store/orders/estimate", {
        method: "POST",
        body: {
          lines: cart.lines.map((l) => ({ productVariantId: l.productVariantId, quantity: l.quantity })),
          ...(coupon.trim() === "" ? {} : { couponCode: coupon.trim() }),
        },
        headers: guestHeaders(),
        signal: mutationTimeoutSignal(),
      });
      if (!mounted.current) return;
      const est = parseEstimate(res.data);
      if (est === null) {
        // An unusable estimate is displayed, never invented (P09-C23 honesty).
        setEstimate(null);
        setCouponNote("استجابة تقدير غير صالحة من الخادم — أعد المحاولة.");
        return;
      }
      setEstimate(est);
      if (est.coupon && !est.coupon.applicable) {
        setCouponNote(est.coupon.reason ?? "الكوبون غير صالح.");
      } else if (est.coupon && est.coupon.applicable) {
        setCouponNote("الكوبون صالح — سيُطبَّق على الطلب عند التأكيد.");
        notify("success", "تم التحقق من الكوبون.");
      }
    } catch (error) {
      if (!mounted.current) return;
      setCouponNote(error instanceof AppError ? error.message : "تعذّر التحقق من الكوبون.");
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const mintFresh = useCallback(async () => {
    clearGuestCartToken();
    setState("loading");
    try {
      const res = await apiRequest<{ cart: CartDTO; guestToken?: string }>("/api/store/cart", {
        method: "POST",
        signal: mutationTimeoutSignal(),
      });
      if (typeof res.data.guestToken === "string") writeGuestCartToken(res.data.guestToken);
      if (!mounted.current) return;
      setCart(res.data.cart);
      setDrafts({});
      setState(res.data.cart.lines.length === 0 ? "empty" : "ready");
      // Phase 07: the fresh mint's confirmed cart also reaches the shared store.
      publishCartSnapshot(res.data.cart);
    } catch (error) {
      if (!mounted.current) return;
      setProblem(error instanceof AppError ? error.message : "تعذّر إنشاء سلة جديدة.");
      setState("error");
    }
  }, []);

  if (state === "loading") {
    return (
      <div
        key="cart-loading"
        data-cart-state="loading"
        aria-busy="true"
        className="mt-6 grid min-h-[780px] min-w-0 content-start gap-6 lg:min-h-[448px]"
      >
        <div className="sr-only">
          <LoadingState label="جارٍ تحميل السلة" />
        </div>
        <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
          <div aria-hidden="true" className="grid min-w-0 gap-3">
            {[0, 1].map((item) => (
              <div
                key={item}
                className="rounded-card border border-line bg-white p-4 shadow-xs"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="grid gap-2">
                    <div className="h-5 w-48 animate-pulse rounded bg-purple-surface" />
                    <div className="h-4 w-32 animate-pulse rounded bg-purple-surface/75" />
                  </div>
                  <div className="flex items-center justify-between gap-3 sm:justify-end">
                    <div className="h-9 w-28 animate-pulse rounded-control bg-purple-surface/80" />
                    <div className="h-6 w-20 animate-pulse rounded bg-purple-surface" />
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-line/60 pt-2.5">
                  <div className="h-4 w-24 animate-pulse rounded bg-purple-surface/70" />
                  <div className="h-7 w-16 animate-pulse rounded-control bg-purple-surface/70" />
                </div>
              </div>
            ))}
          </div>
          <aside
            aria-hidden="true"
            className="rounded-card border border-line bg-white p-5 shadow-xs lg:sticky lg:top-24"
          >
            <div className="h-6 w-32 animate-pulse rounded bg-purple-surface" />
            <div className="mt-3 grid gap-2 border-t border-line/70 pt-3">
              <div className="flex justify-between">
                <div className="h-4 w-24 animate-pulse rounded bg-purple-surface/75" />
                <div className="h-4 w-20 animate-pulse rounded bg-purple-surface/75" />
              </div>
              <div className="flex justify-between pt-1">
                <div className="h-5 w-20 animate-pulse rounded bg-purple-surface" />
                <div className="h-6 w-24 animate-pulse rounded bg-purple-surface" />
              </div>
            </div>
            <div className="mt-4 h-4 w-20 animate-pulse rounded bg-purple-surface/75" />
            <div className="mt-2 h-11 animate-pulse rounded-control bg-purple-surface/75" />
            <div className="mt-4 h-11 animate-pulse rounded-control bg-purple-surface" />
            <div className="mt-2.5 h-11 animate-pulse rounded-control bg-purple-surface/80" />
            <div className="mt-2.5 h-4 w-44 animate-pulse rounded bg-purple-surface/70" />
          </aside>
        </div>
      </div>
    );
  }

  if (state === "gone") {
    return (
      <div key="cart-gone" data-cart-state="gone" className="mt-6 py-4">
        <EmptyState
          title="ابدأ سلة جديدة"
          hint="لا توجد سلة نشطة — أنشئ واحدة للمتابعة، أو تابع التسوق مباشرة."
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button onClick={() => void mintFresh()}>سلة جديدة</Button>
              <Link
                href="/categories"
                className="inline-flex min-h-[44px] items-center justify-center rounded-control border border-line-strong px-5 font-semibold text-ink"
              >
                تصفّح الأقسام
              </Link>
              <Link
                href="/search"
                className="inline-flex min-h-[44px] items-center justify-center rounded-control border border-line-strong px-5 font-semibold text-ink"
              >
                ابحث عن منتج
              </Link>
            </div>
          }
        />
      </div>
    );
  }

  if (state === "error") {
    return (
      <div key="cart-error" data-cart-state="error" className="mt-6 min-h-[680px] py-4 lg:min-h-[448px]">
        <ErrorState
          title="تعذّر تحميل السلة"
          text={problem ?? "حاول إعادة المحاولة."}
          onRetry={() => void refresh()}
        />
      </div>
    );
  }

  if (state === "empty" || !cart || cart.lines.length === 0) {
    return (
      <div key="cart-empty" data-cart-state="empty" className="mt-6 py-4">
        <EmptyState
          title="سلتك فاضية"
          hint="ابدأ التسوق من الأقسام أو البحث."
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Link
                href="/categories"
                className="vxp-primary-btn inline-flex min-h-[44px] items-center justify-center rounded-control bg-brand px-5 font-semibold text-white"
              >
                تصفّح الأقسام
              </Link>
              <Link
                href="/search"
                className="inline-flex min-h-[44px] items-center justify-center rounded-control border border-line-strong px-5 font-semibold text-ink"
              >
                ابحث عن منتج
              </Link>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div
      key="cart-ready"
      data-cart-state="ready"
      className="mt-6 grid min-h-[780px] min-w-0 content-start gap-6 lg:min-h-[448px]"
    >
      {problem ? (
        <p role="alert" className="rounded-card border border-error bg-error/5 p-3.5 text-sm">
          {problem}
        </p>
      ) : null}
      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <ul className="grid min-w-0 grid-cols-1 gap-3">
          {cart.lines.map((line) => {
            const lineState =
              pendingOp?.variantId === line.productVariantId ? pendingOp.type : "idle";
            return (
            <li
              key={line.productVariantId}
              data-line-state={lineState}
              className={`rounded-card border bg-white p-4 shadow-xs transition-[opacity,transform,border-color,background-color,box-shadow] duration-[var(--motion-short,200ms)] ${
                lineState === "remove"
                  ? "scale-[0.99] border-error/40 opacity-65"
                  : lineState === "update"
                    ? "border-brand/45 shadow-subtle"
                    : "border-line"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-bold text-ink">{line.productName}</p>
                  <p className="mt-0.5 text-sm text-secondary">
                    {line.variantName} · {line.productType === "PIECE" ? "بالقطعة" : "بالوزن"}
                  </p>
                </div>
                {line.lineTotal !== null ? (
                  <p className="text-base font-extrabold tabular-nums text-brand-deep">
                    <bdi>{line.lineTotal} ج.م</bdi>
                  </p>
                ) : null}
              </div>
              <p className="mt-1.5 text-sm text-secondary">
                سعر الوحدة:{" "}
                <bdi className="font-semibold text-ink">
                  {line.unitPriceSnapshot !== null ? `${line.unitPriceSnapshot} ج.م` : "السعر عند التحديث"}
                </bdi>
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line/60 pt-3">
                <label className="sr-only" htmlFor={`qty-${line.productVariantId}`}>
                  الكمية لـ{line.productName}
                </label>
                <input
                  id={`qty-${line.productVariantId}`}
                  value={drafts[line.productVariantId] ?? line.quantity}
                  onChange={(e) => setDraft(line.productVariantId, e.target.value)}
                  inputMode="decimal"
                  disabled={busy}
                  className="min-h-[44px] w-28 rounded-control border border-line bg-white px-3 text-sm focus-visible:border-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand focus-visible:ring-2 focus-visible:ring-brand/15"
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    const variantId = line.productVariantId;
                    // Nothing changed (or cleared) → revert to the confirmed text.
                    if (v === "" || v === line.quantity) {
                      setDraft(variantId, undefined);
                      return;
                    }
                    // P09 (D4): the frozen wire shape is NUMERIC(12,3) text > 0.
                    // Rejected edits never pin an unconfirmed value — the input
                    // reverts to the last confirmed server text.
                    if (v === "0") {
                      setProblem("لإزالة السطر استخدم زر الحذف — لا يمكن تعيين الكمية صفرًا.");
                      setDraft(variantId, undefined);
                      return;
                    }
                    if (!isValidQuantityText(v)) {
                      setProblem("الكمية يجب أن تكون رقمًا موجبًا (حتى ثلاث منازل عشرية).");
                      setDraft(variantId, undefined);
                      return;
                    }
                    void setQty(variantId, v).then(() => setDraft(variantId, undefined));
                  }}
                />
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => void removeLine(line.productVariantId)}>
                  حذف
                </Button>
              </div>
            </li>
            );
          })}
        </ul>
        <aside className="min-w-0 lg:sticky lg:top-24">
          <div className="min-w-0 rounded-card border border-line bg-white p-5 shadow-xs transition-[border-color,box-shadow] duration-[var(--motion-short,200ms)]">
            <p className="text-sm text-secondary">المجموع الاسترشادي (غير نهائي):</p>
            <p
              ref={subtotalRef}
              className="mt-1 inline-block rounded-control px-1.5 py-0.5 text-2xl font-extrabold tabular-nums text-brand-deep transition-colors duration-[var(--motion-normal,250ms)]"
            >
              <bdi>{cart.subtotal} ج.م</bdi>
            </p>
            {estimate ? (
              <div className="mt-3 grid gap-1.5 rounded-control border border-line/70 bg-purple-surface/35 p-3 text-sm">
                <p className="flex items-center justify-between">
                  <span className="text-secondary">الخصم:</span>{" "}
                  <bdi className="font-semibold tabular-nums">{estimate.discountTotal} ج.م</bdi>
                </p>
                <p className="flex items-center justify-between">
                  <span className="text-secondary">التوصيل:</span>{" "}
                  <bdi className="font-semibold tabular-nums">{estimate.deliveryFee} ج.م</bdi>
                </p>
                <p className="mt-1 flex items-center justify-between border-t border-line pt-1.5 font-bold text-brand-deep">
                  <span>الإجمالي التقديري:</span>{" "}
                  <bdi className="tabular-nums">{estimate.total} ج.م</bdi>
                </p>
              </div>
            ) : null}
            <div className="mt-4 flex gap-2">
              <label className="sr-only" htmlFor="coupon-code">
                كود الكوبون
              </label>
              <input
                id="coupon-code"
                value={coupon}
                onChange={(e) => setCoupon(e.target.value)}
                placeholder="كود الكوبون (اختياري)"
                disabled={busy}
                className="min-h-[44px] min-w-0 flex-1 rounded-control border border-line bg-white px-3 text-sm focus-visible:border-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand focus-visible:ring-2 focus-visible:ring-brand/15"
              />
              <Button variant="secondary" disabled={busy} onClick={() => void applyCoupon()}>
                تطبيق
              </Button>
            </div>
            {couponNote ? (
              <p role={couponNote.includes("صالح") ? "status" : "alert"} className="mt-2 text-sm text-secondary">
                {couponNote}
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="secondary" disabled={busy} onClick={() => void reprice()}>
                تحديث الأسعار
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => void merge()}>
                دمج سلة الضيف في حسابي
              </Button>
            </div>
            <div className="mt-4 grid gap-2.5 border-t border-line pt-4">
              <Link
                href={coupon.trim() === "" ? "/checkout" : `/checkout?coupon=${encodeURIComponent(coupon.trim())}`}
                className="vxp-primary-btn inline-flex min-h-[48px] w-full items-center justify-center rounded-control bg-brand px-6 font-semibold text-white"
              >
                متابعة الشراء
              </Link>
              <Link
                href="/categories"
                className="inline-flex min-h-[44px] w-full items-center justify-center rounded-control border border-line-strong px-5 text-sm font-semibold text-ink transition-colors hover:bg-purple-surface/50"
              >
                متابعة التسوق
              </Link>
              <p className="text-xs leading-relaxed text-secondary">
                السعر النهائي يُحتسب على الخادم عند تأكيد الطلب.
              </p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
