// Phase-10 promotion details island ("use client").
//
// Contract: PATCH /api/admin/promotions/[id] (server guard `promotions.update`
// for every non-`status` field). Body shape = `promotionPatchSchema` (strict).
//
// The status toggle is deliberately NOT part of this form: the server requires
// `promotions.disable` for a body containing `status`, and that control lives
// in its own section (`PromotionStatusForm`).
//
// Value fields are type-dependent (PERCENTAGE -> discountPercent,
// FIXED_AMOUNT -> discountAmount, FIXED_PRICE -> fixedPrice) and the domain
// freezes them once the promotion is referenced by an order — the server
// rejects that change with 422 and this form surfaces that message.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest, displayFailure } from "@/lib/frontend/api-client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

const MONEY = /^\d+(\.\d{1,2})?$/;
const PERCENT = /^\d+(\.\d{1,2})?$/;

export type PromotionDetailsValues = {
  id: string;
  type: string;
  name: string;
  description: string | null;
  priority: number;
  isStackable: boolean;
  usageLimit: number | null;
  discountPercent: string | null;
  discountAmount: string | null;
  fixedPrice: string | null;
  startAt: string | null;
  endAt: string | null;
};

/** `datetime-local` needs "YYYY-MM-DDTHH:mm"; the API needs an offset. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Local wall-clock value -> ISO string with the browser's own UTC offset. */
function fromLocalInput(value: string): string | null {
  if (value === "") return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function PromotionDetailsForm({ promo }: { promo: PromotionDetailsValues }) {
  const router = useRouter();
  const { notify } = useToast();
  const [name, setName] = useState(promo.name);
  const [description, setDescription] = useState(promo.description ?? "");
  const [priority, setPriority] = useState(String(promo.priority));
  const [isStackable, setIsStackable] = useState(promo.isStackable);
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
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setNote(null);
    if (name.trim() === "") {
      setNote("اسم العرض مطلوب.");
      return;
    }
    const prio = Number(priority.trim());
    if (!Number.isInteger(prio)) {
      setNote("الأولوية يجب أن تكون رقمًا صحيحًا.");
      return;
    }
    const limit = usageLimit.trim() === "" ? null : Number(usageLimit.trim());
    if (limit !== null && (!Number.isInteger(limit) || limit <= 0)) {
      setNote("حد الاستخدام يجب أن يكون رقمًا صحيحًا أكبر من صفر.");
      return;
    }
    const body: Record<string, unknown> = {
      name: name.trim(),
      description: description.trim() === "" ? null : description.trim(),
      priority: prio,
      isStackable,
      usageLimit: limit,
    };
    if (promo.type === "PERCENTAGE") {
      if (value.trim() === "" || !PERCENT.test(value.trim()) || Number(value) <= 0 || Number(value) > 100) {
        setNote("نسبة الخصم يجب أن تكون رقمًا أكبر من صفر ولا يتجاوز 100.");
        return;
      }
      body.discountPercent = value.trim();
    } else if (promo.type === "FIXED_AMOUNT" || promo.type === "FIXED_PRICE") {
      if (value.trim() === "" || !MONEY.test(value.trim())) {
        setNote("قيمة الخصم يجب أن تكون رقمًا برقمين عشريين حدًا أقصى.");
        return;
      }
      if (promo.type === "FIXED_AMOUNT") body.discountAmount = value.trim();
      else body.fixedPrice = value.trim();
    }
    const startIso = fromLocalInput(startAt);
    const endIso = fromLocalInput(endAt);
    if (startAt !== "" && startIso === null) {
      setNote("تاريخ بدء غير صالح.");
      return;
    }
    if (endAt !== "" && endIso === null) {
      setNote("تاريخ انتهاء غير صالح.");
      return;
    }
    if (startIso && endIso && new Date(endIso) <= new Date(startIso)) {
      setNote("تاريخ الانتهاء يجب أن يكون بعد تاريخ البدء.");
      return;
    }
    body.startAt = startIso;
    body.endAt = endIso;
    setPending(true);
    try {
      await apiRequest(`/api/admin/promotions/${promo.id}`, { method: "PATCH", body });
      notify("success", "تم حفظ بيانات العرض.");
      router.refresh();
    } catch (error) {
      setNote(displayFailure(error, "تعذّر الحفظ."));
    } finally {
      setPending(false);
    }
  }

  const valueLabel =
    promo.type === "PERCENTAGE"
      ? "نسبة الخصم %"
      : promo.type === "FIXED_AMOUNT"
        ? "مبلغ الخصم (ج.م)"
        : promo.type === "FIXED_PRICE"
          ? "السعر الثابت (ج.م)"
          : null;

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="grid max-w-[560px] gap-3">
      <label className="grid gap-1 text-sm font-semibold">
        اسم العرض
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={160} required className="min-h-[44px] rounded-control border border-line bg-white px-2" />
      </label>
      <label className="grid gap-1 text-sm font-semibold">
        الوصف
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} rows={3} className="rounded-control border border-line bg-white px-2 py-2" />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1 text-xs font-semibold">
          الأولوية
          <input value={priority} onChange={(e) => setPriority(e.target.value)} inputMode="numeric" className="min-h-[44px] rounded-control border border-line bg-white px-2" />
        </label>
        <label className="grid gap-1 text-xs font-semibold">
          حد الاستخدام (فارغ = بلا حد)
          <input value={usageLimit} onChange={(e) => setUsageLimit(e.target.value)} inputMode="numeric" className="min-h-[44px] rounded-control border border-line bg-white px-2" />
        </label>
        {valueLabel ? (
          <label className="grid gap-1 text-xs font-semibold">
            {valueLabel}
            <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" className="min-h-[44px] rounded-control border border-line bg-white px-2" />
          </label>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs font-semibold">
          يبدأ في
          <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} className="min-h-[44px] rounded-control border border-line bg-white px-2" />
        </label>
        <label className="grid gap-1 text-xs font-semibold">
          ينتهي في
          <input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} className="min-h-[44px] rounded-control border border-line bg-white px-2" />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={isStackable} onChange={(e) => setIsStackable(e.target.checked)} className="h-5 w-5" />
        قابل للجمع مع عروض أخرى
      </label>
      {note ? (
        <p role="alert" className="text-sm text-error">
          {note}
        </p>
      ) : null}
      <Button type="submit" loading={pending}>
        حفظ بيانات العرض
      </Button>
    </form>
  );
}
