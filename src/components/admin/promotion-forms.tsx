// FE-10C promotion forms island ("use client"): create-basic + status flip + target add +
// rules put + buy-get put. Server validates type-dependent shapes, windows, and references.

"use client";

import { useState } from "react";
import { apiRequest, displayFailure } from "@/lib/frontend/api-client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

const TYPES = ["PERCENTAGE", "FIXED_AMOUNT", "BUY_X_GET_Y", "FIXED_PRICE"] as const;
const SCOPES = ["LINE", "ORDER"] as const;

function Note({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="alert" className="text-sm text-secondary">
      {text}
    </p>
  );
}

export function PromotionCreateForm() {
  const { notify } = useToast();
  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof TYPES)[number]>("PERCENTAGE");
  const [scope, setScope] = useState<(typeof SCOPES)[number]>("LINE");
  const [value, setValue] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setNote(null);
    if (name.trim() === "") {
      setNote("الاسم مطلوب.");
      return;
    }
    const body: Record<string, unknown> = { name: name.trim(), type, scope };
    if (value.trim() !== "") {
      if (type === "PERCENTAGE") body.discountPercent = value.trim();
      else if (type === "FIXED_AMOUNT") body.discountAmount = value.trim();
      else if (type === "FIXED_PRICE") body.fixedPrice = value.trim();
    }
    setPending(true);
    try {
      await apiRequest("/api/admin/promotions", { method: "POST", body });
      notify("success", "تم إنشاء العرض كمسودة.");
      setName("");
      setValue("");
    } catch (error) {
      setNote(displayFailure(error, "تعذّر الإنشاء."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="grid max-w-[520px] gap-3">
      <label className="grid gap-1 text-sm font-semibold">
        الاسم
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={160} className="min-h-[44px] rounded-control border border-line bg-white px-2" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1 text-sm font-semibold">
          النوع
          <select value={type} onChange={(e) => setType(e.target.value as (typeof TYPES)[number])} className="min-h-[44px] rounded-control border border-line bg-white px-2">
            {TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          النطاق
          <select value={scope} onChange={(e) => setScope(e.target.value as (typeof SCOPES)[number])} className="min-h-[44px] rounded-control border border-line bg-white px-2">
            {SCOPES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="grid gap-1 text-sm font-semibold">
        القيمة حسب النوع (اختياري: نسبة/مبلغ/سعر ثابت)
        <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder="10 / 25.00" className="min-h-[44px] rounded-control border border-line bg-white px-2" />
      </label>
      <Note text={note} />
      <Button type="submit" loading={pending}>
        إنشاء العرض
      </Button>
    </form>
  );
}

export function PromotionStatusForm({ id, status }: { id: string; status: string }) {
  const { notify } = useToast();
  const [next, setNext] = useState(status);
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setNote(null);
    setPending(true);
    try {
      await apiRequest(`/api/admin/promotions/${id}`, { method: "PATCH", body: { status: next } });
      notify("success", "تم تحديث الحالة.");
    } catch (error) {
      setNote(displayFailure(error, "تعذّر التحديث. التفعيل يتطلب استهدافًا مكتملًا."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-wrap items-end gap-2">
      <label className="grid gap-1 text-sm font-semibold">
        الحالة
        <select value={next} onChange={(e) => setNext(e.target.value)} className="min-h-[44px] rounded-control border border-line bg-white px-2">
          <option value="DRAFT">مسودة</option>
          <option value="ACTIVE">مفعّل</option>
          <option value="DISABLED">موقوف</option>
        </select>
      </label>
      <Button type="submit" size="sm" loading={pending}>
        حفظ الحالة
      </Button>
      <Note text={note} />
    </form>
  );
}

const TARGET_TYPES = ["VARIANT", "PRODUCT", "BRAND", "CATEGORY"] as const;

export function TargetAddForm({ promotionId }: { promotionId: string }) {
  const { notify } = useToast();
  const [targetType, setTargetType] = useState<(typeof TARGET_TYPES)[number]>("PRODUCT");
  const [targetId, setTargetId] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setNote(null);
    if (targetId.trim() === "") {
      setNote("أدخل معرف الهدف (UUID).");
      return;
    }
    setPending(true);
    try {
      await apiRequest(`/api/admin/promotions/${promotionId}/targets`, {
        method: "POST",
        body: { targetType, targetId: targetId.trim() },
      });
      notify("success", "تمت إضافة الاستهداف.");
      setTargetId("");
    } catch (error) {
      setNote(displayFailure(error, "تعذّرت الإضافة."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-wrap items-end gap-2">
      <label className="grid gap-1 text-xs font-semibold">
        النوع
        <select value={targetType} onChange={(e) => setTargetType(e.target.value as (typeof TARGET_TYPES)[number])} className="min-h-[44px] rounded-control border border-line bg-white px-2">
          {TARGET_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-xs font-semibold">
        المعرف (UUID)
        <input value={targetId} onChange={(e) => setTargetId(e.target.value)} dir="ltr" className="min-h-[44px] rounded-control border border-line bg-white px-2 font-mono text-xs" />
      </label>
      <Button type="submit" size="sm" loading={pending}>
        إضافة
      </Button>
      <Note text={note} />
    </form>
  );
}

export function RulesPutForm({ promotionId }: { promotionId: string }) {
  const { notify } = useToast();
  const [minimumQuantity, setMinimumQuantity] = useState("");
  const [minimumAmount, setMinimumAmount] = useState("");
  const [maximumDiscount, setMaximumDiscount] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setNote(null);
    setPending(true);
    try {
      await apiRequest(`/api/admin/promotions/${promotionId}/rules`, {
        method: "PUT",
        body: {
          ...(minimumQuantity.trim() === "" ? {} : { minimumQuantity: minimumQuantity.trim() }),
          ...(minimumAmount.trim() === "" ? {} : { minimumAmount: minimumAmount.trim() }),
          ...(maximumDiscount.trim() === "" ? {} : { maximumDiscount: maximumDiscount.trim() }),
        },
      });
      notify("success", "تم حفظ القواعد.");
    } catch (error) {
      setNote(displayFailure(error, "تعذّر الحفظ."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="grid max-w-[520px] gap-2">
      <div className="grid grid-cols-3 gap-2">
        <label className="grid gap-1 text-xs font-semibold">
          حد الكمية
          <input value={minimumQuantity} onChange={(e) => setMinimumQuantity(e.target.value)} inputMode="decimal" className="min-h-[44px] rounded-control border border-line bg-white px-2" />
        </label>
        <label className="grid gap-1 text-xs font-semibold">
          حد المبلغ
          <input value={minimumAmount} onChange={(e) => setMinimumAmount(e.target.value)} inputMode="decimal" className="min-h-[44px] rounded-control border border-line bg-white px-2" />
        </label>
        <label className="grid gap-1 text-xs font-semibold">
          سقف الخصم
          <input value={maximumDiscount} onChange={(e) => setMaximumDiscount(e.target.value)} inputMode="decimal" className="min-h-[44px] rounded-control border border-line bg-white px-2" />
        </label>
      </div>
      <Note text={note} />
      <Button type="submit" size="sm" loading={pending}>
        حفظ القواعد
      </Button>
    </form>
  );
}

export function BuyGetPutForm({ promotionId }: { promotionId: string }) {
  const { notify } = useToast();
  const [buyQuantity, setBuyQuantity] = useState("");
  const [getQuantity, setGetQuantity] = useState("");
  const [discountPercent, setDiscountPercent] = useState("");
  const [freeVariantId, setFreeVariantId] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setNote(null);
    if (buyQuantity.trim() === "" || getQuantity.trim() === "" || discountPercent.trim() === "") {
      setNote("أكمل buy/get/discount (الحقول الثلاثة مطلوبة).");
      return;
    }
    setPending(true);
    try {
      await apiRequest(`/api/admin/promotions/${promotionId}/buy-get`, {
        method: "PUT",
        body: {
          buyQuantity: buyQuantity.trim(),
          getQuantity: getQuantity.trim(),
          discountPercent: discountPercent.trim(),
          ...(freeVariantId.trim() === "" ? {} : { freeVariantId: freeVariantId.trim() }),
        },
      });
      notify("success", "تم حفظ قاعدة الاشترِ-واحصل.");
    } catch (error) {
      setNote(displayFailure(error, "تعذّر الحفظ."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="grid max-w-[520px] gap-2">
      <div className="grid grid-cols-3 gap-2">
        <label className="grid gap-1 text-xs font-semibold">
          buyQuantity
          <input value={buyQuantity} onChange={(e) => setBuyQuantity(e.target.value)} inputMode="decimal" className="min-h-[44px] rounded-control border border-line bg-white px-2" />
        </label>
        <label className="grid gap-1 text-xs font-semibold">
          getQuantity
          <input value={getQuantity} onChange={(e) => setGetQuantity(e.target.value)} inputMode="decimal" className="min-h-[44px] rounded-control border border-line bg-white px-2" />
        </label>
        <label className="grid gap-1 text-xs font-semibold">
          discountPercent
          <input value={discountPercent} onChange={(e) => setDiscountPercent(e.target.value)} inputMode="decimal" className="min-h-[44px] rounded-control border border-line bg-white px-2" />
        </label>
      </div>
      <label className="grid gap-1 text-xs font-semibold">
        freeVariantId (اختياري، UUID)
        <input value={freeVariantId} onChange={(e) => setFreeVariantId(e.target.value)} dir="ltr" className="min-h-[44px] rounded-control border border-line bg-white px-2 font-mono text-xs" />
      </label>
      <Note text={note} />
      <Button type="submit" size="sm" loading={pending}>
        حفظ القاعدة
      </Button>
    </form>
  );
}
