"use client";

import { useRef, useState } from "react";
import { apiRequest } from "@/lib/frontend/api-client";
import { adminErrorMessage } from "@/lib/admin/errors";
import type { DeletionEligibility, LifecycleResult } from "@/lib/catalog/lifecycle";
import { useAdminMutation, AdminMutationNote } from "@/components/admin/admin-mutate";
import { AdminButton, AdminField, AdminTextarea, AdminRetryButton, ConfirmButton } from "@/components/admin/ui/controls";

export function ProductLifecycleControls({ productId, productName, archived, expectedUpdatedAt, canArchive, canRestore, canDelete = false }: {
  productId: string; productName: string; archived: boolean; expectedUpdatedAt: string; canArchive: boolean; canRestore: boolean; canDelete?: boolean;
}) {
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string>();
  const [applied, setApplied] = useState(false);
  const mutation = useAdminMutation();
  const operation = archived ? "restore" : "archive";
  const allowed = archived ? canRestore : canArchive;

  async function apply() {
    const text = reason.trim();
    if (!text || text.length > 500) { setReasonError("اكتب سبب العملية من ١ إلى ٥٠٠ حرف."); return; }
    setReasonError(undefined);
    const result = await mutation.mutate<LifecycleResult>(`/api/admin/catalog/products/${productId}/${operation}`, {
      method: "POST", body: { confirmed: true, reason: text, expectedUpdatedAt },
    }, (data) => data.alreadyApplied ? "الحالة دي مطبّقة بالفعل، ومفيش تغيير جديد." : archived ? "تمت الاستعادة. المنتج ما زال مخفيًا من المتجر." : "تمت أرشفة المنتج وإخفاؤه من المتجر.");
    if (result) setApplied(true);
  }

  return <div className="adm-form">
    <p className="adm-hint">الأرشفة تخفي المنتج فقط، من غير تغيير أشكال البيع أو المخزون أو الأسعار أو الطلبات. الاستعادة لا تنشره تلقائيًا: يفضل مخفيًا لحد ما تختار عرضه في تعديل المنتج.</p>
    {allowed ? <>
      <AdminField label={archived ? "سبب الاستعادة" : "سبب الأرشفة"} required error={reasonError}>
        {({ inputId, describedBy }) => <AdminTextarea inputId={inputId} describedBy={describedBy} invalid={!!reasonError} value={reason} maxLength={500} disabled={mutation.pending || applied} onChange={(event) => setReason(event.target.value)} />}
      </AdminField>
      <div className="adm-btn-row">
        <ConfirmButton label={archived ? "استعادة المنتج كمخفي" : "أرشفة المنتج"} confirmLabel={archived ? "تأكيد الاستعادة كمخفي" : "تأكيد الأرشفة"}
          question={archived ? `استعادة «${productName}»؟ هيفضل مخفيًا، ولن يتنشر في المتجر تلقائيًا.` : `أرشفة «${productName}» وإخفاؤه من المتجر؟ المخزون والأسعار والطلبات مش هتتغيّر.`}
          variant={archived ? "secondary" : "danger"} disabled={mutation.pending || applied} onConfirm={() => void apply()} />
        <AdminRetryButton />
      </div>
    </> : <p className="adm-hint">{archived ? "استعادة المنتج محتاجة صلاحية تعديل المنتجات." : "أرشفة المنتج محتاجة صلاحية حذف المنتجات."}</p>}
    <AdminMutationNote note={mutation.note} />
    {archived && (canArchive || canDelete) ? <DeletionEligibilityInspector productId={productId} productName={productName} expectedUpdatedAt={expectedUpdatedAt} canDelete={canDelete} /> : null}
  </div>;
}

/**
 * ADM-OWNER G2 — the final delete (UNREFERENCED ONLY).
 *
 * The inspector shows the reference map the server uses (the same map the
 * delete enforces) and, when nothing protected is linked, the delete control
 * itself. The server re-checks everything inside its own transaction, so this
 * screen can never delete a product that has history.
 */
function DeletionEligibilityInspector({ productId, productName, expectedUpdatedAt, canDelete }: {
  productId: string; productName: string; expectedUpdatedAt: string; canDelete: boolean;
}) {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<DeletionEligibility | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteReasonError, setDeleteReasonError] = useState<string | undefined>();
  const deleteMutation = useAdminMutation();

  async function inspect() {
    if (busy.current) return;
    busy.current = true; setPending(true); setResult(null); setError(null);
    try { setResult((await apiRequest<DeletionEligibility>(`/api/admin/catalog/products/${productId}/deletion-eligibility`)).data); }
    catch (error) { setError(adminErrorMessage(error, "تعذّر فحص الموانع. النتيجة غير متاحة، مش خالية.")); }
    finally { busy.current = false; setPending(false); }
  }

  async function runDelete() {
    const text = deleteReason.trim();
    if (!text || text.length > 500) { setDeleteReasonError("اكتب سبب الحذف النهائي من ١ إلى ٥٠٠ حرف."); return; }
    setDeleteReasonError(undefined);
    await deleteMutation.mutate<{ deleted: boolean }>(
      `/api/admin/catalog/products/${productId}`,
      { method: "DELETE", body: { confirmed: true, reason: text, expectedUpdatedAt } },
      () => `تم حذف «${productName}» نهائيًا. مش هيتسترجع.`,
    );
  }

  return <section aria-label="فحص موانع الحذف النهائي" className="adm-form">
    <div className="adm-note" role="note"><div>
      الحذف النهائي مسموح بس للمنتج اللي مالوش أي مرجع محمي (طلبات، حركات مخزون، عروض، تاريخ أسعار، سجل تدقيق محمي).
      لو فيه مرجع، الأرشفة هي المسار الآمن. الفحص للقراءة فقط، والقرار النهائي بيتم في الخادم جوّه عملية واحدة.
    </div></div>
    <AdminButton variant="secondary" loading={pending} onClick={() => void inspect()}>فحص موانع الحذف</AdminButton>
    {error ? <div role="alert" className="adm-error">{error}</div> : null}
    {result ? <div role="status">
      {result.verification === "FAILED" ? (
        <p>
          تعذّر التأكد: فحص المراجع ما اكتملش، ولذلك الحذف النهائي متوقف احتياطًا. جرّب تاني بعد ما
          الخدمة ترجع.
        </p>
      ) : result.executable ? (
        <p>مفيش أي مرجع محمي — الحذف النهائي مسموح.</p>
      ) : (
        <p>فيه مراجع تمنع الحذف النهائي:</p>
      )}
      {result.verification === "VERIFIED" ? (
        <>
          <ul>{result.references.filter((reference) => reference.count > 0).map((reference) => (
            <li key={reference.key}>{reference.label}: {reference.count} — {reference.reason}</li>
          ))}</ul>
          <p>بيانات تابعة وليست موانع تاريخية: {result.metadata.variants} شكل بيع، {result.metadata.images} صورة، {result.metadata.codes} كود.</p>
          <p>سجل تغييرات المنتج: {result.references.find((reference) => reference.key === "auditHistory")?.count ?? 0} (محفوظ، ومابقاش له أي تأثير على القرار).</p>
        </>
      ) : null}
    </div> : null}
    {result?.verification === "VERIFIED" && result.executable && canDelete ? <div className="adm-form">
      <AdminField label="سبب الحذف النهائي" required error={deleteReasonError} hint="السبب بيتسجّل في سجل التدقيق. البيانات اللي هتتشال مش هترجع.">
        {({ inputId, describedBy }) => <AdminTextarea inputId={inputId} describedBy={describedBy} invalid={!!deleteReasonError} value={deleteReason} maxLength={500} disabled={deleteMutation.pending} onChange={(event) => setDeleteReason(event.target.value)} />}
      </AdminField>
      <div className="adm-btn-row">
        <ConfirmButton
          label="احذف المنتج نهائيًا"
          confirmLabel="تأكيد الحذف النهائي"
          question={`حذف «${productName}» نهائيًا؟ المنتج وأشكال بيعه هيتشالوا من الكتالوج، ومش هينفع استرجاعهم.`}
          variant="danger"
          disabled={deleteMutation.pending}
          onConfirm={() => void runDelete()}
        />
        <AdminRetryButton />
      </div>
      <AdminMutationNote note={deleteMutation.note} />
    </div> : null}
    {result && result.verification === "VERIFIED" && !result.executable ? <p className="adm-hint">الحذف النهائي مرفوض لهذا المنتج. استخدم الأرشفة — وهي متاحة دائمًا.</p> : null}
    {result?.verification === "VERIFIED" && result.executable && !canDelete ? <p className="adm-hint">الحذف النهائي محتاج صلاحية حذف المنتجات.</p> : null}
  </section>;
}
