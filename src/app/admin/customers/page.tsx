// ADMIN CUSTOMERS — the customer list (server).
//
// One page of rows at a time: the browser never receives the whole table.
// The order is newest registration first with a stable id tiebreak, and the
// cursor is minted from the LAST KEPT row of the page, so nothing is skipped
// and nothing shows twice.
//
// Nothing is hidden here. The only evidence the store keeps about a record is
// the shape of its name, and that evidence is shown as a badge next to the
// name instead of being used to filter rows away.

import type { Metadata } from "next";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { decodeCursor, encodeCursor, pageWhereCreatedAt, type PageCursor } from "@/lib/api/pagination";
import { formatDate, formatMoney } from "@/lib/admin/terminology";
import { cairoDayBounds, readCalendarDay } from "@/lib/admin/date-range";
import { customerOrderSummaries } from "@/lib/customers/admin-reads";
import { NameBadge } from "@/components/admin/name-badge";
import { DataTable, ErrorState, Note, PageHead, Panel, Pager, Pill } from "@/components/admin/ui/surfaces";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "العملاء — الإدارة",
  robots: { index: false, follow: false },
};

const LIMIT = 20;

type CustomerListRow = Prisma.CustomerGetPayload<{
  include: { _count: { select: { orders: true } } };
}>;

type RawParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function fullName(row: { firstName: string; lastName: string | null }): string {
  return row.lastName ? `${row.firstName} ${row.lastName}` : row.firstName;
}

export default async function AdminCustomersPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  await requirePermission("customers.view");
  const sp = await searchParams;

  const search = (one(sp.search) ?? "").trim().slice(0, 80);
  const accountParam = one(sp.account);
  const account = accountParam === "yes" ? true : accountParam === "no" ? false : null;
  const accountValue = account === null ? "" : account ? "yes" : "no";
  const activeParam = one(sp.active);
  const active = activeParam === "yes" ? true : activeParam === "no" ? false : null;
  const activeValue = active === null ? "" : active ? "yes" : "no";
  // The registration window is a filter like any other: an impossible day is
  // refused instead of being normalised into a different one.
  const fromDay = readCalendarDay(one(sp.from));
  const toDay = readCalendarDay(one(sp.to));
  const invalidDates = Boolean(
    (one(sp.from) && !fromDay) || (one(sp.to) && !toDay) || (fromDay && toDay && fromDay > toDay),
  );

  let cursor: PageCursor | null = null;
  try {
    cursor = decodeCursor(one(sp.cursor) ?? null);
  } catch {
    // A stale link must not break the list: fall back to the first page.
    cursor = null;
  }

  const filterWhere: Prisma.CustomerWhereInput = {
    deletedAt: null,
    ...(account === null ? {} : { isRegistered: account }),
    ...(active === null ? {} : { isActive: active }),
    ...(fromDay || toDay
      ? {
          createdAt: {
            ...(fromDay ? { gte: cairoDayBounds(fromDay).start } : {}),
            ...(toDay ? { lt: cairoDayBounds(toDay).endExclusive } : {}),
          },
        }
      : {}),
    ...(search
      ? {
          OR: [
            { firstName: { contains: search, mode: "insensitive" as const } },
            { lastName: { contains: search, mode: "insensitive" as const } },
            { phone: { contains: search } },
            { email: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  // The cursor is a PAGE position, never a filter: the total has to describe
  // the whole matching set, not the tail that is left after this page.
  const where: Prisma.CustomerWhereInput = {
    ...filterWhere,
    AND: [pageWhereCreatedAt(cursor, "desc") as Prisma.CustomerWhereInput],
  };

  let rows: CustomerListRow[] | null = null;
  let hasMore = false;
  let total = 0;
  let summaries = new Map<string, Awaited<ReturnType<typeof customerOrderSummaries>> extends Map<string, infer V> ? V : never>();
  try {
    const found = await prisma.customer.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: LIMIT + 1,
      include: { _count: { select: { orders: true } } },
    });
    hasMore = found.length > LIMIT;
    rows = hasMore ? found.slice(0, LIMIT) : found;
    total = await prisma.customer.count({ where: filterWhere });
    // One query for the whole page — never one query per customer.
    summaries = await customerOrderSummaries(rows.map((row) => row.id)).catch(() => summaries);
  } catch {
    rows = null;
  }

  const lastRow = rows && rows.length ? rows[rows.length - 1] : null;
  const nextCursor =
    hasMore && lastRow ? encodeCursor(lastRow.createdAt.toISOString(), lastRow.id) : null;

  return (
    <>
      <PageHead
        eyebrow="العملاء"
        title="العملاء"
        intro="صفحة عملاء المتجر. من هنا بيتم البحث بالاسم أو التليفون، وفتح صفحة العميل لقراءة طلباته وعناوينه المحفوظة، وتعديل بيانات التواصل بتاعته."
      />

      <form method="get" action="/admin/customers" className="adm-filters" aria-label="بحث وفلترة العملاء">
        <div className="adm-filters-grid">
          <div className="adm-field adm-filter-search">
            <label className="adm-label" htmlFor="customers-search">
              بحث بالاسم أو التليفون أو البريد
            </label>
            <input
              id="customers-search"
              name="search"
              className="adm-input"
              defaultValue={search}
              maxLength={80}
              placeholder="اسم العميل أو رقم التليفون أو البريد"
              autoComplete="off"
            />
          </div>
          <div className="adm-field">
            <label className="adm-label" htmlFor="customers-account">
              حساب العميل
            </label>
            <select
              id="customers-account"
              name="account"
              className="adm-select"
              defaultValue={accountValue}
            >
              <option value="">الكل</option>
              <option value="yes">عنده حساب</option>
              <option value="no">من غير حساب</option>
            </select>
          </div>
          <div className="adm-field">
            <label className="adm-label" htmlFor="customers-active">
              حالة الحساب
            </label>
            <select
              id="customers-active"
              name="active"
              className="adm-select"
              defaultValue={activeValue}
            >
              <option value="">الكل</option>
              <option value="yes">مفعّل</option>
              <option value="no">موقوف</option>
            </select>
          </div>
          <div className="adm-field">
            <label className="adm-label" htmlFor="customers-from">
              سجّل من تاريخ
            </label>
            <input
              id="customers-from"
              name="from"
              type="date"
              className="adm-input"
              defaultValue={fromDay ?? ""}
            />
          </div>
          <div className="adm-field">
            <label className="adm-label" htmlFor="customers-to">
              سجّل لحد تاريخ
            </label>
            <input
              id="customers-to"
              name="to"
              type="date"
              className="adm-input"
              defaultValue={toDay ?? ""}
            />
          </div>
          <div className="adm-btn-row">
            <button type="submit" className="adm-btn adm-btn--primary">
              بحث
            </button>
            {search || account !== null || active !== null || fromDay || toDay ? (
              <Link href="/admin/customers" className="adm-btn adm-btn--secondary">
                مسح الفلترة
              </Link>
            ) : null}
          </div>
        </div>
      </form>

      {invalidDates ? (
        <Note tone="warn">اختر تاريخ بداية ونهاية صحيحين وبالترتيب — التاريخ الميكانيكي مش بيتقبل.</Note>
      ) : null}

      {rows === null ? (
        <ErrorState
          title="مفيش تحميل للقائمة"
          hint="حصلت مشكلة في جلب العملاء من قاعدة البيانات. جرّب تعمل تحديث للصفحة."
        />
      ) : (
        <Panel
          title="سجلات العملاء"
          sub={
            total
              ? `${total} سجل مطابق للفلترة الحالية`
              : "مفيش سجلات مطابقة للفلترة الحالية"
          }
          flush
        >          <DataTable
            caption="سجلات العملاء المطابقة للفلترة الحالية"
            columns={[
              { header: "العميل" },
              { header: "التليفون" },
              { header: "البريد" },
              { header: "الحساب" },
              { header: "عدد الطلبات", numeric: true },
              { header: "إجمالي الطلبات", numeric: true },
              { header: "آخر طلب" },
              { header: "تاريخ التسجيل" },
            ]}
            rows={rows.map((customer) => {
              const name = fullName(customer);
              const summary = summaries.get(customer.id);
              return [
                <span className="adm-cell-title" key="name">
                  <Link href={`/admin/customers/${customer.id}`}>{name}</Link>{" "}
                  <NameBadge name={name} />
                </span>,
                <bdi key="phone">{customer.phone}</bdi>,
                customer.email ? (
                  <bdi key="email">{customer.email}</bdi>
                ) : (
                  <span key="email" className="adm-cell-sub">
                    من غير بريد
                  </span>
                ),
                <span className="adm-cell-main" key="account">
                  <span className="adm-cell-title">
                    {customer.isRegistered ? (
                      <Pill tone="success">أيوه</Pill>
                    ) : (
                      <Pill tone="outline">لأ</Pill>
                    )}
                  </span>
                  <span className="adm-cell-sub">
                    {customer.isActive ? "مفعّل" : "موقوف"}
                    {customer.lockedUntil ? " · مقفول مؤقتًا" : ""}
                  </span>
                </span>,
                customer._count.orders,
                formatMoney(summary?.total ?? "0"),
                summary?.lastOrderAt ? (
                  <span className="adm-cell-main" key="last">
                    <span className="adm-cell-title">{formatDate(summary.lastOrderAt)}</span>
                    {summary.lastArea ? <span className="adm-cell-sub">{summary.lastArea}</span> : null}
                  </span>
                ) : (
                  <span key="last" className="adm-cell-sub">
                    لسه مالهوش طلب
                  </span>
                ),
                formatDate(customer.createdAt),
              ];
            })}
            emptyLabel="مفيش عملاء مطابقين للفلترة دي."
          />
          <Pager
            basePath="/admin/customers"
            params={{
              search: search || undefined,
              account: accountValue || undefined,
              active: activeValue || undefined,
              from: fromDay || undefined,
              to: toDay || undefined,
            }}
            nextCursor={nextCursor}
            label="عميل"
          />
        </Panel>
      )}

      <Note tone="info">
        العلامة اللي جنب الاسم بتوصف شكل الاسم بس: «بيانات اختبار» أو «الاسم محتاج مراجعة». قاعدة بيانات
        المتجر مفيهاش تاريخ ولا وسم يفرّق بين عميل حقيقي وسجل جاي من اختبار، فالعلامة دي كل الأدلة المتاحة
        والصفحة بتعرض كل السجلات من غير ما تخفي أي واحد.
      </Note>

      <Note tone="info">
        «عدد الطلبات» و«إجمالي الطلبات» بيتحسبوا من الطلبات اللي مرتبطة بالعميل فعليًا. الطلبات اللي اتعملت
        كضيف من غير حساب ما بتترتبطش بيه بعدين، والإجمالي بيحسب الطلبات اللي اتملغتش بس — الطلب الملغي
        مش بيتحصّل.
      </Note>
    </>
  );
}
