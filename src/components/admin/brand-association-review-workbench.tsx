"use client";

import { useState } from "react";
import { apiRequest, AppError, mutationTimeoutSignal } from "@/lib/frontend/api-client";
import type {
  BrandAssociationBatchReceipt,
  BrandAssociationBrandOption,
  BrandAssociationClassificationFilter,
  BrandAssociationOperationResult,
  BrandAssociationReviewListResult,
  BrandAssociationReviewRow,
  BrandAssociationSummary,
} from "@/lib/catalog/brand-association-review";
import type { BrandAssociationClassification } from "@/lib/catalog/brand-association";
import { Note, Panel, Pill } from "@/components/admin/ui/surfaces";

const CLASSIFICATION_LABELS: Record<BrandAssociationClassification, string> = {
  EXACT_VERIFIED: "مطابقة تامة",
  REVIEW_REQUIRED: "تحتاج مراجعة",
  AMBIGUOUS_CONFLICT: "تعارض ماركات",
  UNMATCHED: "بدون دليل ماركة",
};

const CLASSIFICATION_TONES: Record<BrandAssociationClassification, "success" | "warn" | "danger" | "neutral"> = {
  EXACT_VERIFIED: "success",
  REVIEW_REQUIRED: "warn",
  AMBIGUOUS_CONFLICT: "danger",
  UNMATCHED: "neutral",
};

const FLAG_LABELS: Record<string, string> = {
  ALIAS_CROSSWALK_NOT_OWNER_APPROVED: "خريطة أسماء غير معتمدة",
  SPELLING_VARIANT_REVIEW: "مراجعة إملاء",
  BRAND_TOKEN_NOT_AT_PRODUCT_START: "الماركة ليست في بداية الاسم",
  SHORT_OR_GENERIC_BRAND_TOKEN: "رمز قصير أو عام",
  MULTIPLE_BRAND_MATCHES: "أكثر من ماركة",
  NO_BRAND_EVIDENCE: "لا دليل ماركة",
};

const CONFIDENCE_LABELS: Record<string, string> = {
  HIGH: "عالية",
  MEDIUM: "متوسطة",
  CONFLICT: "تعارض",
  NONE: "منعدمة",
};

const FILTER_OPTIONS: Array<{ value: BrandAssociationClassificationFilter; label: string; countKey: keyof BrandAssociationSummary | null }> = [
  { value: "ALL", label: "الكل", countKey: "totalProducts" },
  { value: "EXACT_VERIFIED", label: "مطابقة تامة", countKey: "exactVerified" },
  { value: "REVIEW_REQUIRED", label: "تحتاج مراجعة", countKey: "reviewRequired" },
  { value: "AMBIGUOUS_CONFLICT", label: "تعارض ماركات", countKey: "ambiguousConflict" },
  { value: "UNMATCHED", label: "بدون دليل", countKey: "unmatched" },
];

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function flagLabel(flag: string): string {
  if (flag.startsWith("CANDIDATE:")) return `مرشح: ${flag.slice("CANDIDATE:".length)}`;
  return FLAG_LABELS[flag] ?? flag;
}

interface Props {
  initial: BrandAssociationReviewListResult;
  permissions: { canApply: boolean };
}

export function BrandAssociationReviewWorkbench({ initial, permissions }: Props) {
  const [data, setData] = useState<BrandAssociationReviewListResult>(initial);
  const [classification, setClassification] = useState<BrandAssociationClassificationFilter>(initial.filters.classification);
  const [search, setSearch] = useState(initial.filters.search);
  const [brandId, setBrandId] = useState(initial.filters.brandId ?? "");
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<BrandAssociationOperationResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [crosswalkApproved, setCrosswalkApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "danger" | "accent" | "info"; text: string } | null>(null);
  const [receipt, setReceipt] = useState<BrandAssociationBatchReceipt | null>(null);

  const actionableRows = data.rows.filter((row) => row.actionable && row.proposedBrandId);
  const selectedCount = Object.keys(selected).length;
  const allVisibleSelected = actionableRows.length > 0 && actionableRows.every((row) => selected[row.productId]);
  const selectedReviewCount = preview?.summary.crosswalkRequired ?? 0;

  function invalidate() {
    setPreview(null);
    setConfirmed(false);
    setMessage(null);
  }

  function clearSelection() {
    setSelected({});
    invalidate();
  }

  async function load(overrides: {
    classification?: BrandAssociationClassificationFilter;
    search?: string;
    brandId?: string;
    offset?: number;
  } = {}) {
    setBusy(true);
    setMessage(null);
    try {
      const nextClassification = overrides.classification ?? classification;
      const nextSearch = overrides.search ?? search;
      const nextBrandId = overrides.brandId ?? brandId;
      const offset = overrides.offset ?? 0;
      const sp = new URLSearchParams({
        classification: nextClassification,
        offset: String(offset),
        limit: "50",
      });
      if (nextSearch.trim()) sp.set("search", nextSearch.trim());
      if (nextBrandId) sp.set("brandId", nextBrandId);
      const response = await apiRequest<BrandAssociationReviewListResult>(
        `/api/admin/catalog/products/brand-review?${sp.toString()}`,
      );
      setData(response.data);
      setClassification(nextClassification);
      setBrandId(nextBrandId);
      clearSelection();
    } catch (error) {
      setMessage({
        tone: "danger",
        text: error instanceof AppError ? error.message : "تعذر تحميل قائمة مرشحي ربط الماركات.",
      });
    } finally {
      setBusy(false);
    }
  }

  function toggleOne(row: BrandAssociationReviewRow) {
    if (!row.actionable || !row.proposedBrandId) return;
    invalidate();
    setReceipt(null);
    setSelected((current) => {
      if (current[row.productId]) {
        const next = { ...current };
        delete next[row.productId];
        return next;
      }
      return { ...current, [row.productId]: row.proposedBrandId as string };
    });
  }

  function toggleAllVisible() {
    invalidate();
    setReceipt(null);
    setSelected((current) => {
      if (allVisibleSelected) return {};
      const next = { ...current };
      for (const row of actionableRows) {
        if (row.proposedBrandId) next[row.productId] = row.proposedBrandId;
      }
      return next;
    });
  }

  function payload(dryRun: boolean) {
    return {
      items: Object.entries(selected).map(([productId, brandIdValue]) => ({ productId, brandId: brandIdValue })),
      reason: reason.trim(),
      dryRun,
      crosswalkApproved,
      ...(dryRun ? {} : { confirmed, previewReceipt: preview?.previewReceipt }),
    };
  }

  async function run(dryRun: boolean) {
    if (selectedCount === 0) return;
    setBusy(true);
    setMessage(null);
    setReceipt(null);
    if (dryRun) setConfirmed(false);
    try {
      const response = await apiRequest<BrandAssociationOperationResult>(
        "/api/admin/catalog/products/brand-review",
        {
          method: "POST",
          body: payload(dryRun),
          signal: mutationTimeoutSignal(),
        },
      );
      if (dryRun) {
        setPreview(response.data);
        setConfirmed(false);
        setCrosswalkApproved(false);
      } else {
        setPreview(null);
        setConfirmed(false);
        setCrosswalkApproved(false);
        setSelected({});
        setReceipt(response.data.batchReceipt);
        const successText = `تم تطبيق الربط على ${response.data.summary.updated} منتجًا داخل معاملة واحدة، مع سجل تدقيق وإيصال دفعة.`;
        const keepOffset = data.filters.offset;
        const keepClassification = classification;
        const keepSearch = search;
        const keepBrandId = brandId;
        await load({ classification: keepClassification, search: keepSearch, brandId: keepBrandId, offset: keepOffset });
        setMessage({ tone: "accent", text: successText });
      }
    } catch (error) {
      const details = error instanceof AppError ? error.details : null;
      const rows = details && Array.isArray(details.rows) ? details.rows.join(" / ") : null;
      setMessage({
        tone: "danger",
        text: `${error instanceof AppError ? error.message : "تعذرت معالجة ربط الماركات."}${rows ? ` — ${rows}` : ""}`,
      });
    } finally {
      setBusy(false);
    }
  }

  const summary = data.summary;

  return (
    <div className="space-y-6">
      <Panel
        title="ملخص المرشحين (قراءة فقط حتى التأكيد)"
        sub="الاقتراح يُعاد حسابه من اسم المنتج الحالي وقائمة المالك في كل معاينة؛ لا يُعتمد على ثقة محفوظة وحدها."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded border p-3">
            <div className="text-xs opacity-75">إجمالي المنتجات الحية</div>
            <div className="mt-1 text-lg font-bold">{summary.totalProducts.toLocaleString("ar-EG")}</div>
          </div>
          <div className="rounded border p-3">
            <div className="text-xs opacity-75">قابل للتنفيذ (مطابقة + مراجعة)</div>
            <div className="mt-1 text-lg font-bold">{summary.actionable.toLocaleString("ar-EG")}</div>
          </div>
          <div className="rounded border p-3">
            <div className="text-xs opacity-75">مرتبط بماركة حاليًا</div>
            <div className="mt-1 text-lg font-bold">{summary.existingAssociations.toLocaleString("ar-EG")}</div>
          </div>
          <div className="rounded border p-3">
            <div className="text-xs opacity-75">تعارض / بدون دليل</div>
            <div className="mt-1 text-lg font-bold">
              {summary.ambiguousConflict.toLocaleString("ar-EG")} / {summary.unmatched.toLocaleString("ar-EG")}
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {FILTER_OPTIONS.map((option) => {
            const count = option.countKey ? summary[option.countKey] : 0;
            return (
              <button
                key={option.value}
                type="button"
                className={`adm-btn ${classification === option.value ? "adm-btn--primary" : "adm-btn--secondary"}`}
                disabled={busy}
                onClick={() => void load({ classification: option.value, offset: 0 })}
              >
                {option.label} ({count.toLocaleString("ar-EG")})
              </button>
            );
          })}
        </div>
        <Note tone="info">
          لا يتم أي ربط تلقائي. كل دفعة تحتاج تحديدًا فرديًا أو متعددًا، ثم معاينة، ثم تأكيدًا صريحًا. الصفوف ذات
          خريطة الأسماء (Aliases) أو اختلاف الإملاء تحتاج أيضًا موافقة صريحة على الخريطة. الماركة الموجودة لا
          تُستبدل، والمنتجات المعارضة والملتبسة غير قابلة للاختيار.
        </Note>
      </Panel>

      <Panel title="البحث والتصفية" sub="ابحث بالاسم أو الكود أو الماركة المقترحة">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void load({ offset: 0 });
          }}
        >
          <label className="flex min-w-[240px] flex-1 flex-col gap-1 text-sm font-medium">
            بحث
            <input
              className="adm-input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="اسم منتج، كود باركود، أو ماركة"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            الماركة المقترحة
            <select className="adm-select" value={brandId} onChange={(event) => void load({ brandId: event.target.value, offset: 0 })}>
              <option value="">كل الماركات</option>
              {data.brands.map((brand: BrandAssociationBrandOption) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name} ({brand.candidateCount})
                </option>
              ))}
            </select>
          </label>
          <button className="adm-btn adm-btn--secondary" type="submit" disabled={busy}>
            تطبيق الفلتر
          </button>
          <button
            className="adm-btn adm-btn--secondary"
            type="button"
            disabled={busy || (search === "" && brandId === "" && classification === "ALL")}
            onClick={() => {
              setSearch("");
              setBrandId("");
              void load({ search: "", brandId: "", classification: "ALL", offset: 0 });
            }}
          >
            مسح الفلاتر
          </button>
        </form>
      </Panel>

      <Panel
        title="المرشحون"
        sub={`${data.totalMatching.toLocaleString("ar-EG")} صف مطابق — الصفحة ${Math.floor(data.filters.offset / data.filters.limit) + 1}`}
      >
        {message ? <Note tone={message.tone}>{message.text}</Note> : null}
        {receipt ? (
          <Note tone="accent">
            <strong>إيصال الدفعة:</strong> {receipt.batchId} — تم التطبيق {formatDate(receipt.appliedAt)} بواسطة{" "}
            {receipt.appliedBy} — المنتجات: {receipt.productCount}، المتغير: {receipt.changedCount}، الماركات:{" "}
            {receipt.brandCount}، اعتماد الخريطة: {receipt.crosswalkApproved ? "نعم" : "لا"}.
            <div className="mt-1 break-all text-xs opacity-75">digest: {receipt.digest}</div>
          </Note>
        ) : null}

        <div className="adm-table-scroll">
          <table className="adm-table">
            <caption className="sr-only">مرشحو ربط المنتجات بالماركات</caption>
            <thead>
              <tr>
                <th scope="col">
                  <input
                    type="checkbox"
                    aria-label="تحديد كل الصفوف القابلة للتنفيذ في الصفحة"
                    checked={allVisibleSelected}
                    disabled={busy || actionableRows.length === 0}
                    onChange={toggleAllVisible}
                  />
                </th>
                <th scope="col">المنتج والكود</th>
                <th scope="col">الماركة الحالية</th>
                <th scope="col">الماركة المقترحة</th>
                <th scope="col">التصنيف</th>
                <th scope="col">الثقة</th>
                <th scope="col">السبب والملاحظات</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 ? (
                <tr>
                  <td colSpan={7}>لا توجد صفوف مطابقة للفلاتر الحالية.</td>
                </tr>
              ) : (
                data.rows.map((row) => {
                  const checked = Boolean(selected[row.productId]);
                  return (
                    <tr key={row.productId}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`اختيار ${row.productName}`}
                          checked={checked}
                          disabled={busy || !row.actionable}
                          onChange={() => toggleOne(row)}
                        />
                      </td>
                      <td>
                        <strong>{row.productName}</strong>
                        <div className="text-xs opacity-75">
                          {row.productCode ?? "لا يوجد كود"}
                          <br />
                          {row.categoryName ?? "بدون قسم"} · {row.productType === "WEIGHT" ? "بالوزن" : "بالقطعة"} ·{" "}
                          {row.unit}
                        </div>
                      </td>
                      <td>
                        {row.currentBrandName ?? "—"}
                        {row.currentBrandId ? <div className="text-xs opacity-75">مرتبط مسبقًا</div> : null}
                      </td>
                      <td>
                        {row.proposedBrandName ?? "—"}
                        {row.matchedKey ? (
                          <div className="text-xs opacity-75">
                            المفتاح: {row.matchedKey} ({row.matchedKeyType})
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <Pill tone={CLASSIFICATION_TONES[row.classification]}>
                          {CLASSIFICATION_LABELS[row.classification]}
                        </Pill>
                      </td>
                      <td>
                        {row.confidence > 0 ? `${Math.round(row.confidence * 100)}% — ${CONFIDENCE_LABELS[row.confidenceLabel] ?? row.confidenceLabel}` : "—"}
                      </td>
                      <td>
                        <div>{row.reason}</div>
                        {row.flags.length > 0 ? (
                          <div className="mt-1 text-xs opacity-75">
                            {row.flags.map((flag) => flagLabel(flag)).join(" · ")}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            className="adm-btn adm-btn--secondary"
            type="button"
            disabled={busy || data.filters.offset === 0}
            onClick={() => void load({ offset: Math.max(0, data.filters.offset - data.filters.limit) })}
          >
            الصفحة السابقة
          </button>
          <button
            className="adm-btn adm-btn--secondary"
            type="button"
            disabled={busy || data.nextOffset === null}
            onClick={() => void load({ offset: data.nextOffset ?? data.filters.offset })}
          >
            الصفحة التالية
          </button>
          <span className="text-sm opacity-75">المحدد: {selectedCount}</span>
        </div>
      </Panel>

      <Panel title="المعاينة والتطبيق" sub="الخطوة 1 معاينة موقعة؛ الخطوة 2 تأكيد صريح داخل معاملة واحدة">
        <div className="grid gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            سبب الربط (إلزامي ويُسجَّل في التدقيق)
            <input
              className="adm-input"
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                invalidate();
              }}
              placeholder="مثال: اعتماد قائمة المالك بعد مراجعة الصفوف"
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <button
              className="adm-btn adm-btn--secondary"
              type="button"
              disabled={busy || selectedCount === 0 || reason.trim().length < 3}
              onClick={() => void run(true)}
            >
              معاينة المحدد ({selectedCount})
            </button>
            <button
              className="adm-btn adm-btn--secondary"
              type="button"
              disabled={busy || selectedCount === 0}
              onClick={clearSelection}
            >
              مسح التحديد
            </button>
            {!permissions.canApply ? (
              <Pill tone="warn">لا تملك صلاحية products.update — العرض فقط</Pill>
            ) : null}
          </div>
        </div>

        {preview ? (
          <div className="mt-5 space-y-3">
            <Note tone={preview.summary.willChange > 0 ? "info" : "warn"}>
              المطلوب: {preview.summary.requested} — سيتغير: {preview.summary.willChange} — دون تغيير:{" "}
              {preview.summary.unchanged} — مطابقة تامة: {preview.summary.exactVerified} — مراجعة:{" "}
              {preview.summary.reviewRequired} — تحتاج اعتماد خريطة: {preview.summary.crosswalkRequired}
            </Note>
            <div className="adm-table-scroll">
              <table className="adm-table">
                <caption className="sr-only">معاينة ربط الماركات</caption>
                <thead>
                  <tr>
                    <th scope="col">المنتج</th>
                    <th scope="col">قبل</th>
                    <th scope="col">بعد</th>
                    <th scope="col">التصنيف</th>
                    <th scope="col">التغيير</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.items.map((item) => (
                    <tr key={item.productId}>
                      <td>
                        {item.productName}
                        <div className="text-xs opacity-75">{item.productCode ?? "لا يوجد كود"}</div>
                      </td>
                      <td>{item.currentBrandName ?? "بدون ماركة"}</td>
                      <td>{item.proposedBrandName}</td>
                      <td>{CLASSIFICATION_LABELS[item.classification]}</td>
                      <td>{item.willChange ? "نعم" : "دون تغيير"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {selectedReviewCount > 0 ? (
              <label className="flex items-start gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={crosswalkApproved}
                  onChange={(event) => setCrosswalkApproved(event.target.checked)}
                />
                <span>
                  أوافق صراحة على خريطة الأسماء المقترحة (Aliases/Spelling) لهذه الدفعة: {selectedReviewCount} صف.
                  بدون هذا الاعتماد سيُرفض التطبيق بالكامل.
                </span>
              </label>
            ) : null}
            <label className="flex items-start gap-2 text-sm font-medium">
              <input
                type="checkbox"
                className="mt-1"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              <span>
                راجعت المعاينة وأؤكد تطبيق {preview.summary.willChange} تغييرًا داخل معاملة واحدة مع سجل التدقيق
                والإيصال. لن يتم استبدال أي ماركة موجودة.
              </span>
            </label>
            <button
              className="adm-btn adm-btn--primary"
              type="button"
              disabled={
                busy ||
                !permissions.canApply ||
                !confirmed ||
                preview.summary.willChange === 0 ||
                (selectedReviewCount > 0 && !crosswalkApproved)
              }
              onClick={() => void run(false)}
            >
              تطبيق الربط المؤكد
            </button>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
