// Products filter bar — a plain GET form, so every filter runs on the server.
// A key from parsed URL values resets uncontrolled controls on navigation/back.
//
// Each control maps to a real query parameter of the products list. The
// visible text is always the Arabic label from the terminology module; the
// machine token travels in the field value and never reaches the screen.

import Link from "next/link";
import { AdminInput, AdminSelect } from "@/components/admin/ui/controls";
import { PRODUCT_TYPE_LABELS, UNIT_LABELS } from "@/lib/admin/terminology";

export interface ProductFilterValues {
  search: string;
  /** "" = كل طرق البيع. */
  type: "" | "PIECE" | "WEIGHT";
  /** "" = كل الوحدات. */
  unit: "" | "PIECE" | "KG" | "GRAM" | "LITER" | "ML";
  category: string;
  brand: string;
  /** "" = all nonarchived products. */
  state: "" | "displayed" | "hidden" | "archived";
  /** Legacy URL filter; the state picker shows its equivalent on old links. */
  active: "" | "true" | "false";
}

export const DEFAULT_FILTERS: ProductFilterValues = {
  search: "",
  type: "",
  unit: "",
  category: "",
  brand: "",
  state: "",
  active: "",
};

export function hasActiveFilters(values: ProductFilterValues): boolean {
  return (
    values.search !== "" ||
    values.type !== "" ||
    values.unit !== "" ||
    values.category !== "" ||
    values.brand !== "" ||
    values.state !== "" ||
    values.active !== ""
  );
}

export function ProductFilters({
  values,
  categories,
  brands,
}: {
  values: ProductFilterValues;
  /** null = read failure, [] = a genuinely empty picker. */
  categories: { id: string; name: string }[] | null;
  brands: { id: string; name: string }[] | null;
}) {
  const formKey = JSON.stringify([
    values.search, values.type, values.unit, values.category, values.brand, values.state, values.active,
  ]);
  return (
    <form key={formKey} method="get" action="/admin/products" className="adm-filters" aria-label="فلترة المنتجات">
      <div className="adm-filters-grid">
        <div className="adm-filter-search adm-field">
          <label htmlFor="pf-search" className="adm-label">
            بحث في المنتجات
          </label>
          <AdminInput
            inputId="pf-search"
            name="search"
            defaultValue={values.search}
            placeholder="اسم المنتج أو الكود في الرابط أو الباركود"
            maxLength={160}
            type="search"
          />
        </div>

        <div className="adm-field">
          <label htmlFor="pf-type" className="adm-label">
            طريقة البيع
          </label>
          <AdminSelect inputId="pf-type" name="type" defaultValue={values.type}>
            <option value="">كل طرق البيع</option>
            {Object.entries(PRODUCT_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </AdminSelect>
        </div>

        <div className="adm-field">
          <label htmlFor="pf-unit" className="adm-label">
            وحدة البيع
          </label>
          <AdminSelect inputId="pf-unit" name="unit" defaultValue={values.unit}>
            <option value="">كل الوحدات</option>
            {Object.entries(UNIT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </AdminSelect>
        </div>

        <div className="adm-field">
          <label htmlFor="pf-category" className="adm-label">
            التصنيف
          </label>
          <AdminSelect inputId="pf-category" name="category" defaultValue={values.category}>
            <option value="">كل التصنيفات</option>
            {values.category && !categories?.some((category) => category.id === values.category) ? (
              <option value={values.category}>التصنيف المحدد غير متاح في القائمة</option>
            ) : null}
            {categories?.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </AdminSelect>
          {categories?.length === 0 ? <p className="adm-hint">لا توجد تصنيفات متاحة للفلترة.</p> : null}
        </div>

        <div className="adm-field">
          <label htmlFor="pf-brand" className="adm-label">
            العلامة التجارية
          </label>
          <AdminSelect inputId="pf-brand" name="brand" defaultValue={values.brand}>
            <option value="">كل العلامات التجارية</option>
            {values.brand && !brands?.some((brand) => brand.id === values.brand) ? (
              <option value={values.brand}>العلامة التجارية المحددة غير متاحة في القائمة</option>
            ) : null}
            {brands?.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </AdminSelect>
          {brands?.length === 0 ? <p className="adm-hint">لا توجد علامات تجارية متاحة للفلترة.</p> : null}
        </div>

        <div className="adm-field">
          <label htmlFor="pf-state" className="adm-label">
            حالة المنتج
          </label>
          <AdminSelect
            inputId="pf-state"
            name="state"
            defaultValue={values.state || (values.active === "true" ? "displayed" : values.active === "false" ? "hidden" : "")}
          >
            <option value="">الكل (غير المؤرشف)</option>
            <option value="displayed">معروض في المتجر</option>
            <option value="hidden">مخفي من المتجر</option>
            <option value="archived">مؤرشف</option>
          </AdminSelect>
        </div>
      </div>

      <div className="adm-btn-row">
        <button type="submit" className="adm-btn adm-btn--primary">
          طبّق الفلترة
        </button>
        {hasActiveFilters(values) ? (
          <Link href="/admin/products" className="adm-btn adm-btn--ghost">
            ألغِ الفلترة
          </Link>
        ) : null}
      </div>
    </form>
  );
}
