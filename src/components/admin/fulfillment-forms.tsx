// FE-10E fulfillment forms island ("use client"): pick actual + unavailable + propose.
// Server re-validates envelope/state/gates; UI renders confirmed outcomes only.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest, displayFailure } from "@/lib/frontend/api-client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export function PickForm({ orderId, itemId }: { orderId: string; itemId: string }) {
  const router = useRouter();
  const { notify } = useToast();
  const [qty, setQty] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setNote(null);
    if (!/^\d+(\.\d{1,3})?$/.test(qty.trim()) || Number(qty) <= 0) {
      setNote("أدخل كمية فعلية موجبة (حتى 3 كسور عشرية).");
      return;
    }
    setPending(true);
    try {
      await apiRequest(`/api/admin/orders/${orderId}/items/${itemId}/pick`, {
        method: "POST",
        body: { actualQuantity: qty.trim() },
      });
      notify("success", "تم تسجيل التجهيز.");
      router.refresh();
      setQty("");
    } catch (error) {
      setNote(displayFailure(error, "تعذّر الحفظ."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-wrap items-end gap-2">
      <label className="grid gap-1 text-xs font-semibold">
        الكمية الفعلية
        <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" className="min-h-[44px] w-32 rounded-control border border-line bg-white px-2" />
      </label>
      <Button type="submit" size="sm" loading={pending}>
        تجهيز
      </Button>
      {note ? (
        <p role="alert" className="w-full text-xs text-secondary">
          {note}
        </p>
      ) : null}
    </form>
  );
}

export function ProposeForm({ orderId, itemId }: { orderId: string; itemId: string }) {
  const router = useRouter();
  const { notify } = useToast();
  const [variantId, setVariantId] = useState("");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setNote(null);
    if (variantId.trim() === "" || qty.trim() === "") {
      setNote("أدخل معرف البديل والكمية.");
      return;
    }
    setPending(true);
    try {
      await apiRequest(`/api/admin/orders/${orderId}/items/${itemId}/replacements`, {
        method: "POST",
        body: {
          replacementVariantId: variantId.trim(),
          replacementQuantity: qty.trim(),
          ...(reason.trim() === "" ? {} : { reason: reason.trim().slice(0, 2000) }),
        },
      });
      notify("success", "تم إنشاء الاقتراح.");
      router.refresh();
      setVariantId("");
      setQty("");
      setReason("");
    } catch (error) {
      setNote(displayFailure(error, "تعذّر إنشاء الاقتراح."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="grid gap-2 rounded-card border border-line bg-white p-3">
      <p className="text-sm font-bold">اقتراح بديل</p>
      <label className="grid gap-1 text-xs font-semibold">
        معرف Variant البديل
        <input value={variantId} onChange={(e) => setVariantId(e.target.value)} dir="ltr" className="min-h-[44px] rounded-control border border-line bg-white px-2 font-mono text-xs" />
      </label>
      <label className="grid gap-1 text-xs font-semibold">
        الكمية
        <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" className="min-h-[44px] rounded-control border border-line bg-white px-2" />
      </label>
      <label className="grid gap-1 text-xs font-semibold">
        السبب (اختياري)
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} className="min-h-[44px] rounded-control border border-line bg-white px-2" />
      </label>
      {note ? (
        <p role="alert" className="text-xs text-secondary">
          {note}
        </p>
      ) : null}
      <Button type="submit" size="sm" loading={pending}>
        اقتراح البديل
      </Button>
    </form>
  );
}
