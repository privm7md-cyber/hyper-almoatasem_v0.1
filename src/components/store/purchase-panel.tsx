// FE-4 purchase island ("use client"): variant select + PIECE/WEIGHT qty + Add to Cart.
// Contract: POST /api/store/cart/items {productVariantId, quantity} with owner
// (stored x-guest-token XOR session cookie auto-sent); mint-once-then-retry when
// identity is absent; 200 full cart; single-flight; selection preserved on failure.
// NEVER touches x-guest-order-token (grep-audited absence).
//
// Phase 07 (D01/D04): a WEIGHT product priced per kilogram shows "X ج.م / كجم" and
// its estimate is `price/kg × chosen grams / 1000` (never grams × per-kg price).
// The approved purchase weights are 125 g · 250 g · 500 g · 1 kg · 1.25 kg, filtered
// by the product's own sale step. The quantity sent to the cart stays in the
// variant's live sale unit (kg for KG variants, grams for GRAM variants) — the
// backend counts WEIGHT lines in that unit and enforces the step there.

"use client";

import { useMemo, useRef, useState } from "react";
import { AppError, apiRequest, isUncertainOutcome, mutationTimeoutSignal } from "@/lib/frontend/api-client";
import { publishCartSnapshot, useCartLinesStore } from "@/lib/frontend/cart-lines-store";
import { notifyCartCount } from "@/components/store/cart-badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { clearGuestCartToken, readGuestCartToken, writeGuestCartToken } from "./guest-cart-token";
import {
  WEIGHT_PRESETS_GRAMS,
  estimatePiastres,
  gramsToQtyText,
  isStepValid,
  isWholePacks,
  saleBasisFor,
  weightEstimatePiastres,
} from "@/lib/frontend/cart-qty";
import type { ProductPageData } from "@/lib/frontend/storefront-reads";

function formatEgp(piastres: number): string {
  return `${(piastres / 100).toFixed(2)} ج.م`;
}

const SIZE_UNIT_LABEL: Record<string, string> = {
  GRAM: "جم",
  KG: "كجم",
  ML: "مل",
  LITER: "لتر",
  PIECE: "قطعة",
};

async function ensureActiveCart(): Promise<{
  ok: boolean;
  token: string | null;
  uncertain: boolean;
  error: unknown;
}> {
  try {
    const res = await apiRequest<{ cart: unknown; guestToken?: string }>("/api/store/cart", {
      method: "POST",
      signal: mutationTimeoutSignal(),
    });
    const token = typeof res.data.guestToken === "string" ? res.data.guestToken : null;
    if (token) writeGuestCartToken(token);
    return { ok: true, token, uncertain: false, error: null };
  } catch (error) {
    return { ok: false, token: null, uncertain: isUncertainOutcome(error), error };
  }
}

export function PurchasePanel({ product }: { product: ProductPageData }) {
  const { notify } = useToast();
  const [variantId, setVariantId] = useState(product.variants[0]?.id ?? "");
  const [packs, setPacks] = useState("1");
  const [grams, setGrams] = useState("500");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [serverNote, setServerNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const flight = useRef(false);

  const variant = useMemo(
    () => product.variants.find((v) => v.id === variantId) ?? null,
    [product.variants, variantId],
  );
  const isWeight = product.productType === "WEIGHT";
  // Phase 07 D01: the price basis follows the SALE MODEL of the selected
  // variant — per kilogram for weight sold in kilograms, pack price otherwise.
  const basis = saleBasisFor(product.productType, variant?.sizeUnit ?? null);
  const perKg = basis === "PER_KG";
  // A WEIGHT row whose catalog price is a pack price (variant unit is not KG)
  // cannot be sold by weight without inventing a price basis: its price is
  // reported for independent data correction instead (D01 rule 9).
  const weightSaleUnsupported = isWeight && !perKg;
  const sellable = variant !== null && variant.stock !== "oos" && !weightSaleUnsupported;

  const presets = useMemo(
    () =>
      WEIGHT_PRESETS_GRAMS.filter((g) =>
        isStepValid(g, product.saleStepGrams),
      ),
    [product.saleStepGrams],
  );

  const qtyText = useMemo(() => {
    if (!variant) return null;
    if (!perKg) {
      const n = Number(packs);
      return isWholePacks(n) ? String(n) : null;
    }
    const g = Number(grams);
    if (!isStepValid(g, product.saleStepGrams)) return null;
    return gramsToQtyText(variant.sizeUnit, g);
  }, [variant, perKg, packs, grams, product.saleStepGrams]);

  const estimate =
    qtyText !== null && variant !== null
      ? perKg
        ? weightEstimatePiastres(variant.price, Number(grams))
        : estimatePiastres(qtyText, variant.price)
      : null;

  async function add() {
    if (flight.current || pending) return;
    setFieldError(null);
    setServerNote(null);
    if (!variant) {
      setFieldError("اختر Variant أولًا.");
      return;
    }
    if (variant.stock === "oos") {
      setFieldError("هذا الاختيار غير متوفر حاليًا.");
      return;
    }
    if (weightSaleUnsupported) {
      setFieldError("هذا الصنف غير متاح للبيع بالوزن حاليًا.");
      return;
    }
    if (qtyText === null) {
      setFieldError(
        isWeight ? "اختر وزنًا صالحًا وفق خطوة البيع." : "أدخل عدد عبوات صحيحًا.",
      );
      return;
    }
    flight.current = true;
    setPending(true);
    try {
      const attempt = async (token: string | null) =>
        apiRequest("/api/store/cart/items", {
          method: "POST",
          body: { productVariantId: variant.id, quantity: qtyText },
          ...(token ? { headers: { "x-guest-token": token } } : {}),
          signal: mutationTimeoutSignal(),
        });
      const initialToken = readGuestCartToken();
      let addRes: Awaited<ReturnType<typeof attempt>> | null = null;
      try {
        addRes = await attempt(initialToken);
      } catch (error) {
        if (isUncertainOutcome(error)) {
          // P09 §6: rethrow — the uncertain outcome is handled below (one
          // reconcile read, never an automatic second write).
          throw error;
        }
        const missingOrDualIdentity =
          error instanceof AppError &&
          error.code === "VALIDATION" &&
          /Exactly one of guest token/.test(error.message);
        const missingActiveCart =
          error instanceof AppError &&
          error.code === "NOT_FOUND" &&
          /Active cart not found/i.test(error.message);

        if (missingOrDualIdentity && initialToken) {
          clearGuestCartToken();
          try {
            addRes = await attempt(null);
          } catch (retryErr) {
            if (isUncertainOutcome(retryErr)) throw retryErr;
            if (
              retryErr instanceof AppError &&
              retryErr.code === "NOT_FOUND" &&
              /Active cart not found/i.test(retryErr.message)
            ) {
              const minted = await ensureActiveCart();
              if (minted.uncertain) throw minted.error;
              if (!minted.ok) throw retryErr;
              addRes = await attempt(minted.token);
            } else {
              throw retryErr;
            }
          }
        } else if (missingOrDualIdentity || missingActiveCart) {
          const minted = await ensureActiveCart();
          if (minted.uncertain) throw minted.error;
          if (!minted.ok) throw error;
          if (!minted.token && initialToken) clearGuestCartToken();
          addRes = await attempt(minted.token);
        } else {
          throw error;
        }
      }
      // Phase 07: the confirmed full-cart response is also PUBLISHED to the shared
      // cart-lines store so card ⇄ PDP ⇄ cart agree (publish holds/delays while a
      // card op is inflight — see the store; never regresses newer truth).
      const confirmedCart = (addRes as { data: { cart?: { lines?: unknown[] } } } | null)?.data?.cart;
      publishCartSnapshot(confirmedCart);
      if (Array.isArray(confirmedCart?.lines)) {
        notifyCartCount(confirmedCart.lines.length);
      }
      notify("success", "تمت الإضافة إلى السلة.");
    } catch (error) {
      if (isUncertainOutcome(error)) {
        // P09 §6: timeout/transport/5xx — the outcome at the server is UNKNOWN.
        // No success claim, no fake failure, NO automatic second write; one
        // reconcile read through the shared store converges the display.
        setServerNote("تعذّر التأكد من نتيجة الإضافة — جارٍ التحقق من حالة السلة.");
        void useCartLinesStore.getState().sync();
      } else if (error instanceof AppError) {
        if (error.code === "NOT_FOUND") {
          setServerNote("تعذّر العثور على السلة أو الـVariant — حدّث الصفحة وحاول مجددًا.");
        } else if (error.code === "CONFLICT" || error.code === "BUSINESS_RULE") {
          setServerNote(error.message);
        } else if (error.code === "UNAUTHENTICATED") {
          setServerNote("انتهت الجلسة — سجّل الدخول ثم حاول مجددًا.");
        } else {
          setServerNote("تعذّر الإضافة — حاول مجددًا.");
        }
      } else {
        setServerNote("تعذّر الإضافة — تحقق من الاتصال وحاول مجددًا.");
      }
    } finally {
      flight.current = false;
      setPending(false);
    }
  }

  if (product.variants.length === 0) {
    return (
      <p role="status" className="text-secondary">
        لا توجد اختيارات متاحة لهذا المنتج حاليًا.
      </p>
    );
  }

  return (
    <div className="grid gap-4 rounded-card border border-line bg-white p-5 shadow-xs">
      <label className="grid gap-1.5 text-sm font-semibold text-ink">
        الاختيار (الوحدة والسعر)
        <select
          aria-label="اختيار الـVariant"
          value={variantId}
          onChange={(e) => {
            setVariantId(e.target.value);
            setServerNote(null);
          }}
          className="min-h-[44px] w-full rounded-control border border-line bg-white px-3 text-sm font-medium focus-visible:border-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand focus-visible:ring-2 focus-visible:ring-brand/15"
        >
          {product.variants.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name} — {v.price} ج.م
              {saleBasisFor(product.productType, v.sizeUnit) === "PER_KG" ? " / كجم" : ""}
              {v.stock === "oos" ? " (غير متوفر)" : ""}
            </option>
          ))}
        </select>
      </label>
      {variant ? (
        <p className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-line/70 bg-purple-surface/40 px-3.5 py-2.5 text-sm">
          <span>
            <bdi className="text-xl font-extrabold tabular-nums text-brand-deep">
              {variant.price} ج.م {perKg ? "/ كجم" : ""}
            </bdi>
            {!perKg && variant.sizeValue && variant.sizeUnit ? (
              <span className="ms-2 text-xs text-secondary">
                عبوة {Number(variant.sizeValue)} {SIZE_UNIT_LABEL[variant.sizeUnit] ?? variant.sizeUnit}
              </span>
            ) : null}
            {variant.compareAt !== null ? (
              <bdi className="ms-2 text-xs text-secondary">
                {variant.compareAt} ج.م (مرجع، ليس عرضًا مثبتًا)
              </bdi>
            ) : null}
          </span>
          <span
            className={`rounded-badge px-2.5 py-0.5 text-xs font-semibold ${
              variant.stock === "in"
                ? "bg-[color:var(--success-bg)] text-success-ink"
                : variant.stock === "oos"
                  ? "bg-[color:var(--error-bg)] text-error"
                  : "bg-white text-secondary"
            }`}
          >
            {variant.stock === "in" ? "متوفر" : variant.stock === "oos" ? "غير متوفر" : "التوفر غير محدد حاليًا"}
          </span>
        </p>
      ) : null}
      {weightSaleUnsupported ? (
        <p role="status" className="text-sm text-secondary">
          هذا الصنف غير متاح للبيع بالوزن حاليًا — سعره مسجّل بعبوته في الكتالوج.
        </p>
      ) : perKg ? (
        <div className="grid gap-2.5">
          <p className="text-sm font-semibold">الوزن المطلوب (تقديري — النهائي عند التجهيز)</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="أوزان جاهزة">
            {presets.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGrams(String(g))}
                aria-pressed={grams === String(g)}
                className={
                  grams === String(g)
                    ? "min-h-[44px] rounded-control border border-brand bg-purple-surface px-3.5 text-sm font-semibold text-brand-deep shadow-subtle transition-[transform,colors,border-color,background-color] duration-[var(--motion-fast,170ms)] active:scale-[0.97]"
                    : "min-h-[44px] rounded-control border border-line-strong bg-white px-3.5 text-sm font-semibold text-ink transition-[transform,colors,border-color,background-color] duration-[var(--motion-fast,170ms)] hover:bg-purple-surface active:scale-[0.97]"
                }
              >
                {g >= 1000 ? `${g / 1000} كجم` : `${g} جم`}
              </button>
            ))}
          </div>
          <label className="grid gap-1 text-sm font-semibold">
            وزن مخصص بالجرام
            <input
              inputMode="decimal"
              value={grams}
              onChange={(e) => setGrams(e.target.value)}
              className="min-h-[44px] max-w-[200px] rounded-control border border-line bg-white px-3 text-sm focus-visible:border-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand focus-visible:ring-2 focus-visible:ring-brand/15"
            />
          </label>
          {estimate !== null ? (
            <p className="text-sm text-secondary">
              تقدير توضيحي: <bdi>{formatEgp(estimate)}</bdi> (غير نهائي)
            </p>
          ) : null}
        </div>
      ) : (
        <label className="grid max-w-[200px] gap-1.5 text-sm font-semibold">
          الكمية (عبوات صحيحة)
          <input
            inputMode="numeric"
            value={packs}
            onChange={(e) => setPacks(e.target.value)}
            className="min-h-[44px] rounded-control border border-line bg-white px-3 text-sm focus-visible:border-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand focus-visible:ring-2 focus-visible:ring-brand/15"
          />
        </label>
      )}
      {fieldError ? (
        <p role="alert" className="text-sm text-error">
          {fieldError}
        </p>
      ) : null}
      {serverNote ? (
        <p role={serverNote.startsWith("تم") ? "status" : "alert"} className="text-sm text-secondary">
          {serverNote}
        </p>
      ) : null}
      <div className="pt-1">
        <Button disabled={pending || !sellable} loading={pending} onClick={add} className="w-full justify-center">
          {weightSaleUnsupported
            ? "غير متاح للبيع بالوزن"
            : !sellable
              ? "غير متوفر"
              : "أضف إلى السلة"}
        </Button>
      </div>
    </div>
  );
}
