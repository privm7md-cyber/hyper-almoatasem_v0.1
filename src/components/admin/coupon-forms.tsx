// Coupon create form (client): the code has no discount of its own, it points at an offer.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/frontend/api-client";
import { adminErrorMessage } from "@/lib/admin/errors";
import { promotionStatusLabel } from "@/lib/admin/terminology";
import { AdminButton, AdminChoices, AdminField, AdminInput, AdminSelect } from "@/components/admin/ui/controls";
import { fromLocalInput } from "@/components/admin/promotion-forms";

const MONEY_RE = /^\d+(\.\d{1,2})?$/;

export interface CouponOfferOption {
  id: string;
  name: string;
  status: string;
}

const ACTIVE_OPTIONS = [
  { value: "yes", title: "نشط", hint: "العميل يقدر يدخل الكود على طول." },
  { value: "no", title: "موقوف", hint: "الكود محفوظ بس مش هيشتغل لحد ما تفعّله." },
];

export function CouponCreateForm({ offers }: { offers: CouponOfferOption[] }) {
  const router = useRouter();
  const [promotionId, setPromotionId] = useState("");
  const [code, setCode] = useState("");
  const [usageLimit, setUsageLimit] = useState("");
  const [perCustomerLimit, setPerCustomerLimit] = useState("");
  const [minimumOrderAmount, setMinimumOrderAmount] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [isActive, setIsActive] = useState("yes");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    if (offers.length === 0) {
      setError("لازم يكون فيه عرض موجود قبل إنشاء كود خصم.");
      return;
    }
    if (promotionId.trim() === "") {
      setError("اختار العرض اللي الكود هيكون عليه.");
      return;
    }
    const raw = code.trim();
    if (raw === "" || /\s/.test(raw)) {
      setError("الكود لازم يكون من غير مسافات.");
      return;
    }
    const usage = usageLimit.trim() === "" ? null : Number(usageLimit.trim());
    if (usage !== null && (!Number.isInteger(usage) || usage <= 0)) {
      setError("حد الاستخدام لازم يكون رقم صحيح أكبر من صفر، أو فاضي يعني من غير حد.");
      return;
    }
    const perCustomer = perCustomerLimit.trim() === "" ? null : Number(perCustomerLimit.trim());
    if (perCustomer !== null && (!Number.isInteger(perCustomer) || perCustomer <= 0)) {
      setError("حد الاستخدام لكل عميل لازم يكون رقم صحيح أكبر من صفر، أو فاضي يعني من غير حد.");
      return;
    }
    const minimum = minimumOrderAmount.trim();
    if (minimum !== "" && !MONEY_RE.test(minimum)) {
      setError("أقل قيمة طلب لازم تكون رقم بمقلبين عشريين على الأكثر.");
      return;
    }
    const startIso = fromLocalInput(startAt);
    const endIso = fromLocalInput(endAt);
    if (startAt !== "" && startIso === null) {
      setError("تاريخ البداية مش مظبوط.");
      return;
    }
    if (endAt !== "" && endIso === null) {
      setError("تاريخ النهاية مش مظبوط.");
      return;
    }
    if (startIso && endIso && new Date(endIso) <= new Date(startIso)) {
      setError("تاريخ النهاية لازم يكون بعد تاريخ البداية.");
      return;
    }
    setPending(true);
    try {
      await apiRequest("/api/admin/coupons", {
        method: "POST",
        body: {
          promotionId: promotionId.trim(),
          code: raw,
          ...(usage === null ? {} : { usageLimit: usage }),
          ...(perCustomer === null ? {} : { perCustomerLimit: perCustomer }),
          ...(minimum === "" ? {} : { minimumOrderAmount: minimum }),
          startAt: startIso,
          endAt: endIso,
          isActive: isActive === "yes",
        },
      });
      setCode("");
      setUsageLimit("");
      setPerCustomerLimit("");
      setMinimumOrderAmount("");
      setStartAt("");
      setEndAt("");
      router.refresh();
    } catch (err) {
      setError(adminErrorMessage(err, "مش قادرين نعمل الكود دلوقتي. جرّب تاني."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="adm-form">
      <AdminField
        label="العرض اللي عليه الكود"
        required
        hint="الكود مبياخدش خصم من نفسه — بياخد نوع الخصم والقيمة من العرض اللي بتختاره هنا."
      >
        {({ inputId, describedBy }) => (
          <AdminSelect
            inputId={inputId}
            describedBy={describedBy}
            name="promotionId"
            value={promotionId}
            onChange={(e) => setPromotionId(e.target.value)}
          >
            <option value="">اختار العرض</option>
            {offers.map((offer) => (
              <option key={offer.id} value={offer.id}>
                {offer.name} — {promotionStatusLabel(offer.status)}
              </option>
            ))}
          </AdminSelect>
        )}
      </AdminField>

      <AdminField
        label="الكود"
        required
        hint="الكود بيتخزن بحروف كبيرة ومن غير مسافات، والعميل بيكتبه زي ما هو."
      >
        {({ inputId, describedBy }) => (
          <AdminInput
            inputId={inputId}
            describedBy={describedBy}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            dir="ltr"
            maxLength={64}
            className="adm-cell-id"
          />
        )}
      </AdminField>

      <div className="adm-form-grid">
        <AdminField label="الحد الأقصى للاستخدام" optional hint="فاضي يعني من غير حد. عدد مرات الكود كله.">
          {({ inputId, describedBy }) => (
            <AdminInput
              inputId={inputId}
              describedBy={describedBy}
              value={usageLimit}
              onChange={(e) => setUsageLimit(e.target.value)}
              inputMode="numeric"
            />
          )}
        </AdminField>
        <AdminField label="حد الاستخدام لكل عميل" optional hint="عدد المرات اللي نفس العميل يقدر يستخدم الكود فيها.">
          {({ inputId, describedBy }) => (
            <AdminInput
              inputId={inputId}
              describedBy={describedBy}
              value={perCustomerLimit}
              onChange={(e) => setPerCustomerLimit(e.target.value)}
              inputMode="numeric"
            />
          )}
        </AdminField>
        <AdminField label="أقل قيمة طلب" optional hint="أقل مبلغ للطلب عشان الكود يشتغل.">
          {({ inputId, describedBy }) => (
            <AdminInput
              inputId={inputId}
              describedBy={describedBy}
              value={minimumOrderAmount}
              onChange={(e) => setMinimumOrderAmount(e.target.value)}
              inputMode="decimal"
            />
          )}
        </AdminField>
      </div>

      <div className="adm-form-grid">
        <AdminField label="يبدأ في" optional hint="لو فاضي، الكود يبقى شغال من أول ما يتعمل.">
          {({ inputId, describedBy }) => (
            <AdminInput
              inputId={inputId}
              describedBy={describedBy}
              type="datetime-local"
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
            />
          )}
        </AdminField>
        <AdminField label="ينتهي في" optional hint="لو فاضي، الكود مبيخلصش.">
          {({ inputId, describedBy }) => (
            <AdminInput
              inputId={inputId}
              describedBy={describedBy}
              type="datetime-local"
              value={endAt}
              onChange={(e) => setEndAt(e.target.value)}
            />
          )}
        </AdminField>
      </div>

      <div className="adm-field" role="group" aria-label="حالة الكود">
        <span className="adm-label">حالة الكود</span>
        <AdminChoices name="coupon-active" value={isActive} onChange={setIsActive} options={ACTIVE_OPTIONS} />
      </div>

      {error ? (
        <p role="alert" className="adm-error">
          {error}
        </p>
      ) : null}

      <div className="adm-btn-row">
        <AdminButton type="submit" loading={pending} disabled={offers.length === 0}>
          إنشاء الكود
        </AdminButton>
      </div>
    </form>
  );
}
