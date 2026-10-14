// FE-5 cart view island ("use client"): reads + mutates the ACTIVE cart via route handlers.
// Owner: stored x-guest-token XOR session cookie (auto-sent). Server owns truth — this island
// renders echoes, never computes authoritative totals. NEVER touches x-guest-order-token.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AppError, apiRequest } from "@/lib/frontend/api-client";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { clearGuestCartToken, readGuestCartToken, writeGuestCartToken } from "./guest-cart-token";

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

export function CartView() {
  const { notify } = useToast();
  const [state, setState] = useState<LoadState>("loading");
  const [cart, setCart] = useState<CartDTO | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [coupon, setCoupon] = useState("");
  const [estimate, setEstimate] = useState<EstimateDTO | null>(null);
  const [couponNote, setCouponNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, []);

  async function refresh() {
    setProblem(null);
    try {
      const res = await apiRequest<{ cart: CartDTO }>("/api/store/cart", { headers: guestHeaders() });
      if (!mounted.current) return;
      setCart(res.data.cart);
      setEstimate(null);
      setState(res.data.cart.lines.length === 0 ? "empty" : "ready");
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof AppError && (error.code === "NOT_FOUND" || error.code === "UNAUTHENTICATED")) {
        setState("gone");
      } else if (error instanceof AppError && error.code === "VALIDATION") {
        // No identity yet (fresh visitor, no token, no session): behave as a fresh
        // empty cart with a mint path — never a dead error screen.
        clearGuestCartToken();
        setCart(null);
        setState("gone");
      } else {
        setProblem(error instanceof AppError ? error.message : "تعذّر تحميل السلة.");
        setState("error");
      }
    }
  }

  async function mutate<T>(fn: () => Promise<T>, okMessage: string | null): Promise<boolean> {
    setBusy(true);
    setProblem(null);
    try {
      const res = await fn();
      const next = (res as { data: { cart: CartDTO } }).data.cart;
      if (!mounted.current) return false;
      setCart(next);
      setEstimate(null);
      setState(next.lines.length === 0 ? "empty" : "ready");
      if (okMessage) notify("success", okMessage);
      return true;
    } catch (error) {
      if (!mounted.current) return false;
      setProblem(error instanceof AppError ? error.message : "تعذّرت العملية.");
      return false;
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  function setQty(variantId: string, quantity: string) {
    return mutate(
      () =>
        apiRequest<{ cart: CartDTO }>(`/api/store/cart/items/${variantId}`, {
          method: "PATCH",
          body: { quantity },
          headers: guestHeaders(),
        }),
      null,
    );
  }

  function removeLine(variantId: string) {
    return mutate(
      () =>
        apiRequest<{ cart: CartDTO }>(`/api/store/cart/items/${variantId}`, {
          method: "DELETE",
          headers: guestHeaders(),
        }),
      "تم حذف السطر.",
    );
  }

  function reprice() {
    return mutate(
      () => apiRequest<{ cart: CartDTO }>("/api/store/cart/reprice", { method: "POST", headers: guestHeaders() }),
      "تم تحديث الأسعار من المصدر.",
    );
  }

  function merge() {
    return mutate(
      () => apiRequest<{ cart: CartDTO }>("/api/store/cart/merge", { method: "POST", headers: guestHeaders() }),
      "تم دمج سلة الضيف في حسابك.",
    );
  }

  async function applyCoupon() {
    if (!cart || cart.lines.length === 0) return;
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
      });
      if (!mounted.current) return;
      const est = res.data;
      setEstimate(est);
      if (est.coupon && !est.coupon.applicable) {
        setCouponNote(est.coupon.reason ?? "الكوبون غير صالح.");
      } else if (est.coupon && est.coupon.applicable) {
        setCouponNote(null);
        notify("success", "تم تطبيق الكوبون.");
      }
    } catch (error) {
      if (!mounted.current) return;
      setCouponNote(error instanceof AppError ? error.message : "تعذّر التحقق من الكوبون.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const mintFresh = useCallback(async () => {
    clearGuestCartToken();
    setState("loading");
    try {
      const res = await apiRequest<{ cart: CartDTO; guestToken?: string }>("/api/store/cart", { method: "POST" });
      if (typeof res.data.guestToken === "string") writeGuestCartToken(res.data.guestToken);
      if (!mounted.current) return;
      setCart(res.data.cart);
      setState(res.data.cart.lines.length === 0 ? "empty" : "ready");
    } catch (error) {
      if (!mounted.current) return;
      setProblem(error instanceof AppError ? error.message : "تعذّر إنشاء سلة جديدة.");
      setState("error");
    }
  }, []);

  if (state === "loading") {
    return (
      <div className="mt-6">
        <LoadingState label="جارٍ تحميل السلة" />
      </div>
    );
  }

  if (state === "gone") {
    return (
      <div className="mt-6">
        <EmptyState
          title="ابدأ سلة جديدة"
          hint="لا توجد سلة نشطة — أنشئ واحدة للمتابعة."
          action={<Button onClick={() => void mintFresh()}>سلة جديدة</Button>}
        />
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="mt-6">
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
      <div className="mt-6">
        <EmptyState title="سلتك فاضية" hint="ابدأ التسوق من الأقسام أو البحث." />
      </div>
    );
  }

  return (
    <div className="mt-6 grid gap-4">
      {problem ? (
        <p role="alert" className="rounded-card border border-error p-3 text-sm">
          {problem}
        </p>
      ) : null}
      <ul className="grid gap-3">
        {cart.lines.map((line) => (
          <li key={line.productVariantId} className="rounded-card border border-line bg-white p-3">
            <p className="font-bold">{line.productName}</p>
            <p className="text-sm text-secondary">
              {line.variantName} · {line.productType === "PIECE" ? "بالقطعة" : "بالوزن"}
            </p>
            <p className="mt-1 text-sm">
              <bdi>
                {line.unitPriceSnapshot !== null ? `${line.unitPriceSnapshot} ج.م` : "السعر عند التحديث"}
              </bdi>
              {line.lineTotal !== null ? (
                <bdi className="ms-2 font-bold">{line.lineTotal} ج.م</bdi>
              ) : null}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <label className="sr-only" htmlFor={`qty-${line.productVariantId}`}>
                الكمية لـ{line.productName}
              </label>
              <input
                id={`qty-${line.productVariantId}`}
                defaultValue={line.quantity}
                inputMode="decimal"
                disabled={busy}
                className="min-h-[44px] w-28 rounded-control border border-line bg-white px-2"
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v !== "" && v !== line.quantity) void setQty(line.productVariantId, v);
                }}
              />
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => void removeLine(line.productVariantId)}>
                حذف
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <div className="rounded-card border border-line bg-white p-4">
        <p className="text-sm text-secondary">المجموع الاسترشادي (غير نهائي):</p>
        <p className="text-xl font-extrabold">
          <bdi>{cart.subtotal} ج.م</bdi>
        </p>
        {estimate ? (
          <div className="mt-2 grid gap-1 text-sm">
            <p>
              الخصم: <bdi>{estimate.discountTotal} ج.م</bdi>
            </p>
            <p>
              التوصيل: <bdi>{estimate.deliveryFee} ج.م</bdi>
            </p>
            <p className="font-bold">
              الإجمالي التقديري: <bdi>{estimate.total} ج.م</bdi>
            </p>
          </div>
        ) : null}
        <div className="mt-3 flex gap-2">
          <label className="sr-only" htmlFor="coupon-code">
            كود الكوبون
          </label>
          <input
            id="coupon-code"
            value={coupon}
            onChange={(e) => setCoupon(e.target.value)}
            placeholder="كود الكوبون (اختياري)"
            disabled={busy}
            className="min-h-[44px] flex-1 rounded-control border border-line bg-white px-3"
          />
          <Button variant="secondary" disabled={busy} onClick={() => void applyCoupon()}>
            تطبيق
          </Button>
        </div>
        {couponNote ? (
          <p role={couponNote.includes("تم تطبيق") ? "status" : "alert"} className="mt-2 text-sm text-secondary">
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
      </div>
    </div>
  );
}
