// FE-10C coupon patch island ("use client"): limits/window/active toggle.
// All fields optional-only; server owns validation + enforcement.
//
// `isActive` is sent ONLY when the operator holds `coupons.disable` — the
// server requires that key for any body containing `isActive`, and requires
// `coupons.update` for the other fields. Sending `isActive` unconditionally
// made every save need `coupons.disable` and blocked `coupons.update`-only
// operators from saving anything at all.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest, displayFailure } from "@/lib/frontend/api-client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export function CouponPatchForm({
  id,
  usageLimit,
  perCustomerLimit,
  minimumOrderAmount,
  isActive,
  canDisable,
}: {
  id: string;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  minimumOrderAmount: string | null;
  isActive: boolean;
  /** True when the session holds `coupons.disable` (the server key for isActive). */
  canDisable: boolean;
}) {
  const router = useRouter();
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
    // Positive integer limits only (server: usageLimit/perCustomerLimit are
    // positive integers). NaN must never be sent — it would silently clear
    // the limit server-side.
    const usage = limits.usageLimit.trim() === "" ? null : Number(limits.usageLimit.trim());
    const perCustomer =
      limits.perCustomerLimit.trim() === "" ? null : Number(limits.perCustomerLimit.trim());
    if (usage !== null && (!Number.isInteger(usage) || usage <= 0)) {
      setNote("حد الاستخدام يجب أن يكون رقمًا صحيحًا أكبر من صفر.");
      return;
    }
    if (perCustomer !== null && (!Number.isInteger(perCustomer) || perCustomer <= 0)) {
      setNote("حد العميل يجب أن يكون رقمًا صحيحًا أكبر من صفر.");
      return;
    }
    setPending(true);
    try {
      await apiRequest(`/api/admin/coupons/${id}`, {
        method: "PATCH",
        body: {
          usageLimit: usage,
          perCustomerLimit: perCustomer,
          minimumOrderAmount: limits.minimumOrderAmount.trim() === "" ? null : limits.minimumOrderAmount.trim(),
          ...(canDisable ? { isActive: active } : {}),
        },
      });
      notify("success", "تم حفظ الكوبون.");
      router.refresh();
    } catch (error) {
      setNote(displayFailure(error, "تعذّر الحفظ."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="grid max-w-[520px] gap-3">
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
      {canDisable ? (
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-5 w-5" />
          نشط
        </label>
      ) : (
        <p className="text-xs text-secondary">
          حالة التفعيل تحتاج صلاحية <span dir="ltr" className="font-mono">coupons.disable</span> — لم تُرسل.
        </p>
      )}
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
