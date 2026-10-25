// FE-7 checkout flow island ("use client"): review → address → coupon/fee preview → place.
// Identity: session probe (GET session → me + addresses) else guest inline form. Totals come
// ONLY from estimate/create responses (never local math as authority). Submission goes through
// the placeOrder server action (adapter-owned credential handling); the idempotency key is
// stable per identical terms and regenerated when terms change after a failure.

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AppError, apiRequest } from "@/lib/frontend/api-client";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { readGuestCartToken } from "@/components/store/guest-cart-token";
import { placeOrder } from "@/app/actions/orders";

interface MeAddress {
  id: string;
  label: string | null;
  city: string;
  area: string | null;
  village: string | null;
  street: string | null;
  buildingNumber: string | null;
  landmark: string | null;
  phone: string;
  isDefault: boolean;
}

interface Me {
  customer: { id: string; firstName: string; phone: string };
  addresses: MeAddress[];
}

interface CartLine {
  productVariantId: string;
  productName: string;
  variantName: string;
  quantity: string;
  unitPriceSnapshot: string | null;
  lineTotal: string | null;
}

interface Preview {
  subtotal: string;
  discountTotal: string;
  deliveryFee: string;
  total: string;
  coupon: { applicable: boolean; reason: string | null; amount: string } | null;
}

function fingerprint(parts: (string | null | undefined)[]): string {
  return parts.map((p) => p ?? "").join("|");
}

export function CheckoutFlow({ initialCoupon = "" }: { initialCoupon?: string }) {
  const router = useRouter();
  const { notify } = useToast();
  const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [addressId, setAddressId] = useState<string>("");
  const [guest, setGuest] = useState({
    city: "",
    phone: "",
    firstName: "",
    street: "",
    area: "",
    village: "",
    buildingNumber: "",
    landmark: "",
  });
  const [coupon, setCoupon] = useState(initialCoupon);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewNote, setPreviewNote] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [ambiguous, setAmbiguous] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [key, setKey] = useState<string>(() =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
  );
  const inFlight = useRef(false);
  const lastFingerprint = useRef<string>("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const token = readGuestCartToken();
        const cartRes = await apiRequest<{ cart: { lines: CartLine[] } }>("/api/store/cart", {
          headers: token ? { "x-guest-token": token } : {},
        });
        const meRes = await apiRequest<Me>("/api/store/customers/session").catch(() => null);
        if (!alive) return;
        setLines(cartRes.data.cart.lines);
        if (meRes) {
          setMe(meRes.data);
          const def = meRes.data.addresses.find((a) => a.isDefault) ?? meRes.data.addresses[0] ?? null;
          setAddressId(def ? def.id : "");
        }
        setPhase("ready");
      } catch (error) {
        if (!alive) return;
        // No identity / no cart yet (fresh visitor): honest empty, not a dead error.
        if (
          error instanceof AppError &&
          (error.code === "VALIDATION" || error.code === "NOT_FOUND" || error.code === "UNAUTHENTICATED")
        ) {
          setLines([]);
          setPhase("ready");
          return;
        }
        setLoadError(error instanceof AppError ? error.message : "تعذّر تحميل بيانات المراجعة.");
        setPhase("failed");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const terms = useMemo(() => {
    if (me) return fingerprint([addressId, coupon.trim(), ...lines.map((l) => `${l.productVariantId}:${l.quantity}`)]);
    return fingerprint([
      guest.city,
      guest.phone,
      guest.firstName,
      guest.street,
      guest.area,
      guest.village,
      guest.buildingNumber,
      guest.landmark,
      coupon.trim(),
      ...lines.map((l) => `${l.productVariantId}:${l.quantity}`),
    ]);
  }, [me, addressId, guest, coupon, lines]);

  // D02/D10: the estimate must reflect the CURRENT terms before submit is possible.
  // Staleness is derived against the terms of the last CONFIRMED estimate
  // response (set only from async request callbacks, never during render): the
  // hint goes stale the moment any term differs from that response's terms, and
  // re-freshens when the refreshed response lands.
  const [freshTerms, setFreshTerms] = useState<string | null>(null);
  const previewStale = preview === null || freshTerms !== terms;

  // Terms changed after (or before) an attempt → fresh key (same key + different terms = 409).
  useEffect(() => {
    if (lastFingerprint.current !== "" && lastFingerprint.current !== terms) {
      setKey(
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
      );
    }
    lastFingerprint.current = terms;
  }, [terms]);

  /** Estimate fetch shared by the manual button and the debounced auto-refresh. */
  async function fetchEstimate(ls: CartLine[], couponCode: string) {
    const token = readGuestCartToken();
    return apiRequest<Preview>("/api/store/orders/estimate", {
      method: "POST",
      body: {
        lines: ls.map((l) => ({ productVariantId: l.productVariantId, quantity: l.quantity })),
        ...(couponCode === "" ? {} : { couponCode }),
      },
      headers: token ? { "x-guest-token": token } : {},
    });
  }

  async function applyEstimate(res: Awaited<ReturnType<typeof fetchEstimate>>, termsAt: string) {
    setPreview(res.data);
    setFreshTerms(termsAt);
    if (res.data.coupon && !res.data.coupon.applicable) {
      setPreviewNote(res.data.coupon.reason ?? "الكوبون غير صالح.");
    } else {
      setPreviewNote(null);
    }
  }

  async function refreshPreview() {
    if (lines.length === 0) return;
    setPreviewNote(null);
    try {
      // Bound the result to the terms visible when the user asked for it.
      await applyEstimate(await fetchEstimate(lines, coupon.trim()), terms);
    } catch (error) {
      setPreviewNote(error instanceof AppError ? error.message : "تعذّرت المعاينة.");
      // A failed refresh leaves the old hint non-authoritative (derived staleness).
    }
  }

  // D02/D10: auto-refresh the estimate whenever any order term changes
  // (debounced); the estimate comes ONLY from the estimate endpoint — no local
  // math acts as authority. Staleness is derived from `terms` vs. the response.
  useEffect(() => {
    if (lines.length === 0) return;
    // Capture this render's exact terms/snapshot — the new terms are the only
    // ones the refresh answers for.
    const linesSnapshot = lines;
    const couponSnapshot = coupon.trim();
    const termsAt = terms;
    const timer = setTimeout(() => {
      void (async () => {
        setPreviewNote(null);
        try {
          await applyEstimate(await fetchEstimate(linesSnapshot, couponSnapshot), termsAt);
        } catch (error) {
          setPreviewNote(error instanceof AppError ? error.message : "تعذّرت المعاينة.");
        }
      })();
    }, 400);
    return () => clearTimeout(timer);
    // The effect intentionally fires per-terms-change only; lines/coupon are read
    // through the snapshot taken at the termscommit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terms]);

  async function submit() {
    if (inFlight.current || submitting) return;
    setSubmitError(null);
    setAmbiguous(false);
    if (lines.length === 0) {
      setSubmitError("السلة فارغة — لا يمكن إنشاء الطلب.");
      return;
    }
    // D10: an order is never created without a live estimate of ITS terms.
    if (previewStale || preview === null) {
      setSubmitError("قدّر الإجمالي أولًا — انتظر اكتمال المعاينة ثم أعد المحاولة.");
      return;
    }
    let payload: Parameters<typeof placeOrder>[0];
    if (me) {
      if (addressId === "") {
        setSubmitError("اختر عنوان التوصيل.");
        return;
      }
      payload = {
        addressId,
        couponCode: coupon.trim() === "" ? null : coupon.trim(),
        idempotencyKey: key,
        cartToken: null,
      };
    } else {
      if (guest.city.trim() === "" || guest.phone.trim() === "" || guest.firstName.trim() === "") {
        setSubmitError("أكمل المدينة والهاتف والاسم.");
        return;
      }
      const opt = (v: string) => (v.trim() === "" ? null : v.trim());
      payload = {
        guestAddress: {
          city: guest.city.trim(),
          street: opt(guest.street),
          // D33: the full optional address fields from FP-00-D015 (label/isDefault
          // are an address-book concept and stay out of the inline guest payload).
          area: opt(guest.area),
          village: opt(guest.village),
          buildingNumber: opt(guest.buildingNumber),
          landmark: opt(guest.landmark),
          phone: guest.phone.trim(),
        },
        guestContact: { firstName: guest.firstName.trim() },
        couponCode: coupon.trim() === "" ? null : coupon.trim(),
        idempotencyKey: key,
        cartToken: readGuestCartToken(),
      };
    }
    inFlight.current = true;
    setSubmitting(true);
    try {
      const result = await placeOrder(payload);
      if (result.ok) {
        notify("success", "تم إنشاء الطلب.");
        router.push(`/order-confirmation/${result.orderId}`);
        return;
      }
      if (result.ambiguous) {
        // Transport-level unknown: order may exist. Never blind-retry with a new key here —
        // the same key is retained; user resolves via orders/support (no auto-resubmit).
        setAmbiguous(true);
        setSubmitError("النتيجة غير مؤكدة — لا تُعد الإرسال. تحقق من طلباتك أو تواصل مع الدعم.");
        return;
      }
      setSubmitError(result.message);
    } catch {
      setAmbiguous(true);
      setSubmitError("انقطع الاتصال بعد الإرسال — النتيجة غير مؤكدة. لا تُعد الإرسال تلقائيًا.");
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  if (phase === "loading") {
    return (
      <div className="mt-6" aria-busy="true">
        <p>جارٍ تحميل المراجعة…</p>
      </div>
    );
  }

  if (phase === "failed") {
    return (
      <div className="mt-6">
        <ErrorState
          title="تعذّر تحميل المراجعة"
          text={loadError ?? "حاول مجددًا."}
          onRetry={() => window.location.reload()}
        />
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <div className="mt-6">
        <EmptyState
          title="السلة فارغة"
          hint="أضف منتجات قبل إتمام الطلب."
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Link
                href="/cart"
                className="vxp-primary-btn inline-flex min-h-[44px] items-center justify-center rounded-control bg-brand px-5 font-semibold text-white"
              >
                راجع السلة
              </Link>
              <Link
                href="/categories"
                className="inline-flex min-h-[44px] items-center justify-center rounded-control border border-line-strong px-5 font-semibold text-ink"
              >
                تصفّح الأقسام
              </Link>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className="mt-6 grid gap-4">
      <section aria-labelledby="co-lines">
        <h2 id="co-lines" className="font-bold">
          عناصر السلة ({lines.length})
        </h2>
        <ul className="mt-2 grid gap-2">
          {lines.map((l) => (
            <li key={l.productVariantId} className="rounded-card border border-line bg-white p-3 text-sm">
              <p className="font-bold">{l.productName}</p>
              <p className="text-secondary">{l.variantName} · الكمية: <bdi>{l.quantity}</bdi></p>
              {l.lineTotal !== null ? (
                <p>
                  <bdi>{l.lineTotal} ج.م</bdi>
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="co-address">
        <h2 id="co-address" className="font-bold">
          عنوان التوصيل
        </h2>
        {me ? (
          me.addresses.length === 0 ? (
            <p className="mt-2 text-sm text-secondary">
              لا توجد عناوين محفوظة — <a href="/account/addresses" className="font-semibold text-brand">أضف عنوانًا</a> ثم عُد.
            </p>
          ) : (
            <label className="mt-2 grid gap-1 text-sm font-semibold">
              اختر عنوانًا
              <select
                value={addressId}
                onChange={(e) => setAddressId(e.target.value)}
                className="min-h-[44px] rounded-control border border-line bg-white px-2"
              >
                <option value="">— اختر —</option>
                {me.addresses.map((a) => (
                  <option key={a.id} value={a.id}>
                    {(a.label ?? a.city) + (a.isDefault ? " (افتراضي)" : "")}
                  </option>
                ))}
              </select>
            </label>
          )
        ) : (
          <div className="mt-2 grid max-w-[480px] gap-3">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-sm font-semibold">
                المدينة *
                <input value={guest.city} onChange={(e) => setGuest((g) => ({ ...g, city: e.target.value }))} className="min-h-[44px] rounded-control border border-line bg-white px-2" />
              </label>
              <label className="grid gap-1 text-sm font-semibold">
                الهاتف *
                <input value={guest.phone} onChange={(e) => setGuest((g) => ({ ...g, phone: e.target.value }))} inputMode="tel" className="min-h-[44px] rounded-control border border-line bg-white px-2" />
              </label>
              <label className="grid gap-1 text-sm font-semibold">
                الاسم الأول *
                <input value={guest.firstName} onChange={(e) => setGuest((g) => ({ ...g, firstName: e.target.value }))} className="min-h-[44px] rounded-control border border-line bg-white px-2" />
              </label>
              <label className="grid gap-1 text-sm font-semibold">
                الشارع (اختياري)
                <input value={guest.street} onChange={(e) => setGuest((g) => ({ ...g, street: e.target.value }))} className="min-h-[44px] rounded-control border border-line bg-white px-2" />
              </label>
            </div>
            {/* D33: optional address fields per the approved FP-00-D015 field list. */}
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-sm font-semibold">
                المنطقة / الحي (اختياري)
                <input value={guest.area} onChange={(e) => setGuest((g) => ({ ...g, area: e.target.value }))} className="min-h-[44px] rounded-control border border-line bg-white px-2" />
              </label>
              <label className="grid gap-1 text-sm font-semibold">
                القرية (اختياري)
                <input value={guest.village} onChange={(e) => setGuest((g) => ({ ...g, village: e.target.value }))} className="min-h-[44px] rounded-control border border-line bg-white px-2" />
              </label>
              <label className="grid gap-1 text-sm font-semibold">
                رقم العمارة (اختياري)
                <input value={guest.buildingNumber} onChange={(e) => setGuest((g) => ({ ...g, buildingNumber: e.target.value }))} className="min-h-[44px] rounded-control border border-line bg-white px-2" />
              </label>
              <label className="grid gap-1 text-sm font-semibold">
                علامة مميزة (اختياري)
                <input value={guest.landmark} onChange={(e) => setGuest((g) => ({ ...g, landmark: e.target.value }))} className="min-h-[44px] rounded-control border border-line bg-white px-2" />
              </label>
            </div>
            <p className="text-xs text-secondary">تُستخدم هذه البيانات لهذا الطلب فقط — لا يُنشأ حساب.</p>
          </div>
        )}
      </section>
      <section aria-labelledby="co-summary">
        <h2 id="co-summary" className="font-bold">
          الملخص والدفع
        </h2>
        <div className="mt-2 flex max-w-[480px] gap-2">
          <label className="sr-only" htmlFor="co-coupon">
            كود الكوبون
          </label>
          <input
            id="co-coupon"
            value={coupon}
            onChange={(e) => setCoupon(e.target.value)}
            placeholder="كوبون (اختياري)"
            className="min-h-[44px] flex-1 rounded-control border border-line bg-white px-3"
          />
          <button
            type="button"
            onClick={() => void refreshPreview()}
            className="min-h-[44px] rounded-control border border-line-strong bg-white px-4 font-semibold"
          >
            معاينة
          </button>
        </div>
        {previewNote ? (
          <p role="alert" className="mt-2 text-sm text-secondary">
            {previewNote}
          </p>
        ) : null}
        {preview ? (
          <div className="mt-2 grid max-w-[480px] gap-1 rounded-card border border-line bg-white p-3 text-sm">
            <p>
              المجموع الفرعي: <bdi>{preview.subtotal} ج.م</bdi>
            </p>
            <p>
              الخصم: <bdi>{preview.discountTotal} ج.م</bdi>
            </p>
            <p>
              التوصيل: <bdi>{preview.deliveryFee} ج.م</bdi>
            </p>
            <p className="font-bold">
              الإجمالي التقديري (قبل الإنشاء): <bdi>{preview.total} ج.م</bdi>
            </p>
          </div>
        ) : null}
        <p className="mt-2 text-xs text-secondary">لا توجد خطوة دفع في هذه النسخة — يُنشأ الطلب مباشرة وفق العقد.</p>
      </section>
      {submitError ? (
        <p role="alert" className="rounded-card border border-error p-3 text-sm">
          {submitError}
          {ambiguous ? " احتفظ بهذه الصفحة وتحقق قبل أي إعادة." : ""}
        </p>
      ) : null}
      {/* D02/D10: live status for the estimate freshness (never a fake claim). */}
      <p className="text-xs text-secondary" role="status" aria-live="polite">
        {previewStale || preview === null
          ? "بانتظار تقدير الإجمالي — يُتاح التأكيد بعد اكتمال المعاينة أو اضغط «معاينة»."
          : "الإجمالي التقديري محدث وفق الكوبون والتوصيل — يمكنك التأكيد."}
      </p>
      <div>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={submitting || previewStale || preview === null}
          className="min-h-[44px] rounded-control bg-brand px-6 font-semibold text-white disabled:opacity-55"
        >
          {submitting ? "جارٍ إنشاء الطلب…" : "تأكيد إنشاء الطلب"}
        </button>
      </div>
    </div>
  );
}
