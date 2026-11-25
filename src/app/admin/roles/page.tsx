// ADMIN ROLES — the roles the store team works with (server).
//
// A role is a named set of capabilities: the admin puts the capabilities in
// the role, then hands the role to the people who need them. This page is the
// list of those roles: what each one is called, what it can do, and how many
// people hold it.
//
// One page of rows at a time: the browser never receives the whole table. The
// order is by name with a stable id tiebreak and the cursor is minted from the
// LAST KEPT row of the page, so nothing is skipped and nothing shows twice.
// Roles that were soft-deleted never reach the table.

import type { Metadata } from "next";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { decodeCursor, encodeCursor, pageOrder, pageWhereName, type PageCursor } from "@/lib/api/pagination";
import { PermissionGate } from "@/components/admin/permission-gate";
import { RoleCreateForm } from "@/components/admin/role-forms";
import { DataTable, ErrorState, Note, PageHead, Panel, Pager, Pill } from "@/components/admin/ui/surfaces";
import { roleDisplayName, roleKeysMatching } from "./role-labels";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "أدوار فريق المتجر — الإدارة",
  robots: { index: false, follow: false },
};

const LIMIT = 20;

const ARABIC_TEXT = /[\u0600-\u06FF]/;

type RawParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AdminRolesPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const admin = await requirePermission("roles.view");
  const sp = await searchParams;
  const search = (one(sp.search) ?? "").trim().slice(0, 60);

  let cursor: PageCursor | null = null;
  try {
    cursor = decodeCursor(one(sp.cursor) ?? null);
  } catch {
    cursor = null;
  }

  const where: Prisma.RoleWhereInput = {
    deletedAt: null,
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            // The operator searches the Arabic name of a role, so the stored
            // machine names behind those labels are searched too.
            ...roleKeysMatching(search).map((key) => ({ name: { equals: key } })),
          ],
        }
      : {}),
    AND: [pageWhereName(cursor, "asc") as Prisma.RoleWhereInput],
  };

  let rows: Array<
    Prisma.RoleGetPayload<{ include: { _count: { select: { rolePermissions: true; userRoles: true } } } }>
  > | null = null;
  let hasMore = false;
  try {
    const found = await prisma.role.findMany({
      where,
      orderBy: pageOrder("name", "asc"),
      take: LIMIT + 1,
      include: { _count: { select: { rolePermissions: true, userRoles: true } } },
    });
    hasMore = found.length > LIMIT;
    rows = hasMore ? found.slice(0, LIMIT) : found;
  } catch {
    rows = null;
  }

  const lastRow = rows && rows.length ? rows[rows.length - 1] : null;
  const nextCursor = hasMore && lastRow ? encodeCursor(lastRow.name, lastRow.id) : null;

  return (
    <>
      <PageHead
        eyebrow="الأدوار"
        title="أدوار فريق المتجر"
        intro="الدور هو مجموعة صلاحيات باسم معروف. لما تضيف الصلاحيات للدور، أي عضو يشغل الدور يحصل على الصلاحيات دي مع بعض. من هنا بتشوف الأدوار الموجودة في المتجر، وعدد الصلاحيات والأعضاء في كل دور."
      />

      <form method="get" action="/admin/roles" className="adm-filters" aria-label="بحث في أدوار المتجر">
        <div className="adm-filters-grid">
          <div className="adm-field adm-filter-search">
            <label className="adm-label" htmlFor="roles-search">
              بحث باسم الدور
            </label>
            <input
              id="roles-search"
              name="search"
              className="adm-input"
              defaultValue={search}
              maxLength={60}
              placeholder="اسم الدور"
              autoComplete="off"
            />
          </div>
          <div className="adm-btn-row">
            <button type="submit" className="adm-btn adm-btn--primary">
              بحث
            </button>
            {search ? (
              <Link href="/admin/roles" className="adm-btn adm-btn--secondary">
                مسح البحث
              </Link>
            ) : null}
          </div>
        </div>
      </form>

      {rows === null ? (
        <ErrorState
          title="مفيش تحميل للقائمة"
          hint="حصلت مشكلة في جلب الأدوار من قاعدة البيانات. جرّب تعمل تحديث للصفحة."
        />
      ) : (
        <Panel title="أدوار المتجر" sub={`${rows.length} دور في الصفحة دي`} flush>
          <DataTable
            caption="أدوار فريق المتجر"
            columns={[
              { header: "الدور" },
              { header: "الوصف" },
              { header: "عدد الصلاحيات", numeric: true },
              { header: "عدد المستخدمين", numeric: true },
              { header: "الحالة" },
            ]}
            rows={rows.map((role) => [
              <span className="adm-cell-title" key="name">
                <Link href={`/admin/roles/${role.id}`}>{roleDisplayName(role.name)}</Link>
              </span>,
              role.description && ARABIC_TEXT.test(role.description) ? role.description : "—",
              role._count.rolePermissions,
              role._count.userRoles,
              role.isActive ? (
                <Pill key="state" tone="success">
                  نشط
                </Pill>
              ) : (
                <Pill key="state" tone="warn">
                  موقوف
                </Pill>
              ),
            ])}
            emptyLabel="مفيش أدوار مطابقة للبحث ده."
          />
          <Pager
            basePath="/admin/roles"
            params={{ search: search || undefined }}
            nextCursor={nextCursor}
            label="دور"
          />
        </Panel>
      )}

      <Note tone="info">
        الدور الموقوف يفضل موجود في القائمة، لكن أي عضو يشغل الدور الموقوف مش بياخد أي صلاحية منه.
        الأدوار اللي اتشالت من المتجر مش بتظهر هنا خالص.
      </Note>

      <Panel title="إضافة دور جديد" sub="الاسم والوصف بس، والصلاحيات بتتضاف من صفحة الدور">
        <PermissionGate permissions={admin.permissions} required="roles.manage" action="إضافة الأدوار">
          <RoleCreateForm />
        </PermissionGate>
      </Panel>
    </>
  );
}
