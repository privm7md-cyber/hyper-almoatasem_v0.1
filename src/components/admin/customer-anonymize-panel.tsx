// ADM-OWNER G3 — the anonymization control (client island).
//
// Preserves exact default-mode rendering and adds H2 lifecycle state support
// (`INITIAL`, `PENDING_AUDIT_REDACTION`, `FAILED`, `COMPLETED`) with live
// status refresh (`GET /api/admin/customers/[id]/anonymize`) when H2 is active.
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AppError, apiRequest } from "@/lib/frontend/api-client";
import { adminErrorMessage } from "@/lib/admin/errors";
import { AdminButton, AdminField, AdminTextarea, ConfirmButton } from "@/components/admin/ui/controls";
import type { AnonymizeResult, CustomerAnonymizeStatusResponse } from "@/lib/customers/anonymize";

export type AnonymizeOutcome = AnonymizeResult;

function formatAnonymizeError(err: unknown): string {
  if (
    err instanceof AppError &&
    err.code === "BUSINESS_RULE" &&
    err.details?.reasonCode === "AUDIT_REDACTION_MIGRATION_REQUIRED"
  ) {
    return "تعذّر إخفاء هوية العميل حالياً: توجد قيم تاريخية في سجل التدقيق محمية بقيد عدم التعديل (audit_logs)، ولم يتم تفعيل ترحيل وعامل الخصوصية الآمن (H2) على قاعدة البيانات هذه بعد. لم يتم تعديل بيانات العميل — يلزم تفعيل ترحيل H2 وعامل التنقية المستقل أولاً.";
  }
  if (err instanceof AppError && err.code === "BUSINESS_RULE" && Array.isArray(err.details?.openOrders)) {
    const safeOrders = err.details.openOrders.filter(
      (item): item is string => typeof item === "string" && /^[A-Z0-9-]{1,32}$/.test(item),
    );
    if (safeOrders.length > 0) {
      return `مفيش إخفاء هوية دلوقتي: فيه ${safeOrders.length} طلب لسه مفتوح (${safeOrders.join("، ")}). استنى الطلب يخلص وارجع تاني.`;
    }
  }
  return adminErrorMessage(err, "مش قادرين نخفي هوية العميل دلوقتي. جرّب تاني.");
}

export function CustomerAnonymizePanel({
  customerId,
  customerName,
  expectedUpdatedAt,
  orderCount,
  initialOutcome = null,
}: {
  customerId: string;
  customerName: string;
  expectedUpdatedAt: string;
  orderCount: number | null;
  initialOutcome?: AnonymizeOutcome | null;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<AnonymizeOutcome | null>(initialOutcome);

  async function run() {
    const text = reason.trim();
    if (!text || text.length > 500) {
      setReasonError("اكتب سبب إخفاء الهوية من ١ إلى ٥٠٠ حرف.");
      return;
    }
    if (text.includes("@") || /\d{7,}/.test(text)) {
      setReasonError("سبب إخفاء الهوية ما ينفعش يحتوي على بريد إلكتروني أو رقم تليفون.");
      return;
    }
    setReasonError(undefined);
    setPending(true);
    setError(null);
    try {
      const result = await apiRequest<AnonymizeOutcome>(
        `/api/admin/customers/${customerId}/anonymize`,
        { method: "POST", body: { confirmed: true, reason: text, expectedUpdatedAt } },
      );
      setOutcome(result.data);
      router.refresh();
    } catch (err) {
      setError(formatAnonymizeError(err));
    } finally {
      setPending(false);
    }
  }

  async function refreshStatus() {
    setRefreshing(true);
    setError(null);
    try {
      const statusRes = await apiRequest<CustomerAnonymizeStatusResponse>(
        `/api/admin/customers/${customerId}/anonymize`,
        { method: "GET" },
      );
      if (statusRes.data.result) {
        setOutcome(statusRes.data.result);
      }
      router.refresh();
    } catch (err) {
      setError(formatAnonymizeError(err));
    } finally {
      setRefreshing(false);
    }
  }

  if (outcome) {
    const isFailed = outcome.outcome === "FAILED";
    const isPendingRedaction =
      !isFailed && (outcome.outcome === "PENDING_AUDIT_REDACTION" || outcome.anonymized === false);

    if (isFailed) {
      return (
        <section aria-label="نتيجة إخفاء الهوية" className="adm-form" data-anonymize-state="FAILED">
          <div className="adm-note adm-note--danger" role="alert">
            <div>
              فشلت مهمة تنقية سجل التدقيق التاريخي لهذا العميل (الحالة: <bdi>FAILED</bdi>) — لم تكتمل
              عملية إخفاء الهوية نهائيًا بعد. تم إخفاء بيانات الحساب التشغيلية باسم «{outcome.displayName}»،
              ولكن يلزم تشغيل استرداد عامل الخصوصية الآمن لإتمام تنقية السجلات التاريخية.
            </div>
          </div>
          <ul className="adm-cell-sub">
            {outcome.redactionTaskId ? (
              <li>
                معرّف مهمة التنقية: <bdi>{outcome.redactionTaskId}</bdi>
              </li>
            ) : null}
            <li>عدد محاولات العامل المسجلة: {outcome.attemptCount ?? 1}</li>
            {outcome.lastErrorCode ? (
              <li>
                كود الخطأ التشغيلي: <bdi>{outcome.lastErrorCode}</bdi>
              </li>
            ) : null}
          </ul>
          <div className="adm-btn-row">
            <AdminButton
              variant="secondary"
              type="button"
              disabled={refreshing}
              onClick={() => void refreshStatus()}
            >
              تحديث حالة التنقية
            </AdminButton>
          </div>
          {error ? (
            <p role="alert" className="adm-error">
              {error}
            </p>
          ) : null}
        </section>
      );
    }

    if (isPendingRedaction) {
      return (
        <section
          aria-label="نتيجة إخفاء الهوية"
          className="adm-form"
          data-anonymize-state="PENDING_AUDIT_REDACTION"
        >
          <div className="adm-note adm-note--warn" role="status">
            <div>
              تم إخفاء الهوية التشغيلية في ملف العميل والطلبات باسم «{outcome.displayName}»، لكن تنقية
              القيم التاريخية في سجل التدقيق لا تزال قيد التنفيذ عبر عامل الخصوصية المستقل (الحالة:{" "}
              <bdi>PENDING_AUDIT_REDACTION</bdi>) ولم تكتمل عملية إخفاء الهوية نهائيًا بعد.
            </div>
          </div>
          <ul className="adm-cell-sub">
            <li>عناوين محفوظة اتشالت: {outcome.removed.addresses}</li>
            <li>جلسات دخول اتلغت: {outcome.removed.sessions}</li>
            <li>مفاتيح حد المحاولات اتشالت: {outcome.removed.rateLimitBuckets}</li>
            <li>سجلات تدقيق العميل التاريخية: قيد التنقية عبر العامل المستقل</li>
            {outcome.redactionTaskId ? (
              <li>
                معرّف مهمة التنقية: <bdi>{outcome.redactionTaskId}</bdi>
              </li>
            ) : null}
            <li>بيانات هوية وعناوين وملاحظات جوه الطلبات اتنقّت: {outcome.removed.orderRows}</li>
          </ul>
          <div className="adm-btn-row">
            <AdminButton
              variant="secondary"
              type="button"
              disabled={refreshing}
              onClick={() => void refreshStatus()}
            >
              تحديث حالة التنقية
            </AdminButton>
          </div>
          {error ? (
            <p role="alert" className="adm-error">
              {error}
            </p>
          ) : null}
        </section>
      );
    }

    return (
      <section aria-label="نتيجة إخفاء الهوية" className="adm-form" data-anonymize-state="COMPLETED">
        <div className="adm-note" role="status">
          <div>
            {outcome.alreadyAnonymized
              ? `العميل مخفي الهوية بالفعل باسم «${outcome.displayName}»`
              : `تم إخفاء هوية العميل (${outcome.mode === "PSEUDONYMIZED" ? "ربط تقني بدون هوية" : outcome.mode}). بقى معروض باسم «${outcome.displayName}»`}
            {orderCount === null
              ? " والطلبات المحفوظة كما هي دون تغيير"
              : ` والطلبات (${orderCount} طلب) زي ما هي`}
            : الأسعار والخصومات والإجماليات ما اتغيرتش.
            {outcome.outcome === "COMPLETED_WITH_LEGAL_REVIEW"
              ? " بعض السجلات المقيدة محتاجة مراجعة قانونية أو تشغيلية منفصلة."
              : ""}
          </div>
        </div>
        <ul className="adm-cell-sub">
          <li>عناوين محفوظة اتشالت: {outcome.removed.addresses}</li>
          <li>جلسات دخول اتلغت: {outcome.removed.sessions}</li>
          <li>مفاتيح حد المحاولات اتشالت: {outcome.removed.rateLimitBuckets}</li>
          <li>سجلات تدقيق للعميل اتنقّت: {outcome.removed.auditRows}</li>
          <li>بيانات هوية وعناوين وملاحظات جوه الطلبات اتنقّت: {outcome.removed.orderRows}</li>
          {outcome.restrictedRetained.length > 0 ? (
            <li>
              بيانات محتفظ بيها ومقيّدة الوصول:{" "}
              {outcome.restrictedRetained
                .map((item) => `${item.label} (${item.accessScope})`)
                .join("، ")}
            </li>
          ) : null}
        </ul>
      </section>
    );
  }

  return (
    <section aria-label="إخفاء هوية العميل" className="adm-form" data-anonymize-state="INITIAL">
      <div className="adm-note adm-note--warn" role="note">
        <div>
          إخفاء الهوية بيشيل الاسم والتليفون والبريد والعناوين والجلسات، وبيستبدلهم بتسمية
          «عميل مجهول». الطلبات والأسعار والخصومات وحركات المخزون بتفضل زي ما هي. البيانات اللي
          بتتشال مش هترجع من التطبيق.
        </div>
      </div>
      <AdminField label="سبب إخفاء الهوية" required error={reasonError} hint="السبب بيتسجّل في سجل التدقيق مع مين عمل العملية.">
        {({ inputId, describedBy }) => (
          <AdminTextarea
            inputId={inputId}
            describedBy={describedBy}
            invalid={!!reasonError}
            value={reason}
            maxLength={500}
            disabled={pending}
            onChange={(event) => setReason(event.target.value)}
          />
        )}
      </AdminField>
      <div className="adm-btn-row">
        <ConfirmButton
          label="اخفي هوية العميل"
          confirmLabel="تأكيد إخفاء الهوية"
          question={`إخفاء هوية «${customerName}»؟ البيانات الشخصية هتتشال ومش هترجع، والطلبات هتفضل كما هي.`}
          variant="danger"
          disabled={pending}
          onConfirm={() => void run()}
        />
        <AdminButton variant="secondary" type="button" disabled={pending} onClick={() => router.refresh()}>
          راجع الملف تاني
        </AdminButton>
      </div>
      {error ? (
        <p role="alert" className="adm-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
