// ADMIN USERS — the store team accounts (server).
//
// This screen is about the people who sign in to the admin panel, NOT about
// the shop's customers. One page of rows at a time: the browser never
// receives the whole table. The order is newest account first with a stable
// id tiebreak, and the cursor is minted from the LAST KEPT row of the page,
// so nothing is skipped and nothing shows twice.
//
// Deactivation is the lifecycle of an account: nothing is deleted, so the
// history of who did what stays readable.

import type { Metadata } from "next";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { decodeCursor, encodeCursor, pageWhereCreatedAt, type PageCursor } from "@/lib/api/pagination";
import { formatRelative, roleLabel } from "@/lib/admin/terminology";
import { NameBadge } from "@/components/admin/name-badge";
import { PermissionGate } from "@/components/admin/permission-gate";
import { UserCreateForm } from "@/components/admin/user-forms";
import { DataTable, ErrorState, Note, PageHead, Panel, Pager, Pill } from "@/components/admin/ui/surfaces";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "مستخدمو المتجر — الإدارة",
  robots: { index: false, follow: false },
};

const LIMIT = 20;

type UserListRow = Prisma.UserGetPayload<{
  include: { userRoles: { include: { role: { select: { name: true; isActive: true } } } } };
}>;

type RawParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  const admin = await requirePermission("users.view");
  const sp = await searchParams;

  const search = (one(sp.search) ?? "").trim().slice(0, 160);
  const statusParam = one(sp.status);
  const active = statusParam === "active" ? true : statusParam === "suspended" ? false : null;
  const statusValue = active === null ? "" : active ? "active" : "suspended";

  let cursor: PageCursor | null = null;
  try {
    cursor = decodeCursor(one(sp.cursor) ?? null);
  } catch {
    cursor = null;
  }

  // The cursor is a page position, not a filter: the total describes the
  // whole matching set, not only the rows left after this page.
  const filterWhere: Prisma.UserWhereInput = {
    deletedAt: null,
    ...(active === null ? {} : { isActive: active }),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { email: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
  const where: Prisma.UserWhereInput = {
    ...filterWhere,
    AND: [pageWhereCreatedAt(cursor, "desc") as Prisma.UserWhereInput],
  };

  let rows: UserListRow[] | null = null;
  let hasMore = false;
  let total = 0;
  try {
    const found = await prisma.user.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: LIMIT + 1,
      include: { userRoles: { include: { role: { select: { name: true, isActive: true } } } } },
    });
    hasMore = found.length > LIMIT;
    rows = hasMore ? found.slice(0, LIMIT) : found;
    total = await prisma.user.count({ where: filterWhere });
  } catch {
    rows = null;
  }

  const lastRow = rows && rows.length ? rows[rows.length - 1] : null;
  const nextCursor =
    hasMore && lastRow ? encodeCursor(lastRow.createdAt.toISOString(), lastRow.id) : null;

  return (
    <>
      <PageHead
        eyebrow="فريق المتجر"
        title="مستخدمو المتجر"
        intro="حسابات فريق المتجر اللي بتدخل لوحة الإدارة، مش عملاء المتجر. من هنا بتعرف مين يقدر يدخل وإيه الأدوار اللي كل حساب شاغلها، وتضيف حساب جديد أو توقفه."
      />

      <form method="get" action="/admin/users" className="adm-filters" aria-label="بحث وفلترة حسابات الفريق">
        <div className="adm-filters-grid">
          <div className="adm-field adm-filter-search">
            <label className="adm-label" htmlFor="users-search">
              بحث بالاسم أو البريد
            </label>
            <input
              id="users-search"
              name="search"
              className="adm-input"
              defaultValue={search}
              maxLength={160}
              placeholder="اسم الحساب أو بريده"
              autoComplete="off"
            />
          </div>
          <div className="adm-field">
            <label className="adm-label" htmlFor="users-status">
              حالة الحساب
            </label>
            <select
              id="users-status"
              name="status"
              className="adm-select"
              defaultValue={statusValue}
            >
              <option value="">الكل</option>
              <option value="active">مفعّل</option>
              <option value="suspended">موقوف</option>
            </select>
          </div>
          <div className="adm-btn-row">
            <button type="submit" className="adm-btn adm-btn--primary">
              بحث
            </button>
            {search || active !== null ? (
              <Link href="/admin/users" className="adm-btn adm-btn--secondary">
                مسح الفلترة
              </Link>
            ) : null}
          </div>
        </div>
      </form>

      {rows === null ? (
        <ErrorState
          title="مفيش تحميل للقائمة"
          hint="حصلت مشكلة في جلب حسابات الفريق من قاعدة البيانات. جرّب تعمل تحديث للصفحة."
        />
      ) : (
        <Panel
          title="حسابات الفريق"
          sub={total ? `${total} حساب مطابق للفلترة الحالية` : "مفيش حسابات مطابقة للفلترة الحالية"}
          flush
        >
          <DataTable
            caption="حسابات فريق المتجر المطابقة للفلترة الحالية"
            columns={[
              { header: "الاسم" },
              { header: "البريد" },
              { header: "الأدوار" },
              { header: "آخر دخول" },
              { header: "الحالة" },
            ]}
            rows={rows.map((user) => [
              <span className="adm-cell-title" key="name">
                <Link href={`/admin/users/${user.id}`}>{user.name}</Link>{" "}
                <NameBadge name={user.name} />
              </span>,
              <bdi key="email">{user.email}</bdi>,
              user.userRoles.length ? (
                <span className="adm-chips" key="roles">
                  {user.userRoles.map((userRole) => (
                    <span className="adm-chip" key={userRole.role.name}>
                      {roleLabel(userRole.role.name)}
                      {userRole.role.isActive ? "" : " · موقوف"}
                    </span>
                  ))}
                </span>
              ) : (
                <span key="roles">مفيش أدوار</span>
              ),
              user.lastLoginAt ? formatRelative(user.lastLoginAt) : "لسه ما دخلش",
              user.isActive ? (
                <Pill key="state" tone="success">
                  مفعّل
                </Pill>
              ) : (
                <Pill key="state" tone="warn">
                  موقوف
                </Pill>
              ),
            ])}
            emptyLabel="مفيش حسابات مطابقة للفلترة دي."
          />
          <Pager
            basePath="/admin/users"
            params={{ search: search || undefined, status: statusValue || undefined }}
            nextCursor={nextCursor}
            label="حساب"
          />
        </Panel>
      )}

      <Note tone="info">
        إيقاف الحساب بيمنع الدخول للوحة الإدارة بس. كل اللي عمله الحساب ده قبل الإيقاف — الطلبات والتعديلات
        وسجل التغييرات — بيفضل محفوظ، والإيقاف مش بيحذف أي حاجة.
        <br />
        اسم كل حساب في الجدول هو الاسم اللي اتكتب وقت إنشاء الحساب، وبيبان بالحرف زي ما هو. لو اسم
        حسابك مش بالشكل اللي عايزه، افتح صفحة الحساب نفسه وغيّره من هناك.
      </Note>

      <Panel title="إضافة حساب جديد" sub="الحساب بيتضاف من غير كلمة سر، وكلمة السر بتتحدد من صفحته">
        <PermissionGate permissions={admin.permissions} required="users.manage" action="إضافة حسابات الفريق">
          <UserCreateForm />
        </PermissionGate>
      </Panel>
    </>
  );
}
