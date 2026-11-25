// ADM-07 Step 2 — pick the offer's products from the REAL catalogue.
//
// The rows come from the same catalogue the storefront reads (active, not
// deleted products with their own variants, prices and images), so the owner
// chooses from what the customer actually sees — never from a list of ids.
// Adding a product calls the same target endpoint the form below uses; the
// offer itself is only changed through the backend, which validates the
// target.

import { formatMoney } from "@/lib/admin/terminology";
import type { PromotionCatalogRow } from "@/lib/admin/promotion-catalog";
import { AddPromotionTargetButton } from "@/components/admin/promotion-target-button";

export function PromotionCatalogPicker({
  promotionId,
  search,
  rows,
  targetedProductIds,
  canSeePrices,
  failed,
}: {
  promotionId: string;
  /** The search term the owner typed (kept in the field). */
  search: string;
  rows: PromotionCatalogRow[];
  targetedProductIds: string[];
  canSeePrices: boolean;
  /** The catalogue could not be read — the panel says so instead of lying. */
  failed: boolean;
}) {
  const targeted = new Set(targetedProductIds);

  return (
    <div className="adm-form">
      <form method="get" action={`/admin/promotions/${promotionId}`} className="adm-filters">
        <div className="adm-filters-grid">
          <div className="adm-field adm-filter-search">
            <label className="adm-label" htmlFor="pick-search">
              دوّر على منتج بالاسم
            </label>
            <input
              id="pick-search"
              name="pick"
              className="adm-input"
              defaultValue={search}
              maxLength={80}
              placeholder="اسم المنتج"
              autoComplete="off"
            />
          </div>
          <div className="adm-btn-row">
            <button type="submit" className="adm-btn adm-btn--secondary">
              بحث في الكتالوج
            </button>
          </div>
        </div>
      </form>

      {failed ? (
        <p className="adm-hint">مقدرناش نحمّل منتجات الكتالوج دلوقتي. جرّب تعمل تحديث للصفحة.</p>
      ) : rows.length === 0 ? (
        <p className="adm-hint">
          {search
            ? "مفيش منتج بالاسم ده في الكتالوج. جرّب كلمة تانية."
            : "مفيش منتجات في الكتالوج تقدر تختار منها دلوقتي."}
        </p>
      ) : (
        <ul className="adm-picker-list">
          {rows.map((row) => (
            <li className="adm-picker-row" key={row.id}>
              <span className="adm-picker-media">
                {row.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={row.imageUrl} alt={row.name} loading="lazy" />
                ) : (
                  <span aria-hidden="true">بلا صورة</span>
                )}
              </span>
              <span className="adm-cell-main">
                <span className="adm-cell-title">{row.name}</span>
                <span className="adm-cell-sub">
                  {row.brandName ?? "بدون علامة تجارية"} · {row.variantCount} شكل بيع
                  {canSeePrices && row.price ? ` · يبدأ من ${formatMoney(row.price)}` : null}
                </span>
              </span>
              {targeted.has(row.id) ? (
                <span className="adm-cell-sub">مضاف للعرض بالفعل</span>
              ) : (
                <AddPromotionTargetButton
                  promotionId={promotionId}
                  targetType="PRODUCT"
                  targetId={row.id}
                  label="أضف للعرض"
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
