// FE-10C coupon create island ("use client"): promotionId + code + limits + window.
// Server normalizes (UPPER) + validates windows + enforces permissions.

"use client";

import { useState } from "react";
import { apiRequest, displayFailure } from "@/lib/frontend/api-client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export function CouponCreateForm() {
  const { notify } = useToast();
  const [promotionId, setPromotionId] = useState("");
  const [code, setCode] = useState("");
  const [usageLimit, setUsageLimit] = useState("");
  const [perCustomerLimit, setPerCustomerLimit] = useState("");
  const [minimumOrderAmount, setMinimumOrderAmount] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setNote(null);
    if (promotionId.trim() === "" || code.trim() === "" || /\s/.test(code.trim())) {
      setNote("أدخل معرف العرض وكودًا بلا مسافات.");
      return;
    }
    setPending(true);
    try {
      const num = (v: string) => (v.trim() === "" ? undefined : Number(v));
      await apiRequest("/api/admin/coupons", {
        method: "POST",
        body: {
          promotionId: promotionId.trim(),
          code: code.trim(),
          ...(usageLimit.trim() === "" ? {} : { usageLimit: num(usageLimit) }),
          ...(perCustomerLimit.trim() === "" ? {} : { perCustomerLimit: num(perCustomerLimit) }),
          ...(minimumOrderAmount.trim() === "" ? {} : { minimumOrderAmount: minimumOrderAmount.trim() }),
        },
      });
      notify("success", "تم إنشاء الكوبون.");
      setPromotionId("");
      setCode("");
      setUsageLimit("");
      setPerCustomerLimit("");
      setMinimumOrderAmount("");
    } catch (error) {
      setNote(displayFailure(error, "تعذّر الإنشاء."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="grid max-w-[520px] gap-3">
      <label className="grid gap-1 text-sm font-semibold">
        معرف العرض (UUID)
        <input value={promotionId} onChange={(e) => setPromotionId(e.target.value)} dir="ltr" className="min-h-[44px] rounded-control border border-line bg-white px-2 font-mono text-xs" />
      </label>
      <label className="grid gap-1 text-sm font-semibold">
        الكود (بلا مسافات — يُطبَّع بأحرف كبيرة على الخادم)
        <input value={code} onChange={(e) => setCode(e.target.value)} dir="ltr" maxLength={64} className="min-h-[44px] rounded-control border border-line bg-white px-2 font-mono" />
      </label>
      <div className="grid grid-cols-3 gap-2">
        <label className="grid gap-1 text-xs font-semibold">
          حد الاستخدام
          <input value={usageLimit} onChange={(e) => setUsageLimit(e.target.value)} inputMode="numeric" className="min-h-[44px] rounded-control border border-line bg-white px-2" />
        </label>
        <label className="grid gap-1 text-xs font-semibold">
          حد العميل
          <input value={perCustomerLimit} onChange={(e) => setPerCustomerLimit(e.target.value)} inputMode="numeric" className="min-h-[44px] rounded-control border border-line bg-white px-2" />
        </label>
        <label className="grid gap-1 text-xs font-semibold">
          حد أدنى للطلب
          <input value={minimumOrderAmount} onChange={(e) => setMinimumOrderAmount(e.target.value)} inputMode="decimal" className="min-h-[44px] rounded-control border border-line bg-white px-2" />
        </label>
      </div>
      {note ? (
        <p role="alert" className="text-sm text-secondary">
          {note}
        </p>
      ) : null}
      <Button type="submit" loading={pending}>
        إنشاء الكوبون
      </Button>
    </form>
  );
}
