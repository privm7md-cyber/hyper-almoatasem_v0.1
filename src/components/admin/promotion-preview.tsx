// ADM-07 live price preview (client island).
//
// The card copies the storefront's price contract (image, name, old price
// struck through, new price, saving badge, unit basis) so the owner sees
// EXACTLY what the customer sees — but every number is computed by the
// backend pricing engine through POST /api/admin/promotions/{id}/preview.
// The browser never does discount arithmetic, and the preview never writes:
// trying a value here does not change the stored offer.

"use client";

import { useState } from "react";
import { apiRequest } from "@/lib/frontend/api-client";
import { adminErrorMessage } from "@/lib/admin/errors";
import { AdminButton, AdminField, AdminInput } from "@/components/admin/ui/controls";
import { Pill } from "@/components/admin/ui/surfaces";

export interface PromotionPreviewRowView {
  variantId: string;
  productId: string;
  productName: string;
  variantName: string;
  imageUrl: string | null;
  unitLabel: string;
  originalPrice: string;
  discountAmount: string;
  finalPrice: string;
  savingsPercent: string;
  applies: boolean;
  winnerName: string | null;
  blockedBy: string | null;
  reason: string | null;
  availableQuantity: string | null;
}

const TYPE_FIELD: Record<string, { label: string; hint: string; key: "discountPercent" | "discountAmount" | "fixedPrice" } | null> = {
  PERCENTAGE: { label: "نسبة الخصم", hint: "رقم من 1 لحد 100. جرّب قيمة وشوف السعر هيبقى إيه.", key: "discountPercent" },
  FIXED_AMOUNT: { label: "مبلغ الخصم", hint: "مبلغ بالجنيه المصري. جرّب قيمة وشوف السعر هيبقى إيه.", key: "discountAmount" },
  FIXED_PRICE: { label: "السعر الثابت", hint: "السعر النهائي للمنتج بالجنيه المصري.", key: "fixedPrice" },
  BUY_X_GET_Y: null,
};

/** The storefront's price basis line — a price is never divided by a weight. */
function basisLabel(row: PromotionPreviewRowView): string {
  return row.unitLabel === "قطعة" ? "بالقطعة" : `سعر ${row.unitLabel}`;
}

export function PromotionPricePreview({
  promotionId,
  type,
  initialValue,
  initialRows,
  offerStateLabel,
}: {
  promotionId: string;
  type: string;
  initialValue: string;
  initialRows: PromotionPreviewRowView[];
  offerStateLabel: string;
}) {
  const field = TYPE_FIELD[type] ?? null;
  const [value, setValue] = useState(initialValue);
  const [rows, setRows] = useState(initialRows);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  async function run() {
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      const query = new URLSearchParams();
      if (field && value.trim() !== "") query.set(field.key, value.trim());
      const res = await apiRequest<{ rows: PromotionPreviewRowView[] }>(
        `/api/admin/promotions/${promotionId}/preview?${query.toString()}`,
      );
      setRows(res.data?.rows ?? []);
      setUpdatedAt(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
    } catch (err) {
      setError(adminErrorMessage(err, "مش قادرين نحسب المعاينة دلوقتي. جرّب تاني."));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="adm-form">
      {field ? (
        <div className="adm-form-grid">
          <AdminField label={field.label} optional hint={field.hint}>
            {({ inputId, describedBy }) => (
              <AdminInput
                inputId={inputId}
                describedBy={describedBy}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                inputMode="decimal"
              />
            )}
          </AdminField>
          <div className="adm-field">
            <span className="adm-label">معاينة</span>
            <div className="adm-btn-row">
              <AdminButton type="button" onClick={() => void run()} loading={pending} size="sm">
                احسب السعر
              </AdminButton>
            </div>
          </div>
        </div>
      ) : (
        <p className="adm-hint">
          نوع الخصم ده بيتحسب على الكميات، فالمعاينة بتظهر مع كل سطر في الطلب وقت الشراء.
        </p>
      )}

      {error ? (
        <p role="alert" className="adm-error">
          {error}
        </p>
      ) : null}

      {updatedAt ? (
        <p className="adm-hint" aria-live="polite">
          آخر معاينة اتحسبت الساعة {updatedAt}. الأرقام دي من محرك التسعير نفسه، والعرض لسه محفوظ زي ما هو.
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="adm-hint">
          مفيش منتجات مستهدفة تتعمل عليها معاينة. ضيف منتجات للعرض الأول، وكمان لازم يكون في منتجات مستهدفة
          قبل ما العرض يشتغل على أي طلب.
        </p>
      ) : (
        <div className="adm-cards">
          {rows.map((row) => (
            <article className="adm-card" key={row.variantId} aria-label={row.productName}>
              <div className="adm-preview-media">
                {row.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={row.imageUrl} alt={row.productName} loading="lazy" className="adm-preview-img" />
                ) : (
                  <span className="adm-preview-img adm-preview-img--empty">بلا صورة</span>
                )}
              </div>
              <span className="adm-card-title">{row.productName}</span>
              <span className="adm-cell-sub">{row.variantName}</span>

              <p className="adm-preview-prices">
                <s className="adm-preview-old">
                  <bdi>{row.originalPrice} ج.م</bdi>
                </s>
                <bdi className="adm-preview-new">{row.finalPrice} ج.م</bdi>
                <span className="adm-preview-basis">{basisLabel(row)}</span>
              </p>

              <p className="adm-cell-sub">
                الخصم: <bdi>{row.discountAmount} ج.م</bdi> — توفير {row.savingsPercent}%
              </p>

              {row.applies ? (
                <Pill tone="accent">العرض ده هو اللي بيحسب الخصم</Pill>
              ) : row.winnerName ? (
                <Pill tone="neutral">العرض الفائز: {row.winnerName}</Pill>
              ) : (
                <Pill tone="neutral">مفيش خصم على المنتج ده</Pill>
              )}

              {row.reason ? <p className="adm-cell-sub">{row.reason}</p> : null}

              <p className="adm-cell-sub">
                {row.availableQuantity === null
                  ? "التوفر غير محدد — مفيش سجل رصيد للمنتج ده"
                  : `المتاح: ${row.availableQuantity} ${row.unitLabel}`}
              </p>
            </article>
          ))}
        </div>
      )}

      <p className="adm-hint">
        حالة العرض دلوقتي: {offerStateLabel}. المعاينة بتحسب الأرقام كأن العرض شغّال على المنتج ده، وبنفس
        قواعد الأولوية والتراكم اللي بيحصل في الطلب الحقيقي.
      </p>
    </div>
  );
}
