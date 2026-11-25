"use client";

import { useState } from "react";
import { apiRequest, AppError, mutationTimeoutSignal } from "@/lib/frontend/api-client";
import type {
  MetadataReviewIssueFilter,
  MetadataReviewListResult,
  MetadataReviewOperationResult,
  MetadataReviewRow,
} from "@/lib/catalog/metadata-review";
import type { PackageSizeUnit } from "@/lib/catalog/metadata-validation";
import { Note, Panel } from "@/components/admin/ui/surfaces";

const ISSUE_LABELS: Record<string, string> = {
  MISSING_SIZE_UNIT: "وحدة حجم العبوة مفقودة",
  MISSING_SIZE_VALUE: "قيمة حجم العبوة مفقودة",
  PARTIAL_SIZE_PAIR: "قيمة ووحدة العبوة غير مكتملتين",
  INVALID_SIZE_VALUE: "قيمة حجم العبوة غير صالحة",
  UNSUPPORTED_SIZE_UNIT: "وحدة العبوة غير مدعومة",
  WEIGHT_PRICE_BASIS_CONFLICT: "تعارض مع أساس تسعير المنتج الموزون",
  DUPLICATE_VARIANT: "شكل بيع مكرر بعد توحيد الاسم",
  PACKAGED_PIECE: "عبوة مغلقة تباع بالقطعة ولها وزن/حجم وصفي",
};

const UNIT_LABELS: Record<PackageSizeUnit, string> = {
  PIECE: "قطعة", KG: "كيلوجرام", GRAM: "جرام", LITER: "لتر", ML: "ملليلتر",
};

type Edit = { sizeValue: string; sizeUnit: PackageSizeUnit | "" };

export function MetadataReviewWorkbench({ initial }: { initial: MetadataReviewListResult }) {
  const [rows, setRows] = useState<MetadataReviewRow[]>(initial.rows);
  const [nextCursor, setNextCursor] = useState(initial.nextCursor);
  const [issue, setIssue] = useState<MetadataReviewIssueFilter>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [edits, setEdits] = useState<Record<string, Edit>>(() => Object.fromEntries(initial.rows.map((row) => [row.variantId, {
    sizeValue: row.sizeValue ?? "",
    sizeUnit: (row.sizeUnit as PackageSizeUnit | null) ?? "",
  }])));
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<MetadataReviewOperationResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "danger" | "accent"; text: string } | null>(null);

  function invalidate() {
    setPreview(null);
    setConfirmed(false);
    setMessage(null);
  }

  function mergeEdits(nextRows: MetadataReviewRow[], reset: boolean) {
    setEdits((current) => {
      const base = reset ? {} : current;
      return Object.fromEntries([
        ...Object.entries(base),
        ...nextRows.map((row) => [row.variantId, {
          sizeValue: row.sizeValue ?? "",
          sizeUnit: (row.sizeUnit as PackageSizeUnit | null) ?? "",
        } satisfies Edit]),
      ]);
    });
  }

  async function load(reset: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      const sp = new URLSearchParams({ issue, limit: "50" });
      if (search.trim()) sp.set("search", search.trim());
      if (!reset && nextCursor) sp.set("cursor", nextCursor);
      const response = await apiRequest<MetadataReviewListResult>(`/api/admin/catalog/metadata-review?${sp}`);
      setRows((current) => reset ? response.data.rows : [...current, ...response.data.rows]);
      setNextCursor(response.data.nextCursor);
      mergeEdits(response.data.rows, reset);
      if (reset) setSelected([]);
      invalidate();
    } catch (error) {
      setMessage({ tone: "danger", text: error instanceof AppError ? error.message : "تعذر تحميل قائمة مراجعة بيانات العبوات." });
    } finally {
      setBusy(false);
    }
  }

  function correctionPayload() {
    return selected.map((variantId) => ({
      variantId,
      sizeValue: edits[variantId]?.sizeValue.trim() ?? "",
      sizeUnit: edits[variantId]?.sizeUnit ?? "",
    }));
  }

  async function run(dryRun: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await apiRequest<MetadataReviewOperationResult>("/api/admin/catalog/metadata-review", {
        method: "POST",
        body: {
          corrections: correctionPayload(),
          reason: reason.trim(),
          dryRun,
          ...(dryRun ? {} : { confirmed, previewReceipt: preview?.previewReceipt }),
        },
        signal: mutationTimeoutSignal(),
      });
      if (dryRun) {
        setPreview(response.data);
        setConfirmed(false);
      } else {
        const successMessage = `تم تحديث ${response.data.summary.updated} شكل بيع، ورفض ${response.data.summary.rejected} صف بأسباب ظاهرة.`;
        setPreview(null);
        setConfirmed(false);
        setSelected([]);
        await load(true);
        setMessage({ tone: "accent", text: successMessage });
      }
    } catch (error) {
      setMessage({ tone: "danger", text: error instanceof AppError ? error.message : "تعذرت معالجة تصحيحات بيانات العبوات." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title="مراجعة بيانات حجم العبوة"
      sub="طريقة البيع منفصلة عن حجم العبوة: عبوة 500 جرام المغلقة تظل «بالقطعة»، ولا تتحول إلى منتج موزون تلقائيًا. لا يوجد استنتاج من الاسم وحده."
    >
      {message ? <Note tone={message.tone}>{message.text}</Note> : null}
      <form className="mb-4 flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); void load(true); }}>
        <label className="flex flex-col gap-1 text-sm font-medium">
          نوع المراجعة
          <select className="adm-select" value={issue} onChange={(event) => setIssue(event.target.value as MetadataReviewIssueFilter)}>
            <option value="all">كل الأخطاء القابلة للمراجعة</option>
            <option value="missing_unit">وحدة العبوة مفقودة</option>
            <option value="missing_value">قيمة العبوة مفقودة</option>
            <option value="partial_pair">قيمة أو وحدة فقط</option>
            <option value="weight_conflict">تعارض منتج موزون</option>
            <option value="packaged_piece">عبوات مغلقة تباع بالقطعة</option>
            <option value="duplicate_variant">أشكال بيع مكررة</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          بحث بالمنتج أو شكل البيع أو الكود
          <input className="adm-input" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <button className="adm-btn adm-btn--secondary" disabled={busy} type="submit">تطبيق الفلتر</button>
      </form>

      <div className="adm-table-scroll">
        <table className="adm-table">
          <caption className="sr-only">المنتجات وأشكال البيع التي تحتاج مراجعة بيانات العبوة</caption>
          <thead><tr><th scope="col">اختيار</th><th scope="col">المنتج والكود</th><th scope="col">طريقة البيع</th><th scope="col">شكل البيع الحالي</th><th scope="col">المشكلة</th><th scope="col">التصحيح المقترح</th></tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={6}>لا توجد صفوف مطابقة.</td></tr> : rows.map((row) => {
              const edit = edits[row.variantId] ?? { sizeValue: "", sizeUnit: "" };
              return <tr key={row.variantId}>
                <td><input type="checkbox" aria-label={`اختيار ${row.productName} — ${row.variantName}`} checked={selected.includes(row.variantId)} onChange={() => { invalidate(); setSelected((current) => current.includes(row.variantId) ? current.filter((id) => id !== row.variantId) : [...current, row.variantId]); }} /></td>
                <td><strong>{row.productName}</strong><div className="text-xs opacity-75">{row.productCode ?? "لا يوجد كود"}<br />{row.productId}</div></td>
                <td>{row.productType === "PIECE" ? "بالقطعة" : "بالوزن"}<div className="text-xs opacity-75">وحدة البيع: {row.sellingUnit === "PIECE" ? "قطعة" : row.sellingUnit === "KG" ? "كيلوجرام" : "جرام"}</div></td>
                <td>{row.variantName}<div className="text-xs opacity-75">{row.sizeValue ?? "بدون قيمة"} / {row.sizeUnit ? UNIT_LABELS[row.sizeUnit as PackageSizeUnit] ?? row.sizeUnit : "بدون وحدة"}</div></td>
                <td>{row.issues.map((code) => <div key={code}>{ISSUE_LABELS[code] ?? "يحتاج مراجعة"}</div>)}</td>
                <td>
                  <div className="flex min-w-[230px] gap-2">
                    <input className="adm-input w-24" aria-label={`قيمة عبوة ${row.productName}`} placeholder="القيمة" value={edit.sizeValue} onChange={(event) => { invalidate(); setEdits((current) => ({ ...current, [row.variantId]: { ...edit, sizeValue: event.target.value } })); }} />
                    <select className="adm-select" aria-label={`وحدة عبوة ${row.productName}`} value={edit.sizeUnit} onChange={(event) => { invalidate(); setEdits((current) => ({ ...current, [row.variantId]: { ...edit, sizeUnit: event.target.value as PackageSizeUnit | "" } })); }}>
                      <option value="">اختر الوحدة</option>
                      {(Object.entries(UNIT_LABELS) as Array<[PackageSizeUnit, string]>).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </div>
                </td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
      {nextCursor ? <button className="adm-btn adm-btn--secondary mt-3" type="button" disabled={busy} onClick={() => void load(false)}>تحميل المزيد</button> : null}

      <div className="mt-5 grid gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium">سبب التصحيح لسجل التدقيق<input className="adm-input" value={reason} onChange={(event) => { setReason(event.target.value); invalidate(); }} /></label>
        <div><button className="adm-btn adm-btn--secondary" type="button" disabled={busy || selected.length === 0} onClick={() => void run(true)}>معاينة التصحيحات دون تنفيذ</button></div>
      </div>

      {preview ? <div className="mt-5 space-y-3">
        <Note tone="info">جاهز: {preview.summary.ready} — دون تغيير: {preview.summary.unchanged} — مرفوض: {preview.summary.rejected}</Note>
        <div className="adm-table-scroll"><table className="adm-table"><caption className="sr-only">معاينة تصحيح بيانات العبوة</caption><thead><tr><th>المنتج / الشكل</th><th>قبل</th><th>بعد</th><th>النتيجة</th></tr></thead><tbody>{preview.items.map((item) => <tr key={item.variantId}><td>{item.productName ?? "غير موجود"}<br />{item.variantName ?? item.variantId}</td><td>{item.before ? `${item.before.sizeValue ?? "—"} / ${item.before.sizeUnit ?? "—"}` : "—"}</td><td>{item.after.sizeValue} / {UNIT_LABELS[item.after.sizeUnit]}</td><td>{item.status === "READY" ? "جاهز" : item.status === "UNCHANGED" ? "دون تغيير" : `مرفوض: ${item.reasons.map((reasonCode) => ISSUE_LABELS[reasonCode] ?? reasonCode).join("، ")}`}</td></tr>)}</tbody></table></div>
        <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />راجعت كل صف وأؤكد تطبيق الصفوف الجاهزة فقط داخل معاملة واحدة مع سجل التدقيق</label>
        <button className="adm-btn adm-btn--primary" type="button" disabled={busy || !confirmed || preview.summary.ready === 0} onClick={() => void run(false)}>تنفيذ التصحيحات المؤكدة</button>
      </div> : null}
    </Panel>
  );
}
