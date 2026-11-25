// Variant price editor island ("use client"): PATCH variants/[id]/price.
// The server re-validates the price shape and the governance; the UI renders
// the confirmed row.
//
// A no-op price submission is blocked in the UI: the server compares the
// NORMALIZED decimal with the raw payload, so re-submitting the current price
// as "25.00" reaches the write path, tries to record a price-history row with
// the same old and new price, and the frozen price-history check rejects it —
// the API would answer a generic failure. The UI compares NUMERICALLY and
// refuses the no-op with a readable message instead.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Info } from "lucide-react";
import { apiRequest } from "@/lib/frontend/api-client";
import { adminErrorMessage } from "@/lib/admin/errors";
import { AdminButton, AdminField, AdminInput, AdminSelect } from "@/components/admin/ui/controls";

export function VariantPriceEditor({
  variants,
  canSeePrices = true,
}: {
  variants: { id: string; name: string; price: string }[];
  /** `prices.view` — may the operator SEE the current price? */
  canSeePrices?: boolean;
}) {
  const router = useRouter();
  const [variantId, setVariantId] = useState(variants[0]?.id ?? "");
  const [price, setPrice] = useState("");
  const [reason, setReason] = useState("");
  const [feedback, setFeedback] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  if (variants.length === 0) {
    return <p className="adm-hint">مفيش أشكال بيع لهذا المنتج، فمفيش سعر تتغيره.</p>;
  }

  if (!canSeePrices) {
    return (
      <div className="adm-note adm-note--info" role="note">
        <Info size={16} className="adm-note-icon" aria-hidden="true" />
        <div>
          الأسعار مش معروضة لحسابك. لو محتاج تعدّل سعر، كلّم مالك المتجر عشان يضيف صلاحية عرض
          الأسعار لحسابك.
        </div>
      </div>
    );
  }

  const current = variants.find((variant) => variant.id === variantId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending || variantId === "") return;
    setFeedback(null);
    if (!/^\d+(\.\d{1,2})?$/.test(price.trim()) || Number(price) <= 0) {
      setFeedback({
        tone: "danger",
        text: "السعر لازم يكون رقم موجب برقمين عشريين على الأكثر.",
      });
      return;
    }
    if (current && Number(price.trim()) === Number(current.price)) {
      setFeedback({
        tone: "danger",
        text: `السعر الحالي هو ${current.price} — لا يوجد تغيير لحفظه.`,
      });
      return;
    }
    setPending(true);
    try {
      await apiRequest(`/api/admin/catalog/variants/${variantId}/price`, {
        method: "PATCH",
        body: { price: price.trim(), ...(reason.trim() === "" ? {} : { reason: reason.trim() }) },
      });
      setFeedback({ tone: "success", text: "تم تحديث السعر." });
      router.refresh();
      setPrice("");
      setReason("");
    } catch (error) {
      setFeedback({
        tone: "danger",
        text: adminErrorMessage(error, "تعذّر تحديث السعر — راجع الرقم وجرب تاني."),
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="adm-form">
      <AdminField label="شكل البيع" hint="اختار الشكل اللي هتغيّر سعره.">
        {({ inputId, describedBy }) => (
          <AdminSelect
            inputId={inputId}
            describedBy={describedBy}
            value={variantId}
            onChange={(e) => setVariantId(e.target.value)}
          >
            {variants.map((variant) => (
              <option key={variant.id} value={variant.id}>
                {`${variant.name} — ${variant.price} ج.م`}
              </option>
            ))}
          </AdminSelect>
        )}
      </AdminField>

      <div className="adm-form-grid">
        <AdminField label="السعر الجديد" hint="السعر بالجنيه — لازم يكون مختلف عن السعر الحالي.">
          {({ inputId, describedBy }) => (
            <AdminInput
              inputId={inputId}
              describedBy={describedBy}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="decimal"
              placeholder="0.00"
            />
          )}
        </AdminField>

        <AdminField label="سبب التغيير" optional hint="سطر واحد بيوضح ليه السعر اتغيّر.">
          {({ inputId, describedBy }) => (
            <AdminInput
              inputId={inputId}
              describedBy={describedBy}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
            />
          )}
        </AdminField>
      </div>

      {feedback ? (
        <div
          className={`adm-note ${feedback.tone === "success" ? "adm-note--accent" : "adm-note--danger"}`}
          role="alert"
        >
          <Info size={16} className="adm-note-icon" aria-hidden="true" />
          <div>{feedback.text}</div>
        </div>
      ) : null}

      <div className="adm-btn-row">
        <AdminButton type="submit" loading={pending}>
          احفظ السعر
        </AdminButton>
      </div>

      <p className="adm-hint">
        كل تغيير سعر بيتسجل في تاريخ الأسعار بالتاريخ والسبب، عشان أي مراجعة بعدين تقدر تعرف السعر
        اتغيّر إزاي.
      </p>
    </form>
  );
}
