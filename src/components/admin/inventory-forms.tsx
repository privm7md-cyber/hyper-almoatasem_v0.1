"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/frontend/api-client";
import { adminErrorMessage } from "@/lib/admin/errors";
import { boundedThousandths, countedDelta } from "@/lib/inventory/quantities";
import { MANUAL_MOVEMENT_TYPES, MOVEMENT_TYPE_LABELS } from "@/lib/admin/terminology";
import { AdminButton, AdminChoices, AdminField, AdminInput, AdminSelect } from "@/components/admin/ui/controls";

export interface InventoryVariantOption {
  id: string;
  productName: string;
  variantName: string;
  /** Actual quantity unit: packs for PIECE; GRAM or KG for WEIGHT. */
  unit: string;
  quantity: string;
  available: string;
  threshold: string | null;
}

function VariantPicker({ variants, value, onChange }: {
  variants: InventoryVariantOption[]; value: string; onChange: (value: string) => void;
}) {
  return <AdminField label="الصنف" required hint="اختار رصيد معروف من القائمة. لو الصنف مش ظاهر، افتح تفاصيل مخزونه الأول.">
    {({ inputId, describedBy }) => <AdminSelect inputId={inputId} describedBy={describedBy} value={value}
      onChange={event => onChange(event.target.value)}>
      <option value="">اختار الصنف</option>
      {variants.map(option => <option key={option.id} value={option.id}>{option.productName} — {option.variantName}</option>)}
    </AdminSelect>}
  </AdminField>;
}

function FormMessage({ error, done }: { error: string | null; done: string | null }) {
  if (error) return <div className="adm-note adm-note--danger" role="alert">{error}</div>;
  if (done) return <div className="adm-note adm-note--accent" role="status">{done}</div>;
  return null;
}

function ManualStockForm({ variants, counted }: { variants: InventoryVariantOption[]; counted: boolean }) {
  const router = useRouter();
  const [variantId, setVariantId] = useState(variants.length === 1 ? variants[0].id : "");
  const [amount, setAmount] = useState("");
  const [movementType, setMovementType] = useState(counted ? "ADJUSTMENT" : "STOCK_IN");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const submitting = useRef(false);
  // Retain the same key on uncertain/network failure with identical terms.
  const request = useRef<{ terms: string; id: string } | null>(null);
  const current = variants.find(option => option.id === variantId) ?? null;
  const difference = (() => {
    if (!current || !amount.trim()) return null;
    try { return counted ? countedDelta(amount.trim(), current.quantity) :
      (boundedThousandths(amount.trim()) > 0 ? amount.trim() : null); } catch { return null; }
  })();
  function change(set: (value: string) => void, value: string) { set(value); setConfirmed(false); }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    setError(null); setDone(null);
    if (!current) { setError("الرصيد غير معروف. افتح تفاصيل الصنف واقرأ الرصيد الأول."); return; }
    if (difference === null || boundedThousandths(difference, true) === 0) {
      setError("اكتب كمية صحيحة بحد أقصى 3 كسور، وفرق مختلف عن صفر وفي حدود الرصيد."); return;
    }
    if (!reason.trim() || !confirmed) { setError("اكتب السبب وأكّد تغيير الرصيد صراحة."); return; }
    const terms = { productVariantId: current.id, expectedQuantity: current.quantity,
      delta: difference, movementType, reason: reason.trim(), confirmed: true };
    const fingerprint = JSON.stringify(terms);
    if (request.current?.terms !== fingerprint) request.current = { terms: fingerprint, id: crypto.randomUUID() };
    submitting.current = true; setPending(true);
    try {
      await apiRequest("/api/admin/inventory/adjustments", {
        method: "POST", body: { ...terms, requestId: request.current.id },
      });
      setDone(counted ? "اتسجلت التسوية. الفرق ظهر في سجل حركة المخزون." : "اتسجلت الإضافة. حدّث الرصيد قبل أي عملية جديدة.");
      setAmount(""); setReason(""); setConfirmed(false);
      router.refresh();
    } catch (failure) {
      setError(adminErrorMessage(failure, "تعذّر تسجيل الحركة. لو الرصيد اتغيّر، حدّث الصفحة وراجع الكمية قبل التأكيد."));
    } finally { submitting.current = false; setPending(false); }
  }

  return <form onSubmit={event => void submit(event)} className="adm-form">
    <VariantPicker variants={variants} value={variantId} onChange={value => change(setVariantId, value)} />
    {current ? <p className="adm-hint">الرصيد المسجّل دلوقتي {current.quantity} {current.unit}، والمتاح للبيع {current.available} {current.unit}.</p> :
      <p className="adm-hint">الرصيد المفقود أو غير المتاح لا يمكن تعديله هنا.</p>}
    <AdminField label={counted ? "الكمية اللي اتقادت بالعدّ" : "الكمية اللي وصلت"} required
      hint="الكمية بنفس وحدة الرصيد؛ حتى 3 كسور عشرية. التسوية بالعدّ لا تستخدم خطوة البيع للوزن.">
      {({ inputId, describedBy }) => <AdminInput inputId={inputId} describedBy={describedBy} value={amount}
        onChange={event => change(setAmount, event.target.value)} inputMode="decimal" dir="ltr" />}
    </AdminField>
    {current && difference !== null ? <p className="adm-hint">الفرق اللي هيتسجل: {difference} {current.unit}.</p> : null}
    <div className="adm-field"><span className="adm-label">نوع الحركة</span>
      <AdminChoices name={counted ? "adjust-movement-type" : "stock-in-movement-type"} value={movementType}
        onChange={value => change(setMovementType, value)} options={(counted ? MANUAL_MOVEMENT_TYPES : ["STOCK_IN", "RETURN"]).map(type =>
          ({ value: type, title: MOVEMENT_TYPE_LABELS[type] }))} />
    </div>
    <AdminField label={counted ? "سبب التسوية" : "السبب"} required hint="سبب حقيقي لكل حركة، ويظهر في السجل.">
      {({ inputId, describedBy }) => <AdminInput inputId={inputId} describedBy={describedBy} value={reason}
        onChange={event => change(setReason, event.target.value)} maxLength={2000} />}
    </AdminField>
    <label className="adm-label"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
      أؤكد تغيير الرصيد المعروف بالكمية والسبب الموضّحين
    </label>
    <FormMessage error={error} done={done} />
    <div className="adm-btn-row"><AdminButton type="submit" loading={pending}>{counted ? "سجّل التسوية" : "سجّل الإضافة"}</AdminButton></div>
  </form>;
}

export function InventoryAddStockForm({ variants }: { variants: InventoryVariantOption[] }) {
  return <ManualStockForm variants={variants} counted={false} />;
}
export function InventoryAdjustForm({ variants }: { variants: InventoryVariantOption[] }) {
  return <ManualStockForm variants={variants} counted />;
}

export function InventoryThresholdForm({ variants }: { variants: InventoryVariantOption[] }) {
  const router = useRouter();
  const [variantId, setVariantId] = useState(variants.length === 1 ? variants[0].id : "");
  const [threshold, setThreshold] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const submitting = useRef(false);
  const current = variants.find(option => option.id === variantId) ?? null;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    setError(null); setDone(null);
    if (!current) { setError("اختار صنف برصيد معروف."); return; }
    const value = threshold.trim();
    try { if (value !== "") boundedThousandths(value); } catch { setError("اكتب حدّ صحيح من صفر لفوق وفي حدود الكمية."); return; }
    submitting.current = true; setPending(true);
    try {
      await apiRequest(`/api/admin/inventory/${current.id}`, { method: "PATCH", body: { lowStockThreshold: value === "" ? null : value } });
      setDone(value === "" ? "اتشال حد التنبيه من الصنف ده." : "اتحفظ حد التنبيه."); setThreshold(""); router.refresh();
    } catch (failure) { setError(adminErrorMessage(failure, "تعذّر حفظ حد التنبيه.")); }
    finally { submitting.current = false; setPending(false); }
  }
  return <form onSubmit={event => void submit(event)} className="adm-form">
    <VariantPicker variants={variants} value={variantId} onChange={setVariantId} />
    {current ? <p className="adm-hint">حد التنبيه الحالي {current.threshold === null ? "مش متظبّط" : `${current.threshold} ${current.unit}`}.</p> : null}
    <AdminField label="حد التنبيه" hint="سيب الخانة فاضية لإزالة الحد؛ الكمية لا تتغير.">
      {({ inputId, describedBy }) => <AdminInput inputId={inputId} describedBy={describedBy} value={threshold}
        onChange={event => setThreshold(event.target.value)} inputMode="decimal" dir="ltr" />}
    </AdminField>
    <FormMessage error={error} done={done} />
    <AdminButton type="submit" loading={pending}>سجّل حد التنبيه</AdminButton>
  </form>;
}
