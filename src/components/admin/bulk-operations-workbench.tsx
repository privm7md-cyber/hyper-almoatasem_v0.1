"use client";

import { useState } from "react";
import Link from "next/link";
import { apiRequest, AppError, mutationTimeoutSignal } from "@/lib/frontend/api-client";
import type { CatalogDataQualityAuditReport } from "@/lib/catalog/data-quality";
import type {
  BulkPriceMode,
  BulkProductAction,
  BulkProductOperationResult,
} from "@/lib/catalog/bulk-operations";
import { Note, Panel } from "@/components/admin/ui/surfaces";

export interface BulkWorkbenchProduct {
  id: string;
  name: string;
  nameTrust: string;
  slug: string;
  productType: string;
  unit: string;
  isActive: boolean;
  archived: boolean;
  categoryId: string;
  categoryName: string;
  brandId: string | null;
  brandName: string | null;
  variants: Array<{
    id: string;
    name: string;
    price: string;
    sizeValue: string | null;
    sizeUnit: string | null;
  }>;
}

interface WorkbenchCategory {
  id: string;
  name: string;
  isActive: boolean;
}

interface WorkbenchBrand {
  id: string;
  name: string;
  isActive: boolean;
}

interface BulkOperationsWorkbenchProps {
  initialAudit: CatalogDataQualityAuditReport;
  categories: WorkbenchCategory[];
  brands: WorkbenchBrand[];
  initialProducts: BulkWorkbenchProduct[];
  permissions: {
    canUpdateProducts: boolean;
    canUpdatePrices: boolean;
    canDeleteProducts: boolean;
  };
}

export function BulkOperationsWorkbench({
  initialAudit,
  categories,
  brands,
  initialProducts,
  permissions,
}: BulkOperationsWorkbenchProps) {
  const [audit, setAudit] = useState<CatalogDataQualityAuditReport>(initialAudit);
  const [products, setProducts] = useState<BulkWorkbenchProduct[]>(initialProducts);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Filter controls
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<"all" | "active" | "hidden" | "archived">("all");
  const [issueFilter, setIssueFilter] = useState<"" | "under_1_egp" | "piece_weight_unit" | "missing_size_unit">("");
  const [loadingList, setLoadingList] = useState(false);

  // Action controls
  const [action, setAction] = useState<BulkProductAction>("DEACTIVATE");
  const [reason, setReason] = useState("");
  const [categoryId, setCategoryId] = useState(categories.find((c) => c.isActive)?.id ?? "");
  const [brandId, setBrandId] = useState<string>("");
  const [priceMode, setPriceMode] = useState<BulkPriceMode>("PERCENT");
  const [amount, setAmount] = useState("");

  // Two-step confirmation & feedback state
  const [preview, setPreview] = useState<BulkProductOperationResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  function invalidatePreview() {
    setPreview(null);
    setConfirmed(false);
    setErrorMsg(null);
    setSuccessMsg(null);
  }

  async function reloadProducts(nextSearch = search, nextState = stateFilter, nextIssue = issueFilter) {
    setLoadingList(true);
    setErrorMsg(null);
    try {
      const sp = new URLSearchParams();
      if (nextSearch.trim()) sp.set("search", nextSearch.trim());
      if (nextState !== "all") sp.set("state", nextState);
      if (nextIssue) sp.set("issue", nextIssue);
      sp.set("limit", "40");
      const res = await apiRequest<{
        audit: CatalogDataQualityAuditReport;
        products: BulkWorkbenchProduct[];
      }>(`/api/admin/catalog/products/bulk?${sp.toString()}`);
      setAudit(res.data.audit);
      setProducts(res.data.products);
      setSelectedIds([]);
      invalidatePreview();
    } catch (err) {
      setErrorMsg(err instanceof AppError ? err.message : "تعذر تحديث قائمة المنتجات.");
    } finally {
      setLoadingList(false);
    }
  }

  function toggleOne(id: string) {
    invalidatePreview();
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleAllVisible() {
    invalidatePreview();
    const visibleIds = products.map((p) => p.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
    setSelectedIds(allSelected ? [] : visibleIds);
  }

  function buildPayload(dryRun: boolean) {
    return {
      action,
      productIds: selectedIds,
      reason: reason.trim(),
      dryRun,
      ...(dryRun ? {} : { confirmed,previewReceipt:preview?.previewReceipt }),
      ...(action === "SET_CATEGORY" ? { categoryId } : {}),
      ...(action === "SET_BRAND" ? { brandId: brandId || null } : {}),
      ...(action === "ADJUST_PRICE" ? { priceMode, amount: amount.trim() } : {}),
    };
  }

  async function handlePreview() {
    setBusy(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    setConfirmed(false);
    try {
      const res = await apiRequest<BulkProductOperationResult>("/api/admin/catalog/products/bulk", {
        method: "POST",
        body: buildPayload(true),
        signal: mutationTimeoutSignal(),
      });
      setPreview(res.data);
    } catch (err) {
      setPreview(null);
      setErrorMsg(err instanceof AppError ? err.message : "تعذر إنشاء معاينة التعديلات.");
    } finally {
      setBusy(false);
    }
  }

  async function handleApply() {
    if (!preview || !confirmed) return;
    setBusy(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await apiRequest<BulkProductOperationResult>("/api/admin/catalog/products/bulk", {
        method: "POST",
        body: buildPayload(false),
        signal: mutationTimeoutSignal(),
      });
      setPreview(null);
      setConfirmed(false);
      setSuccessMsg(
        `تم تطبيق العملية بنجاح على ${res.data.summary.updatedProductCount} منتجًا (${res.data.summary.updatedVariantCount} متغيرًا).`,
      );
      await reloadProducts();
    } catch (err) {
      setErrorMsg(err instanceof AppError ? err.message : "فشل تطبيق العملية الجماعية دون تعديل جزئي.");
    } finally {
      setBusy(false);
    }
  }

  const allVisibleSelected =
    products.length > 0 && products.every((p) => selectedIds.includes(p.id));

  return (
    <div className="space-y-6">
      <Panel
        title="ملخص جودة البيانات وفجوات الكاشير (قراءة فقط)"
        sub="أرقام حية من قاعدة البيانات دون أي افتراضات أو تعديل تلقائي"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded border p-3">
            <div className="text-xs opacity-75">المنتجات (النشط / المخفي / المؤرشف)</div>
            <div className="mt-1 text-lg font-bold">
              {audit.catalogOverview.totalProducts} ({audit.catalogOverview.activeProducts} /{" "}
              {audit.catalogOverview.hiddenProducts} / {audit.catalogOverview.archivedProducts})
            </div>
          </div>
          <div className="rounded border p-3">
            <div className="text-xs opacity-75">تغطية الصور</div>
            <div className="mt-1 text-lg font-bold">
              {audit.mediaCoverage.productsWithImages} / {audit.catalogOverview.totalProducts} (
              {audit.mediaCoverage.coveragePercent}%)
            </div>
          </div>
          <div className="rounded border p-3">
            <div className="text-xs opacity-75">أرصدة المخزون غير المعروفة</div>
            <div className="mt-1 text-lg font-bold">
              {audit.inventoryCoverage.realUnknownStock} نشط بدون رصيد ({audit.inventoryCoverage.variantsWithInventoryRow} صف فقط)
            </div>
          </div>
          <div className="rounded border p-3">
            <div className="text-xs opacity-75">شذوذات الوحدات والأسعار والباركود</div>
            <div className="mt-1 text-sm font-semibold">
              أقل من 1 ج.م: {audit.priceHygiene.variantsUnder1Egp} | EAN-13 خطأ:{" "}
              {audit.codeHygiene.badEan13CheckDigits} | WEIGHT بأساس غير كجم:{" "}
              {audit.unitAndWeightConsistency.pieceProductsWithWeightVariantUnit}
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <h3 className="text-sm font-semibold">قرارات مطلوبة من المالك قبل الاستيراد أو الإطلاق</h3>
          <ul className="list-disc space-y-1 ps-5 text-sm">
            {audit.ownerDecisionRequired.map((item) => (
              <li key={item.key}>
                <strong>{item.titleAr}:</strong> {item.observedMetric} — {item.recommendedActionAr}
              </li>
            ))}
          </ul>
          <p className="text-xs opacity-75">
            تباينات عدادات الأقسام (Admin مباشر مقابل المتجر الفرعي النشط):{" "}
            {audit.categoryCountDiscrepancies.length} قسمًا.
          </p>
        </div>
      </Panel>

      <Panel title="اختيار المنتجات المستهدفة" sub={`المحدد حاليًا: ${selectedIds.length} من ${products.length} منتجًا معروضًا`}>
        <form
          className="mb-4 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void reloadProducts();
          }}
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="bulk-search" className="text-sm font-medium">
              بحث بالاسم أو الـ Slug
            </label>
            <input
              id="bulk-search"
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="اكتب اسم المنتج..."
              className="adm-input"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="bulk-state-filter" className="text-sm font-medium">
              الحالة
            </label>
            <select
              id="bulk-state-filter"
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value as typeof stateFilter)}
              className="adm-select"
            >
              <option value="all">الكل</option>
              <option value="active">نشط فقط</option>
              <option value="hidden">مخفي فقط</option>
              <option value="archived">مؤرشف فقط</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="bulk-issue-filter" className="text-sm font-medium">
              فحص جودة محدد
            </label>
            <select
              id="bulk-issue-filter"
              value={issueFilter}
              onChange={(e) => setIssueFilter(e.target.value as typeof issueFilter)}
              className="adm-select"
            >
              <option value="">بدون تصفية شذوذ</option>
              <option value="under_1_egp">أسعار أقل من 1 جنيه ({audit.priceHygiene.variantsUnder1Egp})</option>
              <option value="piece_weight_unit">
                WEIGHT بأساس حجم غير كجم ({audit.unitAndWeightConsistency.pieceProductsWithWeightVariantUnit})
              </option>
              <option value="missing_size_unit">
                متغيرات ناقصة size_unit ({audit.unitAndWeightConsistency.variantsMissingSizeUnit})
              </option>
            </select>
          </div>

          <button type="submit" disabled={loadingList} className="adm-btn adm-btn--secondary">
            {loadingList ? "جارٍ التحديث..." : "تطبيق الفلتر"}
          </button>
        </form>

        <div className="adm-table-scroll">
          <table className="adm-table">
            <caption className="sr-only">جدول المنتجات المتاحة للعمليات الجماعية</caption>
            <thead>
              <tr>
                <th scope="col">
                  <input
                    id="bulk-select-all"
                    type="checkbox"
                    aria-label="تحديد كل المنتجات المعروضة"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                  />
                </th>
                <th scope="col">المنتج</th>
                <th scope="col">القسم</th>
                <th scope="col">الماركة</th>
                <th scope="col">النوع</th>
                <th scope="col">الحالة</th>
                <th scope="col">المتغيرات والأسعار</th>
              </tr>
            </thead>
            <tbody>
              {products.length === 0 ? (
                <tr>
                  <td colSpan={7}>لا توجد منتجات مطابقة للفلتر الحالي.</td>
                </tr>
              ) : (
                products.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <input
                        id={`select-product-${p.id}`}
                        type="checkbox"
                        aria-label={`تحديد ${p.name}`}
                        checked={selectedIds.includes(p.id)}
                        onChange={() => toggleOne(p.id)}
                      />
                    </td>
                    <td>
                      <Link href={`/admin/products/${p.id}`} className="font-medium underline">
                        {p.name}
                      </Link>
                      <div className="text-xs opacity-70">{p.slug}</div>
                    </td>
                    <td>{p.categoryName}</td>
                    <td>{p.brandName ?? "—"}</td>
                    <td>
                      {p.productType} / {p.unit}
                    </td>
                    <td>{p.archived ? "مؤرشف" : p.isActive ? "نشط" : "مخفي"}</td>
                    <td>
                      {p.variants.map((v) => `${v.name}: ${v.price} ج.م`).join(" | ") || "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title="تكوين العملية الجماعية والمعاينة المسبقة"
        sub="تُنفذ العملية داخل معاملة ذرية واحدة وتُرفض بالكامل إذا فشل أي منتج؛ لا يوجد تنفيذ دون معاينة وتأكيد"
      >
        {errorMsg ? <Note tone="danger">{errorMsg}</Note> : null}
        {successMsg ? <Note tone="accent">{successMsg}</Note> : null}

        <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="bulk-action" className="text-sm font-medium">
              نوع العملية
            </label>
            <select
              id="bulk-action"
              value={action}
              onChange={(e) => {
                setAction(e.target.value as BulkProductAction);
                invalidatePreview();
              }}
              className="adm-select"
            >
              {permissions.canUpdateProducts ? (
                <>
                  <option value="ACTIVATE">تفعيل الظهور في المتجر</option>
                  <option value="DEACTIVATE">إخفاء من المتجر</option>
                  <option value="SET_CATEGORY">نقل إلى قسم آخر</option>
                  <option value="SET_BRAND">تعيين / إزالة الماركة</option>
                </>
              ) : null}
              {permissions.canUpdateProducts && permissions.canUpdatePrices ? (
                <option value="ADJUST_PRICE">تعديل أسعار المتغيرات</option>
              ) : null}
              {permissions.canDeleteProducts ? (
                <>
                  <option value="ARCHIVE">أرشفة المنتجات المخفية</option>
                  <option value="RESTORE">استعادة المنتجات المؤرشفة</option>
                </>
              ) : null}
            </select>
          </div>

          {action === "SET_CATEGORY" ? (
            <div className="flex flex-col gap-1">
              <label htmlFor="bulk-category" className="text-sm font-medium">
                القسم الهدف
              </label>
              <select
                id="bulk-category"
                value={categoryId}
                onChange={(e) => {
                  setCategoryId(e.target.value);
                  invalidatePreview();
                }}
                className="adm-select"
              >
                {categories
                  .filter((c) => c.isActive)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>
          ) : null}

          {action === "SET_BRAND" ? (
            <div className="flex flex-col gap-1">
              <label htmlFor="bulk-brand" className="text-sm font-medium">
                الماركة الهدف
              </label>
              <select
                id="bulk-brand"
                value={brandId}
                onChange={(e) => {
                  setBrandId(e.target.value);
                  invalidatePreview();
                }}
                className="adm-select"
              >
                <option value="">إزالة الماركة (null)</option>
                {brands
                  .filter((b) => b.isActive)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
              </select>
            </div>
          ) : null}

          {action === "ADJUST_PRICE" ? (
            <>
              <div className="flex flex-col gap-1">
                <label htmlFor="bulk-price-mode" className="text-sm font-medium">
                  نمط تعديل السعر
                </label>
                <select
                  id="bulk-price-mode"
                  value={priceMode}
                  onChange={(e) => {
                    setPriceMode(e.target.value as BulkPriceMode);
                    invalidatePreview();
                  }}
                  className="adm-select"
                >
                  <option value="PERCENT">نسبة مئوية (%)</option>
                  <option value="FIXED_DELTA">مقدار ثابت بالجنيه (+/-)</option>
                  <option value="EXACT_SET">تثبيت سعر موحد</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="bulk-price-amount" className="text-sm font-medium">
                  القيمة (مثال: 10 أو -5 أو 25.50)
                </label>
                <input
                  id="bulk-price-amount"
                  type="text"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    invalidatePreview();
                  }}
                  className="adm-input"
                />
              </div>
            </>
          ) : null}

          <div className="flex flex-col gap-1 md:col-span-2">
            <label htmlFor="bulk-reason" className="text-sm font-medium">
              سبب العملية (إلزامي لسجل التدقيق)
            </label>
            <input
              id="bulk-reason"
              type="text"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                invalidatePreview();
              }}
              placeholder="مثال: تصحيح قسم منتجات المخبوزات بعد المراجعة"
              className="adm-input"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={busy || selectedIds.length === 0}
            onClick={() => void handlePreview()}
            className="adm-btn adm-btn--secondary"
          >
            {busy ? "جارٍ المعالجة..." : "معاينة التأثير (Dry Run)"}
          </button>
        </div>

        {preview ? (
          <div className="mt-6 space-y-4">
            <Note tone="info">
              المعاينة: إجمالي المختار {preview.summary.requestedCount} | سيتغير{" "}
              {preview.summary.willChangeCount} | دون تغيير {preview.summary.unchangedCount}
            </Note>
            <div className="adm-table-scroll">
              <table className="adm-table">
                <caption className="sr-only">معاينة الفروقات قبل تنفيذ العملية الجماعية</caption>
                <thead>
                  <tr>
                    <th scope="col">المنتج</th>
                    <th scope="col">سيتأثر</th>
                    <th scope="col">قبل</th>
                    <th scope="col">بعد</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.items.map((item) => (
                    <tr key={item.productId}>
                      <td>{item.productName}</td>
                      <td>{item.willChange ? "نعم" : "لا (بدون تغيير)"}</td>
                      <td>
                        {item.variantChanges.length > 0
                          ? item.variantChanges.map((v) => `${v.variantName}: ${v.oldPrice}`).join(" | ")
                          : JSON.stringify(item.before)}
                      </td>
                      <td>
                        {item.variantChanges.length > 0
                          ? item.variantChanges
                              .map((v) => `${v.variantName}: ${v.newPrice}${v.changed ? "" : " (ثابت)"}`)
                              .join(" | ")
                          : JSON.stringify(item.after)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <label htmlFor="bulk-confirm-checkbox" className="flex items-center gap-2 text-sm font-medium">
                <input
                  id="bulk-confirm-checkbox"
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                أؤكد مراجعة الفروقات وأطلب تنفيذ هذه العملية الجماعية داخل سجل التدقيق
              </label>

              <button
                type="button"
                disabled={busy || !confirmed || preview.summary.willChangeCount === 0}
                onClick={() => void handleApply()}
                className="adm-btn adm-btn--primary"
              >
                {busy ? "جارٍ التنفيذ..." : "تنفيذ التعديل الجماعي"}
              </button>
            </div>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
