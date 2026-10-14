// FE-10C coupon patch island ("use client"): limits/window/active toggle.
// All fields optional-only; server owns validation + enforcement.

"use client";

import { useState } from "react";
import { apiRequest, displayFailure } from "@/lib/frontend/api-client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export function CouponPatchForm({
  id,
  usageLimit,
  perCustomerLimit,
  minimumOrderAmount,
  isActive,
}: {
  id: string;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  minimumOrderAmount: string | null;
  isActive: boolean;
}) {
  const { notify } = useToast();
  const [limits, setLimits] = useState({
    usageLimit: usageLimit === null ? "" : String(usageLimit),
    perCustomerLimit: perCustomerLimit === null ? "" : String(perCustomerLimit),
    minimumOrderAmount: minimumOrderAmount ?? "",
  });
  const [active, setActive] = useState(isActive);
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function set<K extends keyof typeof limits>(key: K, value: string) {
    setLimits((prev) => ({ ...prev, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setNote(null);
    setPending(true);
    try {
      await apiRequest(`/api/admin/coupons/${id}`, {
        method: "PATCH",
        body: {
          usageLimit: limits.usageLimit.trim() === "" ? null : Number(limits.usageLimit),
          perCustomerLimit: limits.perCustomerLimit.trim() === "" ? null : Number(limits.perCustomerLimit),
          minimumOrderAmount: limits.minimumOrderAmount.trim() === "" ? null : limits.minimumOrderAmount.trim(),
          isActive: active,
        },
      });
      notify("success", "تم حفظ الكوبون.");
    } catch (error) {
      setNote(displayFailure(error, "تعذّر الحفظ."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="grid max-w-[520px] gap-3">
      <div className="grid grid-cols-3 gap-2">
        <label className="grid gap-1 text-xs font-semibold">
          حد الاستخدام (فارغ = بلا حد)
          <input value={limits.usageLimit} onChange={(e) => set("usageLimit", e.target.value)} inputMode="numeric" className="min-h-[44px] rounded-control border border-line bg-white px-2" />
        </label>
        <label className="grid gap-1 text-xs font-semibold">
          حد العميل
          <input value={limits.perCustomerLimit} onChange={(e) => set("perCustomerLimit", e.target.value)} inputMode="numeric" className="min-h-[44px] rounded-control border border-line bg-white px-2" />
        </label>
        <label className="grid gap-1 text-xs font-semibold">
          حد أدنى للطلب
          <input value={limits.minimumOrderAmount} onChange={(e) => set("minimumOrderAmount", e.target.value)} inputMode="decimal" className="min-h-[44px] rounded-control border border-line bg-white px-2" />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-5 w-5" />
        نشط
      </label>
      {note ? (
        <p role="alert" className="text-sm text-secondary">
          {note}
        </p>
      ) : null}
      <Button type="submit" loading={pending}>
        حفظ الكوبون
      </Button>
    </form>
  );
}
