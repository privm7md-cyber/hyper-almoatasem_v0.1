// ADMIN ORDERS — the operations queue.
//
// Everything on this screen is decided on the server: the filters are a
// plain GET form, so the browser never filters a row, and the queue is a
// newest-first keyset so no order is skipped or repeated while the operator
// walks the pages.

import type { Metadata } from "next";
import Link from "next/link";
import { ApiError } from "@/lib/api/errors";
import { requirePermission } from "@/lib/auth/rbac";
import { listOrderQueue } from "@/lib/orders/admin-queue";
import { cairoDayBounds, readCalendarDay } from "@/lib/admin/date-range";
import {
  ORDER_STATUS_LABELS,
  formatDateTime,
  formatMoney,
  orderStatusLabel,
} from "@/lib/admin/terminology";
import {
  DataTable,
  EmptyState,
  ErrorState,
  Note,
  PageHead,
  Pager,
  Panel,
  StatusPill,
  type PillTone,
} from "@/components/admin/ui/surfaces";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "الطلبات — الإدارة",
  robots: { index: false, follow: false },
};

const PAGE_SIZE = 20;
const SEARCH_MAX = 64;

/** Tones for the status pill — the eye finds the live states first. */
const STATUS_TONE: Record<string, PillTone> = {
  NEW: "accent",
  CONFIRMED: "info",
  PREPARING: "info",
  READY_FOR_DELIVERY: "warn",
  OUT_FOR_DELIVERY: "warn",
  DELIVERED: "success",
  CANCELLED: "danger",
};

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission("orders.view");
  const raw = await searchParams;
  const sp: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(raw)) sp[key] = Array.isArray(value) ? value[0] : value;

  const status = sp.status && /^[A-Z][A-Z0-9_]{0,63}$/.test(sp.status) ? sp.status : null;
  const search = typeof sp.search === "string" ? sp.search.trim().slice(0, SEARCH_MAX) : "";
  const fromDay = readCalendarDay(sp.dateFrom);
  const toDay = readCalendarDay(sp.dateTo);
  const cursor = typeof sp.cursor === "string" && sp.cursor !== "" ? sp.cursor : null;

  const invalidDates = Boolean(
    (sp.dateFrom && !fromDay) || (sp.dateTo && !toDay) ||
    (fromDay && toDay && fromDay > toDay) ||
    Array.isArray(raw.dateFrom) || Array.isArray(raw.dateTo),
  );
  let validationError = invalidDates ? "اختر تاريخ بداية ونهاية صحيحين وبالترتيب بتوقيت القاهرة." : null;
  let cursorError = false;
  let page: Awaited<ReturnType<typeof listOrderQueue>> | null = null;
  try {
    if (!invalidDates) page = await listOrderQueue({
      limit: PAGE_SIZE,
      cursor,
      status,
      search: search === "" ? null : search,
      dateFrom: fromDay ? cairoDayBounds(fromDay).start.toISOString() : null,
      dateTo: null,
      dateBefore: toDay ? cairoDayBounds(toDay).endExclusive.toISOString() : null,
    });
  } catch (error) {
    if (error instanceof ApiError && error.code === "VALIDATION") {
      validationError = "موضع الصفحة مش صالح للفلترة الحالية. ابدأ من أول النتائج بنفس الفلترة.";
      cursorError = true;
    }
    page = null;
  }

  const rows = page?.rows ?? [];
  const pagerParams: Record<string, string | undefined> = {
    status: status ?? undefined,
    search: search === "" ? undefined : search,
    dateFrom: fromDay ?? undefined,
    dateTo: toDay ?? undefined,
  };
  const restartParams = new URLSearchParams();
  for (const [key, value] of Object.entries(pagerParams)) if (value) restartParams.set(key, value);
  const restartHref = `/admin/orders${restartParams.size ? `?${restartParams}` : ""}`;

  return (
    <>
      <PageHead
        eyebrow="الطلبات"
        title="الطلبات"
        intro="من هنا بتشوف كل طلب وصل المتجر، بتتابعه خطوة بخطوة، وبتعرف هو واقف فين. فلتر بالحالة أو برقم الطلب أو بتليفون العميل أو باسمه، وكل صفحة مرتبة من الأحدث للأقدم."
      />

      {/* --------------------------------------------------------- filters */}
      <form key={JSON.stringify(pagerParams)} method="get" action="/admin/orders" className="adm-filters">
        <div className="adm-filters-grid">
          <div className="adm-field">
            <label className="adm-label" htmlFor="status">
              حالة الطلب
            </label>
            <select id="status" name="status" className="adm-select" defaultValue={status ?? ""}>
              <option value="">كل الحالات</option>
              {Object.entries(ORDER_STATUS_LABELS).map(([token, label]) => (
                <option key={token} value={token}>
                  {label}
                </option>
              ))}
              {status && !Object.hasOwn(ORDER_STATUS_LABELS, status) ? (
                <option value={status}>{orderStatusLabel(status)}</option>
              ) : null}
            </select>
          </div>

          <div className="adm-field adm-filter-search">
            <label className="adm-label" htmlFor="search">
              بحث في الطلبات
            </label>
            <input
              id="search"
              name="search"
              className="adm-input"
              defaultValue={search}
              maxLength={SEARCH_MAX}
              placeholder="رقم الطلب أو تليفون العميل أو اسم العميل"
            />
          </div>

          <div className="adm-field">
            <label className="adm-label" htmlFor="dateFrom">
              من تاريخ
            </label>
            <input id="dateFrom" name="dateFrom" type="date" className="adm-input" defaultValue={fromDay ?? ""} />
          </div>

          <div className="adm-field">
            <label className="adm-label" htmlFor="dateTo">
              لحد تاريخ
            </label>
            <input id="dateTo" name="dateTo" type="date" className="adm-input" defaultValue={toDay ?? ""} />
          </div>

          <div className="adm-btn-row">
            <button type="submit" className="adm-btn adm-btn--primary">
              اعرض الطلبات
            </button>
            <Link href="/admin/orders" className="adm-btn adm-btn--ghost">
              مسح الفلترة
            </Link>
          </div>
        </div>
      </form>

      {/* ----------------------------------------------------------- table */}
      <Panel title="الطلبات" sub="النتايج المطابقة للفلترة الحالية" flush>
        {page === null ? (
          <div className="adm-panel-body">
            <ErrorState
              title={validationError ? "راجع فلاتر الطلبات" : "مقدرناش نحمّل الطلبات"}
              hint={validationError ?? "حصلت مشكلة في جلب القائمة. جرّب تعمل تحديث للصفحة، ولو المشكلة فضلت كلّم مالك المتجر."}
            />
            {cursorError ? <Link href={restartHref} className="adm-btn adm-btn--secondary">ابدأ من أول النتائج بنفس الفلترة</Link> : null}
          </div>
        ) : rows.length === 0 ? (
          <div className="adm-panel-body">
            <EmptyState
              title="مفيش طلبات مطابقة للفلترة"
              hint="مفيش ولا طلب واقع في الشروط اللي اخترتها. جرّب حالة تانية، أو امسح الفلترة واعرض كل الطلبات."
              action={
                <Link href="/admin/orders" className="adm-btn adm-btn--secondary">
                  امسح الفلترة واعرض كل الطلبات
                </Link>
              }
            />
          </div>
        ) : (
          <>
            <DataTable
              caption="الطلبات المطابقة للفلترة الحالية، من الأحدث للأقدم"
              columns={[
                { header: "رقم الطلب" },
                { header: "العميل" },
                { header: "التليفون" },
                { header: "الحالة" },
                { header: "الإجمالي", numeric: true },
                { header: "وقت الوصول" },
              ]}
              rows={rows.map((row) => [
                <Link key={`${row.id}-no`} href={`/admin/orders/${row.id}`} className="adm-cell-title">
                  {row.orderNumber}
                </Link>,
                row.customerName,
                <span key={`${row.id}-phone`} className="adm-cell-sub" dir="ltr">
                  {row.customerPhone}
                </span>,
                <StatusPill key={`${row.id}-status`} tone={STATUS_TONE[row.status] ?? "neutral"}>
                  {orderStatusLabel(row.status)}
                </StatusPill>,
                row.totalFinal === null ? (
                  <span key={`${row.id}-total`}>
                    {formatMoney(row.totalEstimated)}
                    <span className="adm-cell-sub"> · تقديري</span>
                  </span>
                ) : (
                  <span key={`${row.id}-total`}>{formatMoney(row.totalFinal)}</span>
                ),
                <span key={`${row.id}-created`} className="adm-cell-sub">
                  {formatDateTime(row.createdAt)}
                </span>,
              ])}
            />
            <Pager basePath="/admin/orders" params={pagerParams} nextCursor={page.nextCursor} label="نتيجة" />
          </>
        )}
      </Panel>

      <Note tone="info">
        فلتر الحالة بياخد الحالة نفسها من رحلة الطلب: «طلب جديد» يعني لسه ما اتأكدش، و«قيد التجهيز» يعني
        الفريق شغال عليه دلوقتي، و«ملغي» يعني خلاص مش هيوصل. القائمة مرتبة من الأحدث للأقدم، وكل صفحة
        فيها 20 طلب، والتاريخ بيتحسب على يوم كامل بتوقيت المتجر.
      </Note>
    </>
  );
}
