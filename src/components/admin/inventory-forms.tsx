// FE-10D inventory ops island ("use client"): manual adjust + threshold edit.
// Server re-validates shapes, movement allowlist, and permissions per op.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest, displayFailure } from "@/lib/frontend/api-client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

const ADJUST_TYPES = ["STOCK_IN", "ADJUSTMENT", "WASTE", "RETURN"] as const;

export function InventoryAdjustForm() {
  const router = useRouter();
  const { notify } = useToast();
  const [variantId, setVariantId] = useState("");
  const [delta, setDelta] = useState("");
  const [movementType, setMovementType] = useState<(typeof ADJUST_TYPES)[number]>("STOCK_IN");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setNote(null);
    if (variantId.trim() === "" || !/^-?\d+(\.\d{1,3})?$/.test(delta.trim()) || Number(delta) === 0) {
      setNote("أدخل معرف Variant وكمية غير صفرية (حتى 3 كسور عشرية).");
      return;
    }
    setPending(true);
    try {
      await apiRequest("/api/admin/inventory/adjust", {
        method: "POST",
        body: {
          productVariantId: variantId.trim(),
          delta: delta.trim(),
          movementType,
          ...(reason.trim() === "" ? {} : { reason: reason.trim() }),
        },
      });
      notify("success", "تم تسجيل التعديل.");
      router.refresh();
      setVariantId("");
      setDelta("");
      setReason("");
    } catch (error) {
      setNote(displayFailure(error, "تعذّر التعديل."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="grid max-w-[520px] gap-3">
      <label className="grid gap-1 text-sm font-semibold">
        معرف الـVariant
        <input value={variantId} onChange={(e) => setVariantId(e.target.value)} dir="ltr" className="min-h-[44px] rounded-control border border-line bg-white px-2 font-mono text-sm" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1 text-sm font-semibold">
          الفرق (delta)
          <input value={delta} onChange={(e) => setDelta(e.target.value)} inputMode="decimal" placeholder="-5 / +10" className="min-h-[44px] rounded-control border border-line bg-white px-2" />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          نوع الحركة
          <select value={movementType} onChange={(e) => setMovementType(e.target.value as (typeof ADJUST_TYPES)[number])} className="min-h-[44px] rounded-control border border-line bg-white px-2">
            {ADJUST_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="grid gap-1 text-sm font-semibold">
        السبب (اختياري)
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} className="min-h-[44px] rounded-control border border-line bg-white px-2" />
      </label>
      {note ? <p role="alert" className="text-sm text-secondary">{note}</p> : null}
      <Button type="submit" loading={pending}>حفظ التعديل</Button>
    </form>
  );
}

export function InventoryThresholdForm() {
  const router = useRouter();
  const { notify } = useToast();
  const [variantId, setVariantId] = useState("");
  const [threshold, setThreshold] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setNote(null);
    if (variantId.trim() === "") {
      setNote("أدخل معرف الـVariant.");
      return;
    }
    const t = threshold.trim();
    if (t !== "" && (!/^\d+(\.\d{1,3})?$/.test(t) || Number(t) < 0)) {
      setNote("الحد قيمة ≥ صفر (فارغ = مسح الحد).");
      return;
    }
    setPending(true);
    try {
      await apiRequest(`/api/admin/inventory/${variantId.trim()}`, {
        method: "PATCH",
        body: { lowStockThreshold: t === "" ? null : t },
      });
      notify("success", "تم حفظ الحد.");
      router.refresh();
      setVariantId("");
      setThreshold("");
    } catch (error) {
      setNote(displayFailure(error, "تعذّر الحفظ."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="grid max-w-[520px] gap-3">
      <label className="grid gap-1 text-sm font-semibold">
        معرف الـVariant
        <input value={variantId} onChange={(e) => setVariantId(e.target.value)} dir="ltr" className="min-h-[44px] rounded-control border border-line bg-white px-2 font-mono text-sm" />
      </label>
      <label className="grid gap-1 text-sm font-semibold">
        حد المخزون المنخفض (فارغ = مسح)
        <input value={threshold} onChange={(e) => setThreshold(e.target.value)} inputMode="decimal" className="min-h-[44px] rounded-control border border-line bg-white px-2" />
      </label>
      {note ? <p role="alert" className="text-sm text-secondary">{note}</p> : null}
      <Button type="submit" loading={pending}>حفظ الحد</Button>
    </form>
  );
}
