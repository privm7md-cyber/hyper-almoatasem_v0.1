// FE-10C variant price editor island ("use client"): PATCH variants/[id]/price.
// Server re-validates price shape + governance; UI renders the confirmed row.
//
// Phase-10: a no-op price submission is blocked in the UI. The server-side
// guard compares the NORMALIZED decimal string with the raw payload, so
// re-submitting the current price as "25.00" reaches the write path, tries to
// record a price-history row with old_price = new_price, and the frozen CHECK
// `chk_price_history_changed` rejects it — the API answers a generic 500
// ("Unexpected error."). The UI compares NUMERICALLY and refuses the no-op
// with a readable message instead. The backend defect is recorded in the
// Phase-10 gap register (BACKEND-CHANGE-REQUIRED) and is NOT fixed here.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest, displayFailure } from "@/lib/frontend/api-client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export function VariantPriceEditor({
  variants,
  canSeePrices = true,
}: {
  variants: { id: string; name: string; price: string }[];
  /** `prices.view` — may the operator SEE the current price? (G01) */
  canSeePrices?: boolean;
}) {
  const router = useRouter();
  const { notify } = useToast();
  const [variantId, setVariantId] = useState(variants[0]?.id ?? "");
  const [price, setPrice] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (variants.length === 0) {
    return <p className="text-sm text-secondary">لا توجد Variants لهذا المنتج.</p>;
  }

  const current = variants.find((v) => v.id === variantId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending || variantId === "") return;
    setNote(null);
    if (!/^\d+(\.\d{1,2})?$/.test(price.trim()) || Number(price) <= 0) {
      setNote("السعر يجب أن يكون رقمًا موجبًا برقمين عشريين حدًا أقصى.");
      return;
    }
    if (current && Number(price.trim()) === Number(current.price)) {
      setNote(`السعر الحالي هو ${current.price} — لا يوجد تغيير لحفظه.`);
      return;
    }
    setPending(true);
    try {
      await apiRequest(`/api/admin/catalog/variants/${variantId}/price`, {
        method: "PATCH",
        body: { price: price.trim(), ...(reason.trim() === "" ? {} : { reason: reason.trim() }) },
      });
      notify("success", "تم تحديث السعر.");
      router.refresh();
      setPrice("");
      setReason("");
    } catch (error) {
      setNote(displayFailure(error, "تعذّر تحديث السعر."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="grid max-w-[480px] gap-3">
      <label className="grid gap-1 text-sm font-semibold">
        الـVariant
        <select
          value={variantId}
          onChange={(e) => setVariantId(e.target.value)}
          className="min-h-[44px] rounded-control border border-line bg-white px-2"
        >
          {variants.map((v) => (
            <option key={v.id} value={v.id}>
              {canSeePrices ? `${v.name} — ${v.price} ج.م` : v.name}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm font-semibold">
        السعر الجديد
        <input
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          inputMode="decimal"
          placeholder="0.00"
          className="min-h-[44px] rounded-control border border-line bg-white px-2"
        />
      </label>
      <label className="grid gap-1 text-sm font-semibold">
        السبب (اختياري)
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          className="min-h-[44px] rounded-control border border-line bg-white px-2"
        />
      </label>
      {note ? (
        <p role="alert" className="text-sm text-secondary">
          {note}
        </p>
      ) : null}
      <Button type="submit" loading={pending}>
        حفظ السعر
      </Button>
    </form>
  );
}
