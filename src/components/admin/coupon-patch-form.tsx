// Coupon edit form (client): the limits, the window and the active switch.
// The code and the linked offer never change here — the server owns both.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/frontend/api-client";
import { adminErrorMessage } from "@/lib/admin/errors";
import { permissionLabel } from "@/lib/admin/terminology";
import { AdminButton, AdminChoices, AdminField, AdminInput } from "@/components/admin/ui/controls";
import { fromLocalInput, toLocalInput } from "@/components/admin/promotion-forms";

const MONEY_RE = /^\d+(\.\d{1,2})?$/;

const ACTIVE_OPTIONS = [
  { value: "yes", title: "نشط", hint: "العميل يقدر يدخل الكود على طول." },
  { value: "no", title: "موقوف", hint: "الكود محفوظ بس مش هيشتغل لحد ما تفعّله." },
];

export function CouponPatchForm({
  id,
  usageLimit,
  perCustomerLimit,
  minimumOrderAmount,
  startAt,
  endAt,
  isActive,
  canDisable,
}: {
  id: string;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  minimumOrderAmount: string | null;
  startAt: string | null;
  endAt: string | null;
  isActive: boolean;
  /** True when the session holds the coupon-stop capability the server demands for the active switch. */
  canDisable: boolean;
}) {
  const router = useRouter();
  const [usage, setUsage] = useState(usageLimit === null ? "" : String(usageLimit));
  const [perCustomer, setPerCustomer] = useState(perCustomerLimit === null ? "" : String(perCustomerLimit));
  const [minimum, setMinimum] = useState(minimumOrderAmount ?? "");
  const [from, setFrom] = useState(toLocalInput(startAt));
  const [to, setTo] = useState(toLocalInput(endAt));
  const [active, setActive] = useState(isActive ? "yes" : "no");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    setSaved(false);

    const usageValue = usage.trim() === "" ? null : Number(usage.trim());
    if (usageValue !== null && (!Number.isInteger(usageValue) || usageValue <= 0)) {
      setError("الحد الأقصى للاستخدام لازم يكون رقم صحيح أكبر من صفر، أو فاضي يعني من غير حد.");
      return;
    }
    const perCustomerValue = perCustomer.trim() === "" ? null : Number(perCustomer.trim());
    if (perCustomerValue !== null && (!Number.isInteger(perCustomerValue) || perCustomerValue <= 0)) {
      setError("حد الاستخدام لكل عميل لازم يكون رقم صحيح أكبر من صفر، أو فاضي يعني من غير حد.");
      return;
    }
    const minimumValue = minimum.trim();
    if (minimumValue !== "" && !MONEY_RE.test(minimumValue)) {
      setError("أقل قيمة طلب لازم تكون رقم بمقلبين عشريين على الأكثر.");
      return;
    }
    const fromIso = fromLocalInput(from);
    const toIso = fromLocalInput(to);
    if (from !== "" && fromIso === null) {
      setError("تاريخ البداية مش مظبوط.");
      return;
    }
    if (to !== "" && toIso === null) {
      setError("تاريخ النهاية مش مظبوط.");
      return;
    }
    if (fromIso && toIso && new Date(toIso) <= new Date(fromIso)) {
      setError("تاريخ النهاية لازم يكون بعد تاريخ البداية.");
      return;
    }

    setPending(true);
    try {
      await apiRequest(`/api/admin/coupons/${id}`, {
        method: "PATCH",
        body: {
          usageLimit: usageValue,
          perCustomerLimit: perCustomerValue,
          minimumOrderAmount: minimumValue === "" ? null : minimumValue,
          startAt: fromIso,
          endAt: toIso,
          ...(canDisable ? { isActive: active === "yes" } : {}),
        },
      });
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(adminErrorMessage(err, "مش قادرين نحفظ الكود دلوقتي. جرّب تاني."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="adm-form">
      <div className="adm-form-grid">
        <AdminField
          label="الحد الأقصى للاستخدام"
          optional
          hint="فاضي يعني من غير حد. عدد مرات الكود كله."
        >
          {({ inputId, describedBy }) => (
            <AdminInput
              inputId={inputId}
              describedBy={describedBy}
              value={usage}
              onChange={(e) => setUsage(e.target.value)}
              inputMode="numeric"
            />
          )}
        </AdminField>
        <AdminField
          label="حد الاستخدام لكل عميل"
          optional
          hint="عدد المرات اللي نفس العميل يقدر يستخدم الكود فيها."
        >
          {({ inputId, describedBy }) => (
            <AdminInput
              inputId={inputId}
              describedBy={describedBy}
              value={perCustomer}
              onChange={(e) => setPerCustomer(e.target.value)}
              inputMode="numeric"
            />
          )}
        </AdminField>
        <AdminField label="أقل قيمة طلب" optional hint="أقل مبلغ للطلب عشان الكود يشتغل.">
          {({ inputId, describedBy }) => (
            <AdminInput
              inputId={inputId}
              describedBy={describedBy}
              value={minimum}
              onChange={(e) => setMinimum(e.target.value)}
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
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          )}
        </AdminField>
        <AdminField label="ينتهي في" optional hint="لو فاضي، الكود مبيخلصش.">
          {({ inputId, describedBy }) => (
            <AdminInput
              inputId={inputId}
              describedBy={describedBy}
              type="datetime-local"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          )}
        </AdminField>
      </div>

      {canDisable ? (
        <div className="adm-field" role="group" aria-label="حالة الكود">
          <span className="adm-label">حالة الكود</span>
          <AdminChoices name="coupon-state" value={active} onChange={setActive} options={ACTIVE_OPTIONS} />
        </div>
      ) : (
        <p className="adm-hint">
          تغيير حالة الكود محتاج صلاحية: {permissionLabel("coupons.disable")}. الخطوة دي مش متاحة لحسابك دلوقتي.
        </p>
      )}

      {error ? (
        <p role="alert" className="adm-error">
          {error}
        </p>
      ) : null}
      {saved && !error ? (
        <div role="status" className="adm-note adm-note--accent">
          اتحفظت التعديلات على الكود.
        </div>
      ) : null}

      <div className="adm-btn-row">
        <AdminButton type="submit" loading={pending}>
          حفظ التعديلات
        </AdminButton>
      </div>
    </form>
  );
}
