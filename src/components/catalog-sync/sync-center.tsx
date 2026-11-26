"use client";

import { useCallback, useEffect, useState } from "react";
import type { SyncManifest, SyncPreview, SyncApplyReceipt, SyncResult, PreviewRow } from "@/lib/catalog-sync/types";

async function api<T>(url: string, body?: unknown, options?: { ignoreStatus?: boolean }): Promise<{ status: number; json: T }> {
  const res = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T;
  if (!res.ok && !options?.ignoreStatus) return { status: res.status, json: { ok: false } as T };
  return { status: res.status, json: json as T };
}

const statusColor: Record<string, string> = {
  UNCHANGED: "border-[var(--studio-border)] text-[var(--studio-muted-text)]",
  SAFE_TO_APPLY: "border-emerald-400/50 bg-emerald-500/10 text-emerald-400",
  ALREADY_APPLIED: "border-sky-400/50 bg-sky-500/10 text-sky-400",
  CONFLICTED: "border-amber-400/50 bg-amber-500/10 text-amber-400",
  SOURCE_NOT_FOUND: "border-rose-400/50 bg-rose-500/10 text-rose-400",
  TARGET_REFERENCE_MISSING: "border-rose-400/50 bg-rose-500/10 text-rose-400",
  INVALID_OPERATION: "border-rose-400/50 bg-rose-500/10 text-rose-400",
  DEPENDENCY_BLOCKED: "border-amber-400/50 bg-amber-500/10 text-amber-400",
};

export function SyncCenter() {
  const [source, setSource] = useState("DRAFT");
  const [status, setStatus] = useState("جاهز");
  const [error, setError] = useState<string | null>(null);
  const [manifest, setManifest] = useState<SyncManifest | null>(null);
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [receipt, setReceipt] = useState<SyncApplyReceipt | null>(null);
  const [history, setHistory] = useState<Array<Record<string, unknown>>>([]);
  const [showConflictDetail, setShowConflictDetail] = useState(false);
  void setShowConflictDetail;
  void showConflictDetail;

  const refreshHistory = useCallback(async () => {
    const res = await api<{ ok: boolean; history: Array<Record<string, unknown>> }>("/api/catalog-sync/history");
    setHistory(res.json.history ?? []);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshHistory();
  }, [refreshHistory]);

  const doGenerate = async () => {
    setError(null);
    setStatus("جاري توليد المصنف المجمّد من Studio…");
    const { json } = await api<{ ok: boolean; manifest?: SyncManifest; error?: string }>("/api/catalog-sync/manifest", { source });
    if (!json.ok || !json.manifest) { setError(json.error ?? "توليد المشترك فشل"); setStatus("فشل"); return; }
    setManifest(json.manifest);
    setPreview(null); setReceipt(null);
    setStatus(`تم تجميد المصنف (${json.manifest.operations.length} عملية، ${json.manifest.counts.products} منتج/متغير).`);
    void refreshHistory();
  };

  const doPreview = async () => {
    setError(null);
    setStatus("جاري إجراء المقارنة ثلاثية الأطراف…");
    const { json } = await api<{ ok: boolean; preview?: SyncPreview; error?: string }>("/api/catalog-sync/preview", { manifest });
    if (!json.ok || !json.preview) { setError(json.error ?? "فشل المقارنة"); setStatus("فشل"); return; }
    setPreview(json.preview);
    const p = json.preview;
    setStatus(`المقارنة جاهزة: ${p.counts.safeToApply} يطبق مباشرة، ${p.counts.conflicted} تعارضًا، ${p.counts.alreadyApplied} مطبوقة، ${p.counts.unchanged} بدون تغيير.`);
  };

  const doApply = async () => {
    if (!manifest) return;
    setError(null);
    setStatus("جاري التطبيق على البيئة المفصولة (Transaction + Audit)…");
    const { json } = await api<SyncResult>("/api/catalog-sync/apply", { manifest });
    if (!json.ok) { setError(`${json.errorCode ?? ""}: ${json.error ?? ""}`.trim()); setStatus("فشل"); return; }
    setReceipt(json.receipt ?? null);
    setStatus(`${json.status}: ${json.receipt ? `${json.receipt.appliedCount} تطبيق / ${json.receipt.alreadyAppliedCount} مُكررة` : ""}`.trim());
    void refreshHistory();
  };

  const rowVisible = (r: PreviewRow) => r.status !== "UNCHANGED" && r.status !== "ALREADY_APPLIED";
const rowsVisible = preview ? preview.rows.filter(rowVisible) : [];
  void error;
  return (
    <section className="space-y-4" aria-label="مزامنة الكتالوج مع الموقع">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--studio-border)] bg-[var(--studio-card)] p-4">
        <div>
          <h2 className="adm-page-title text-lg">مزامنة الكتالوج مع الموقع</h2>
          <p className="text-xs text-[var(--studio-muted-text)]">من Studio إلى Hyper Al-Moatasem — بوابة تأكيد صريحة، تطبيق ذري على بيئة مفصولة.</p>
        </div>
        <span aria-live="polite" data-testid="sync-status" className="adm-pill">{status}{error ? ` — ${error}` : ""}</span>
      </div>

      <div className="grid grid-cols-1 gap-3 rounded-xl border border-[var(--studio-border)] bg-[var(--studio-card)] p-4 lg:grid-cols-3">
        <label className="text-sm">مصدر Studio
          <select data-testid="sync-source" value={source} onChange={(e) => setSource(e.target.value)} className="mt-1 w-full rounded border p-2">
            <option value="DRAFT">المسودة الحالية (DRAFT)</option>
            <option value="V0">V0 — الأساس غير القابل للتعديل</option>
            <option value="RELEASE">اصدار محفوظ</option>
          </select>
        </label>
        <div className="text-sm">مصدر Studio
          <select data-testid="sync-source" value={source} onChange={(e) => setSource(e.target.value)} className="mt-1 w-full rounded border p-2">
            <option value="DRAFT">المسودة الحالية (DRAFT)</option>
            <option value="V0">V0 — الأساس غير القابل للتعديل</option>
            <option value="RELEASE">اصدار محفوظ</option>
          </select>
        </div>
        <button type="button" data-testid="sync-generate" onClick={() => void doGenerate()} className="mt-6 rounded-lg bg-[var(--studio-accent)] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">توليد المصنف المجمّد (Studio)</button>
      </div>

      {manifest && (
        <div data-testid="sync-manifest" className="rounded-xl border border-[var(--studio-border)] bg-[var(--studio-card)] p-4 text-sm">
          <p><b>{manifest.manifestId}</b></p>
          <p className="font-mono text-[10px] break-all" dir="ltr">SHA-256 {manifest.digest}</p>
          <p>العمليات: {manifest.operations.length} — المنتجات: {manifest.counts.products} — المتغيرات: {manifest.counts.variants} — الفئات: {manifest.counts.categories} — العلامات: {manifest.counts.brands} — المراجعة: {String(manifest.studio.revision)}</p>
          <div className="mt-3 flex gap-2">
            <button type="button" data-testid="sync-preview" onClick={() => void doPreview()} className="rounded-lg bg-[var(--studio-accent)] px-4 py-2 text-sm font-bold text-white">مقارنة ثلاثية الأطراف (Read-Only)</button>
          </div>
        </div>
      )}

      {preview && (
        <section className="space-y-3 rounded-xl border border-[var(--studio-border)] bg-[var(--studio-card)] p-4" aria-label="مقارنة المصنف">
          <div className="flex flex-wrap gap-4 text-xs text-[var(--studio-muted-text)]">
            <span>SAFE_TO_APPLY: {preview.counts.safeToApply}</span>
            <span>UNCHANGED: {preview.counts.unchanged}</span>
            <span>ALREADY_APPLIED: {preview.counts.alreadyApplied}</span>
            <span className="text-amber-400">CONFLICTED: {preview.counts.conflicted}</span>
            <span className="text-rose-400">SOURCE_NOT_FOUND: {preview.counts.sourceNotFound}</span>
            <span className="text-rose-400">TARGET_REFERENCE_MISSING: {preview.counts.targetReferenceMissing}</span>
            <span className="text-rose-400">INVALID: {preview.counts.invalid}</span>
          </div>
          <p className="text-xs text-[var(--studio-muted-text)]">أثر: {preview.affectedProducts} منتجًا، {preview.affectedVariants} متغيرًا، {preview.affectedCategories} فئة، {preview.affectedBrands} علامة — أسعار: {preview.priceChanges}، حالات: {preview.lifecycleChanges}.</p>
          <div className="max-h-80 overflow-auto">
            <table className="adm-table min-w-[46rem]">
              <thead><tr><th>الكيان</th><th>الحقل</th><th>الحالي (الويب)</th><th>المقترح (Studio)</th><th>الأصل</th><th>الحالة</th></tr></thead>
              <tbody data-testid="sync-preview-rows">
                {rowsVisible.map((r, i) => (
                  <tr key={i} data-testid="sync-row" className={statusColor[r.status] ?? ""}>
                    <td dir="ltr" className="font-mono text-[10px]">{r.op.entityId}{r.productId ? ` (${r.productId})` : ""}</td>
                    <td dir="ltr" className="font-mono text-[10px]">{r.op.field ?? "-"}</td>
                    <td dir="ltr" className="font-mono text-[10px]">{String(r.current ?? "-")}</td>
                    <td dir="ltr" className="font-mono text-[10px]">{String(r.proposed ?? "-")}</td>
                    <td dir="ltr" className="font-mono text-[10px]">{String(r.base ?? "-")}</td>
                    <td className="font-mono text-[10px]">{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rowsVisible.length === 0 && <p className="text-sm text-[var(--studio-muted-text)]">جميع العمليات بدون تغيير (UNCHANGED).</p>}
          <div className="mt-3 flex gap-2">
            <button type="button" data-testid="sync-apply" disabled={preview.counts.safeToApply === 0 || preview.counts.conflicted > 0 || preview.counts.invalid > 0 || preview.counts.sourceNotFound > 0 || preview.counts.targetReferenceMissing > 0 || preview.counts.dependencyBlocked > 0} onClick={() => void doApply()} className="rounded-lg bg-[var(--studio-ok)] px-4 py-2 text-sm font-bold text-white disabled:opacity-40">تأكيد وتطبيق — بيئة مفصولة</button>
            <button type="button" onClick={() => setPreview(null)} className="rounded-lg border border-[var(--studio-border)] px-4 py-2 text-sm">إلغاء المقارنة</button>
          </div>
          <p className="text-xs text-[var(--studio-muted-text)]">التطبيق على الموقع الفعلي يتطلب تصريحًا منفصلًا.</p>
        </section>
      )}

      {receipt && (
        <section data-testid="sync-receipt" className="rounded-xl border border-[var(--studio-border)] bg-[var(--studio-card)] p-4 text-sm">
          <p><b>{receipt.status}</b> — syncJobId <code>{receipt.syncJobId}</code></p>
          <p>مجمد: {receipt.manifestId} — تطبيقات: {receipt.appliedCount} — مكررة: {receipt.alreadyAppliedCount} — أحداث تدقيق: {receipt.auditEventCount} — بيئة: {receipt.target.database}@{receipt.target.systemIdentifier}</p>
        </section>
      )}

      <section className="rounded-xl border border-[var(--studio-border)] bg-[var(--studio-card)] p-4" aria-label="سجل المزامنات">
        <div className="flex items-center justify-between"><h3 className="adm-page-title text-base">سجل التطبيقات (Disposable)</h3><button type="button" onClick={() => void refreshHistory()} className="rounded px-3 py-1 text-xs">تحديث</button></div>
        <div className="mt-2 overflow-x-auto"><table className="adm-table min-w-[46rem]"><thead><tr><th>job</th><th>المصنف</th><th>الممثل</th><th>المستهدف</th><th>الحالة</th><th>الإحصاء</th><th>الوقت</th></tr></thead>
          <tbody data-testid="sync-history">
            {history.map((h) => (
              <tr key={String(h.syncJobId)}><td dir="ltr" className="font-mono text-[10px]">{String(h.syncJobId).slice(0, 16)}…</td><td dir="ltr" className="font-mono text-[10px]">{String(h.manifestId ?? "").slice(0, 30)}…</td><td>{String(h.actorPermission ?? "")}</td><td>{String(h.targetDatabase ?? "")}</td><td>{String(h.status ?? "")}</td><td dir="ltr" className="font-mono text-[10px]">A:{String(h.appliedCount ?? 0)} R:{String(h.alreadyAppliedCount ?? 0)}</td><td>{String(h.createdAt ?? "")}</td></tr>
            ))}
            {history.length === 0 ? <tr><td colSpan={7} className="text-sm text-[var(--studio-muted-text)]">لا توجد تطبيقات بعد.</td></tr> : null}
          </tbody></table></div>
      </section>

      <section className="rounded-xl border border-[var(--studio-border)] bg-[var(--studio-card)] p-4" aria-label="ملخص الحالة">
        <div className="flex flex-wrap gap-4 text-sm">
          <span>بيئة التطبيق: {preview?.target.environment ?? "N/A"}</span>
          <span>الأعمال المعلقة (SAFE_TO_APPLY): {preview ? preview.counts.safeToApply : 0}</span>
        </div>
      </section>
    </section>
  );
}
