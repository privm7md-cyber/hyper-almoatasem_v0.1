// Offer edit form (client): the numbers of an offer freeze once an order used it,
// so the server owns that refusal and this form shows the Arabic reason.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/frontend/api-client";
import { adminErrorMessage } from "@/lib/admin/errors";
import {
  AdminButton,
  AdminField,
  AdminInput,
  AdminTextarea,
} from "@/components/admin/ui/controls";
import { fromLocalInput, toLocalInput } from "@/components/admin/promotion-forms";

const MONEY_RE = /^\d+(\.\d{1,2})?$/;

export type PromotionDetailsValues = {
  id: string;
  type: string;
  name: string;
  description: string | null;
  priority: number;
  usageLimit: number | null;
  discountPercent: string | null;
  discountAmount: string | null;
  fixedPrice: string | null;
  startAt: string | null;
  endAt: string | null;
};

/**
 * OWNER POLICY (12 Nov 2026): there is no automatic stacking between
 * offers — the highest-priority eligible offer wins and a lower-priority one
 * never adds a second discount. The stored `isStackable` flag is therefore
 * not offered as a switch: the engine's winner rule decides, and the admin
 * screen says so instead of promising a combination that never happens.
 */
export function PromotionDetailsForm({ promo }: { promo: PromotionDetailsValues }) {
  const router = useRouter();
  const [name, setName] = useState(promo.name);
  const [description, setDescription] = useState(promo.description ?? "");
  const [priority, setPriority] = useState(String(promo.priority));
  const [usageLimit, setUsageLimit] = useState(promo.usageLimit === null ? "" : String(promo.usageLimit));
  const [value, setValue] = useState(
    promo.type === "PERCENTAGE"
      ? (promo.discountPercent ?? "")
      : promo.type === "FIXED_AMOUNT"
        ? (promo.discountAmount ?? "")
        : promo.type === "FIXED_PRICE"
          ? (promo.fixedPrice ?? "")
          : "",
  );
  const [startAt, setStartAt] = useState(toLocalInput(promo.startAt));
  const [endAt, setEndAt] = useState(toLocalInput(promo.endAt));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const valueField =
    promo.type === "PERCENTAGE"
      ? { label: "نسبة الخصم", hint: "رقم من 1 لحد 100، من غير علامة النسبة." }
      : promo.type === "FIXED_AMOUNT"
        ? { label: "مبلغ الخصم", hint: "مبلغ بالجنيه المصري." }
        : promo.type === "FIXED_PRICE"
          ? { label: "السعر الثابت", hint: "السعر النهائي للمنتج بالجنيه المصري." }
          : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    if (name.trim() === "") {
      setError("اسم العرض مطلوب.");
      return;
    }
    const prio = Number(priority.trim());
    if (!Number.isInteger(prio)) {
      setError("الأولوية لازم تكون رقم صحيح.");
      return;
    }
    const limit = usageLimit.trim() === "" ? null : Number(usageLimit.trim());
    if (limit !== null && (!Number.isInteger(limit) || limit <= 0)) {
      setError("حد الاستخدام لازم يكون رقم صحيح أكبر من صفر، أو فاضي يعني من غير حد.");
      return;
    }
    const body: Record<string, unknown> = {
      name: name.trim(),
      description: description.trim() === "" ? null : description.trim(),
      priority: prio,
      usageLimit: limit,
    };
    // `isStackable` is NOT sent: the owner policy removed automatic stacking,
    // so the stored flag is left untouched (no silent write) and the winner
    // rule lives in the pricing engine.
    if (promo.type === "PERCENTAGE") {
      if (value.trim() === "" || !MONEY_RE.test(value.trim()) || Number(value) <= 0 || Number(value) > 100) {
        setError("نسبة الخصم لازم تكون رقم أكبر من صفر ونهائيته 100.");
        return;
      }
      body.discountPercent = value.trim();
    } else if (promo.type === "FIXED_AMOUNT" || promo.type === "FIXED_PRICE") {
      if (value.trim() === "" || !MONEY_RE.test(value.trim())) {
        setError("قيمة الخصم لازم تكون رقم بمقلبين عشريين على الأكثر.");
        return;
      }
      if (promo.type === "FIXED_AMOUNT") body.discountAmount = value.trim();
      else body.fixedPrice = value.trim();
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
    body.startAt = startIso;
    body.endAt = endIso;
    setPending(true);
    try {
      await apiRequest(`/api/admin/promotions/${promo.id}`, { method: "PATCH", body });
      router.refresh();
    } catch (err) {
      setError(adminErrorMessage(err, "مش قادرين نحفظ بيانات العرض. جرّب تاني."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="adm-form">
      <AdminField label="اسم العرض" required hint="الاسم اللي هيظهر للعميل وفي صفحة العرض.">
        {({ inputId, describedBy }) => (
          <AdminInput
            inputId={inputId}
            describedBy={describedBy}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={160}
          />
        )}
      </AdminField>

      <AdminField label="وصف مختصر" optional hint="سطرين توضح للعميل العرض إيه.">
        {({ inputId, describedBy }) => (
          <AdminTextarea
            inputId={inputId}
            describedBy={describedBy}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={4000}
            rows={3}
          />
        )}
      </AdminField>

      <div className="adm-form-grid">
        <AdminField label="الأولوية" required hint="العرض بالأولوية الأعلى بيتحسب الأول.">
          {({ inputId, describedBy }) => (
            <AdminInput
              inputId={inputId}
              describedBy={describedBy}
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              inputMode="numeric"
            />
          )}
        </AdminField>
        <AdminField label="حد الاستخدام" optional hint="فاضي يعني من غير حد. عدد مرات العرض كله.">
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
        {valueField ? (
          <AdminField label={valueField.label} required hint={valueField.hint}>
            {({ inputId, describedBy }) => (
              <AdminInput
                inputId={inputId}
                describedBy={describedBy}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                inputMode="decimal"
              />
            )}
          </AdminField>
        ) : null}
      </div>

      <div className="adm-form-grid">
        <AdminField label="يبدأ في" optional hint="لو فاضي، العرض يبقى شغال من أول ما يتفعّل.">
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
        <AdminField label="ينتهي في" optional hint="لو فاضي، العرض مبيخلصش.">
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

      <div className="adm-field" role="group" aria-label="أولوية العرض عند التعارض">
        <span className="adm-label">أولوية العرض عند التعارض</span>
        <p className="adm-hint">
          العروض ماتتجمّعش مع بعض: لو اتنين مؤهلين على نفس المنتج، العرض صاحب الأولوية الأعلى هو اللي
          بيحسب الخصم، والتاني بيتجاهل. الأولوية بتتحسب في محرك التسعير نفسه.
        </p>
      </div>

      {error ? (
        <p role="alert" className="adm-error">
          {error}
        </p>
      ) : null}

      <div className="adm-btn-row">
        <AdminButton type="submit" loading={pending}>
          حفظ بيانات العرض
        </AdminButton>
      </div>
    </form>
  );
}
