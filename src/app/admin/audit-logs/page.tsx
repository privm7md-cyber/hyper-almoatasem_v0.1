// ADMIN AUDIT TRAIL — who changed what, and when (server).
//
// The trail is the store's own memory: every row is a change that was
// committed, with the person who made it, the part of the store it touched
// and the moment it happened. Nothing here can be edited or deleted.
//
// The filters are the real ones the store writes — the action and the part of
// the store — each one labelled in Arabic, plus a date range. All of it runs
// on the server, and the pages walk the trail with a keyset cursor minted
// from the last row on the page, so nothing is skipped and nothing repeats.

import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { listAudit } from "@/lib/admin/queries";
import { cairoDayBounds, readCalendarDay } from "@/lib/admin/date-range";
import { actorTypeLabel, formatDateTime } from "@/lib/admin/terminology";
import { DataTable, ErrorState, Note, PageHead, Panel, Pager, Pill } from "@/components/admin/ui/surfaces";
import { auditActionOutcome } from "@/lib/admin/audit-vocabulary";
import {
  AUDIT_ENTITY_FILTER_OPTIONS,
  REAL_AUDIT_ACTIONS,
  auditActionText,
  auditEntityText,
  auditResultText,
} from "./audit-labels";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "سجل التغييرات — الإدارة",
  robots: { index: false, follow: false },
};

const LIMIT = 20;

type RawParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  await requirePermission("audit_logs.view");
  const sp = await searchParams;

  const action = (one(sp.action) ?? "").trim();
  const entityType = (one(sp.entityType) ?? "").trim();
  const since = readCalendarDay(one(sp.since)) ?? "";
  const until = readCalendarDay(one(sp.until)) ?? "";
  const cursor = (one(sp.cursor) ?? "").trim();
  // ADM-11: the outcome and the sensitive filters are applied in SQL.
  const outcomeRaw = (one(sp.outcome) ?? "").trim();
  const outcome = outcomeRaw === "FAILURE" ? "FAILURE" : outcomeRaw === "SUCCESS" ? "SUCCESS" : null;
  const sensitiveOnly = (one(sp.sensitive) ?? "") === "true";

  const filters: {
    action: string | null;
    entityType: string | null;
    since: string | null;
    until: string | null;
    outcome: "SUCCESS" | "FAILURE" | null;
    sensitiveOnly: boolean;
  } = {
    action: REAL_AUDIT_ACTIONS.includes(action) ? action : null,
    entityType: AUDIT_ENTITY_FILTER_OPTIONS.some((option) => option.value === entityType) ? entityType : null,
    since: since ? cairoDayBounds(since).start.toISOString() : null,
    until: until ? cairoDayBounds(until).endExclusive.toISOString() : null,
    outcome,
    sensitiveOnly,
  };

  let rows: Awaited<ReturnType<typeof listAudit>> | null = null;
  let hasMore = false;
  try {
    const found = await listAudit({
      limit: LIMIT,
      cursor: cursor === "" ? null : cursor,
      userId: null,
      action: filters.action,
      entityType: filters.entityType,
      entityId: null,
      since: filters.since,
      until: null,
      untilExclusive: filters.until,
      outcome: filters.outcome,
      sensitiveOnly: filters.sensitiveOnly,
    });
    hasMore = found.length > LIMIT;
    rows = hasMore ? found.slice(0, LIMIT) : found;
  } catch {
    rows = null;
  }

  const actorIds = rows ? Array.from(new Set(rows.map((row) => row.user_id).filter((id): id is string => !!id))) : [];
  const actors = actorIds.length
    ? await Promise.resolve(prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })).catch(
        () => [],
      )
    : [];
  const actorNames = new Map(actors.map((actor) => [actor.id, actor.name]));

  const lastRow = rows && rows.length ? rows[rows.length - 1] : null;
  const nextCursor = hasMore && lastRow ? lastRow.id : null;
  const filtered = Boolean(
    filters.action || filters.entityType || filters.since || filters.until || filters.outcome || filters.sensitiveOnly,
  );

  return (
    <>
      <PageHead
        eyebrow="الإدارة"
        title="سجل التغييرات"
        intro="سجل التغييرات بيقول مين عمل إيه وإمتى. كل سطر معناه إن التغيير اتسجل في المتجر بعد ما اتحفظ فعلًا. السطور الوحيدة اللي مش تغييرات هي محاولات الدخول."
      />

      <form key={JSON.stringify(filters)} method="get" action="/admin/audit-logs" className="adm-filters" aria-label="تصفية سجل التغييرات">
        <div className="adm-filters-grid">
          <div className="adm-field">
            <label className="adm-label" htmlFor="audit-action">
              نوع التغيير
            </label>
            <select id="audit-action" name="action" className="adm-select" defaultValue={filters.action ?? ""}>
              <option value="">كل التغييرات</option>
              {REAL_AUDIT_ACTIONS.map((value) => (
                <option key={value} value={value}>
                  {auditActionText(value)}
                </option>
              ))}
            </select>
          </div>
          <div className="adm-field">
            <label className="adm-label" htmlFor="audit-entity">
              القسم
            </label>
            <select
              id="audit-entity"
              name="entityType"
              className="adm-select"
              defaultValue={filters.entityType ?? ""}
            >
              <option value="">كل الأقسام</option>
              {AUDIT_ENTITY_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="adm-field">
            <label className="adm-label" htmlFor="audit-since">
              من يوم
            </label>
            <input id="audit-since" name="since" type="date" className="adm-input" defaultValue={since} />
          </div>
          <div className="adm-field">
            <label className="adm-label" htmlFor="audit-until">
              لحد يوم
            </label>
            <input id="audit-until" name="until" type="date" className="adm-input" defaultValue={until} />
          </div>
          <div className="adm-field">
            <label className="adm-label" htmlFor="audit-outcome">
              النتيجة
            </label>
            <select
              id="audit-outcome"
              name="outcome"
              className="adm-select"
              defaultValue={filters.outcome ?? ""}
            >
              <option value="">كل النتائج</option>
              <option value="SUCCESS">تغيير اتحفظ</option>
              <option value="FAILURE">محاولة مرفوضة</option>
            </select>
          </div>
          <div className="adm-field">
            <label className="adm-label" htmlFor="audit-sensitive">
              العمليات الحساسة
            </label>
            <select
              id="audit-sensitive"
              name="sensitive"
              className="adm-select"
              defaultValue={filters.sensitiveOnly ? "true" : ""}
            >
              <option value="">كل العمليات</option>
              <option value="true">الحساسة بس</option>
            </select>
          </div>
          <div className="adm-btn-row">
            <button type="submit" className="adm-btn adm-btn--primary">
              تصفية
            </button>
            {filtered ? (
              <Link href="/admin/audit-logs" className="adm-btn adm-btn--secondary">
                مسح الفلترة
              </Link>
            ) : null}
          </div>
        </div>
      </form>

      {rows === null ? (
        <ErrorState
          title="مفيش تحميل للسجل"
          hint="حصلت مشكلة في جلب سجل التغييرات من قاعدة البيانات. جرّب تعمل تحديث للصفحة."
        />
      ) : (
        <Panel title="التغييرات" sub={`${rows.length} سطر في الصفحة دي`} flush>
          <DataTable
            caption="سجل تغييرات المتجر"
            columns={[
              { header: "مين" },
              { header: "إيه اللي عمله" },
              { header: "القسم" },
              { header: "إمتى" },
              { header: "النتيجة" },
            ]}
            rows={rows.map((row) => [
              <span className="adm-cell-main" key="actor">
                <span className="adm-cell-title">
                  {row.user_id ? actorNames.get(row.user_id) ?? "غير معروف" : actorTypeLabel(row.actor_type)}
                </span>
                <span className="adm-cell-sub">
                  {row.user_id ? actorTypeLabel(row.actor_type) : "مفيش حساب مسجل"}
                </span>
              </span>,
              <Link href={`/admin/audit-logs/${row.id}`} className="adm-cell-title" key="action">
                {auditActionText(row.action)}
              </Link>,
              auditEntityText(row.entity_type),
              formatDateTime(row.created_at),
              auditActionOutcome(row.action) === "FAILURE" ? (
                <Pill key="result" tone="danger">
                  {auditResultText(row.action)}
                </Pill>
              ) : (
                <Pill key="result" tone="success">
                  {auditResultText(row.action)}
                </Pill>
              ),
            ])}
            emptyLabel="مفيش تغييرات مطابقة للفلترة دي."
          />
          <Pager
            basePath="/admin/audit-logs"
            params={{
              action: filters.action ?? undefined,
              entityType: filters.entityType ?? undefined,
              since: since || undefined,
              until: until || undefined,
              outcome: filters.outcome ?? undefined,
              sensitive: filters.sensitiveOnly ? "true" : undefined,
            }}
            nextCursor={nextCursor}
            label="سطر"
          />
        </Panel>
      )}

      <Note tone="info">
        السجل بيتكتب جوّه نفس عملية الحفظ، فسطره معناها إن التغيير اتسجل بالفعل. الدخول المرفوض وعمليات
        الدخول بس هم الاستثناء، والسطر بيبقى معروف من نوع التغيير نفسه.
      </Note>
    </>
  );
}
