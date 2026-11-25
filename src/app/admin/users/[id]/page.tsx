// ADMIN USER DETAIL — one team account: its data, its roles, its credentials.
//
// The roles are shown in words: the Arabic name, what the role is for, and
// the permissions it carries — never the machine key. Assigning a role needs
// the role-management permission, and the store's guards (no self-lockout, no
// removing the last owner) stay on the server.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { formatDate, formatRelative, hasArabicText, permissionLabel, roleLabel } from "@/lib/admin/terminology";
import { PermissionGate } from "@/components/admin/permission-gate";
import {
  UserPatchForm,
  UserPasswordForm,
  UserRolesManager,
} from "@/components/admin/user-detail-forms";
import {
  CardGrid,
  DataTable,
  EmptyState,
  KeyValue,
  Note,
  PageHead,
  Panel,
  Pill,
} from "@/components/admin/ui/surfaces";
import { effectivePermissionsFor } from "@/lib/admin/effective-permissions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "حساب من فريق المتجر — الإدارة",
  robots: { index: false, follow: false },
};

/**
 * What each role is for, in words. The stored role descriptions are written
 * in English, so the Arabic wording lives here with the screen that shows it.
 */
const ROLE_MEANING: Record<string, string> = {
  SUPER_ADMIN: "صاحب المتجر: كل الصلاحيات، بما فيها إعدادات النظام وحسابات الفريق.",
  STORE_ADMIN: "مدير المتجر: بيدير شغل المتجر كله — المنتجات والمخزون والطلبات والعملاء.",
};

const ROLE_FALLBACK_MEANING =
  "دور مضاف من غير وصف محفوظ. الصلاحيات اللي بيشتغل بيها معروضة تحت.";

type UserRow = Prisma.UserGetPayload<{
  include: { userRoles: { include: { role: { select: { id: true; name: true; isActive: true } } } } };
}>;

type RoleRow = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
};

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const admin = await requirePermission("users.view");
  const { id } = await params;

  const user = await prisma.user.findUnique({
    where: { id },
    include: { userRoles: { include: { role: { select: { id: true, name: true, isActive: true } } } } },
  }).catch(() => null);
  if (!user) notFound();

  const allRoles: RoleRow[] = await prisma.role
    .findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, description: true, isActive: true },
    })
    .catch(() => []);

  const assignedRoleIds = user.userRoles.map((userRole) => userRole.role.id);
  const grants = await prisma.rolePermission
    .findMany({
      where: { roleId: { in: assignedRoleIds } },
      include: { permission: { select: { key: true, isActive: true } } },
    })
    .catch(() => []);

  const permissionsByRole = new Map<string, string[]>();
  for (const grant of grants) {
    if (!grant.permission.isActive) continue;
    const list = permissionsByRole.get(grant.roleId) ?? [];
    list.push(permissionLabel(grant.permission.key));
    permissionsByRole.set(grant.roleId, list);
  }

  const typedUser: UserRow = user;
  // ADM-09: the effective report keeps "defined in code", "present in the
  // database" and "granted to this account" apart. A sensitive capability is
  // never presented as active just because the catalogue defines it.
  const effective = await effectivePermissionsFor(id, admin.permissions).catch(() => null);
  const sensitivePermissions = effective?.permissions.filter((permission) => permission.sensitive) ?? [];
  const activationLabel: Record<string, string> = {
    GRANTED: "مفعّلة",
    NOT_GRANTED: "مش ممنوحة",
    DB_MISSING: "ناقصة في قاعدة البيانات",
    PENDING_OWNER_APPROVAL: "محتاجة موافقة المالك",
  };

  return (
    <>
      <PageHead
        eyebrow="فريق المتجر"
        title={typedUser.name}
        intro="حساب واحد من فريق المتجر: بياناته، أدواره، وإمكانية إيقافه أو تغيير كلمة مروره. إيقاف الحساب بيمنع الدخول بس وبيسيب كل تاريخه محفوظ."
      />

      {typedUser.deletedAt ? (
        <Note tone="danger">
          الحساب ده محذوف ومؤرشف من تاريخ {formatDate(typedUser.deletedAt)} — لا يمكن استخدامه لتسجيل الدخول.
        </Note>
      ) : null}

      {hasArabicText(typedUser.name) ? null : (
        <Note tone="info">
          اسم الحساب دلوقتي مكتوب بالإنجليزي. اللوحة بتعرضه بالحرف زي ما هو محفوظ — من غير ما تغيّره
          أو تخفيه — لكن تقدر تغيّره باسم عربي من لوحة «تعديل بيانات الحساب» تحت. التعديل بيتحفظ
          على طول وبيشوفه كل من بيفتح صفحة الحساب دي.
        </Note>
      )}

      <Panel title="بيانات الحساب">
        <KeyValue
          items={[
            { label: "الاسم", value: typedUser.name },
            { label: "البريد", value: <bdi>{typedUser.email}</bdi> },
            { label: "التليفون", value: typedUser.phone ? <bdi>{typedUser.phone}</bdi> : "مش متسجل" },
            {
              label: "الحالة",
              value: typedUser.deletedAt
                ? <Pill tone="danger">محذوف</Pill>
                : typedUser.isActive
                  ? <Pill tone="success">مفعّل</Pill>
                  : <Pill tone="warn">موقوف</Pill>,
            },
            {
              label: "آخر دخول",
              value: typedUser.lastLoginAt ? formatRelative(typedUser.lastLoginAt) : "لسه ما دخلش",
            },
            { label: "تاريخ الإنشاء", value: formatDate(typedUser.createdAt) },
          ]}
        />
      </Panel>

      <Panel title="الأدوار" sub="الأدوار اللي الحساب ده شاغلها دلوقتي">
        {typedUser.userRoles.length === 0 ? (
          <EmptyState
            title="الحساب ده مفيش عليه أدوار"
            hint="من غير دور الحساب مش بيدخل أي قسم في لوحة الإدارة. أضيف دور من النموذج تحت."
          />
        ) : (
          <CardGrid>
            {typedUser.userRoles.map((userRole) => {
              const permissions = permissionsByRole.get(userRole.role.id) ?? [];
              return (
                <div className="adm-card" key={userRole.role.id}>
                  <span className="adm-card-title">
                    {roleLabel(userRole.role.name)}
                    {userRole.role.isActive ? null : <Pill tone="warn">موقوف</Pill>}
                  </span>
                  <p className="adm-card-text">
                    {ROLE_MEANING[userRole.role.name] ?? ROLE_FALLBACK_MEANING}
                  </p>
                  {permissions.length ? (
                    <span className="adm-chips">
                      {permissions.map((label, index) => (
                        <span className="adm-chip" key={`${userRole.role.id}-${index}`}>
                          {label}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="adm-cell-sub">مفيش صلاحيات مسجّلة على الدور ده.</span>
                  )}
                </div>
              );
            })}
          </CardGrid>
        )}
      </Panel>

      <Panel
        title="الصلاحيات الفعلية"
        sub="الفرق بين الصلاحية الموجودة في الكود، والموجودة في قاعدة البيانات، والممنوحة للحساب فعلًا"
      >
        {effective === null ? (
          <EmptyState
            title="مفيش قراءة للصلاحيات الفعلية"
            hint="تعذر حساب الصلاحيات الفعلية للحساب من قاعدة البيانات. الحالة مش معروفة، ومش معروض إنها مفعّلة."
          />
        ) : (
          <>
            <KeyValue
              items={[
                { label: "إجمالي الصلاحيات في الدليل", value: `${effective.summary.catalogueTotal}` },
                { label: "الممنوحة للحساب", value: `${effective.summary.grantedTotal}` },
                { label: "ناقصة في قاعدة البيانات", value: `${effective.summary.missingInDatabase}` },
                { label: "محتاجة موافقة المالك", value: `${effective.summary.pendingOwnerApproval}` },
                { label: "داخل صلاحيات حسابك", value: `${effective.summary.allowedHereTotal}` },
              ]}
            />
            <DataTable
              caption="الصلاحيات الحساسة وحالتها الفعلية"
              columns={[{ header: "الصلاحية" }, { header: "المعنى" }, { header: "الحالة" }, { header: "المصدر وصلاحيتك" }]}
              rows={sensitivePermissions.map((permission) => [
                <span className="adm-cell-title" key="label">
                  {permission.label}
                </span>,
                <span className="adm-cell-sub" key="description">
                  {permission.description}
                </span>,
                <Pill
                  key="activation"
                  tone={
                    permission.activation === "GRANTED"
                      ? "success"
                      : permission.activation === "PENDING_OWNER_APPROVAL"
                        ? "warn"
                        : permission.activation === "DB_MISSING"
                          ? "danger"
                          : "neutral"
                  }
                >
                  {activationLabel[permission.activation] ?? permission.activation}
                </Pill>,
                <span className="adm-cell-sub" key="source">
                  {permission.source ? permission.source.roleName : "مفيش دور نشط بيمنحها"}
                  <br />
                  {permission.allowedHere ? "تقدر تمنحها من حسابك: نعم" : "تقدر تمنحها من حسابك: لأ"}
                </span>,
              ])}
              emptyLabel="مفيش صلاحيات حساسة معروضة."
            />
            <Note tone="info">
              «مفعّلة» معناها إن الصلاحية موجودة في قاعدة البيانات وممنوحة للحساب من دور نشط. «مش ممنوحة»
              معناها إنها معرّفة في الكود بس مش واصلة للحساب. الصلاحيات المحتاجة موافقة المالك بتفضل
              «محتاجة موافقة» حتى لو كانت ممنوحة، لحد ما المالك يعتمد تشغيلها على بيانات حقيقية.
            </Note>
          </>
        )}
      </Panel>

      <Panel title="تعديل بيانات الحساب" sub="الاسم والبريد والتليفون وحالة الحساب">
        <PermissionGate
          permissions={admin.permissions}
          required="users.manage"
          action="تعديل بيانات الحساب"
        >
          <UserPatchForm
            id={typedUser.id}
            name={typedUser.name}
            email={typedUser.email}
            phone={typedUser.phone}
            isActive={typedUser.isActive}
          />
        </PermissionGate>
      </Panel>

      <Panel title="الأدوار الممنوحة" sub="إضافة دور أو سحبه — صلاحية إدارة الأدوار">
        <PermissionGate
          permissions={admin.permissions}
          required="roles.manage"
          action="إدارة أدوار الحساب"
        >
          <UserRolesManager
            userId={typedUser.id}
            assigned={typedUser.userRoles.map((userRole) => userRole.role.name)}
            allRoles={allRoles.map((role) => ({ id: role.id, name: role.name }))}
          />
        </PermissionGate>
      </Panel>

      <Panel title="كلمة المرور" sub="ضبط كلمة مرور الحساب من غير ما يبان في أي مكان">
        <PermissionGate
          permissions={admin.permissions}
          required="users.manage"
          action="ضبط كلمة مرور الحساب"
        >
          <UserPasswordForm id={typedUser.id} />
        </PermissionGate>
      </Panel>

      <Note tone="info">
        كلمة مرور الحساب مش بتظهر في أي صفحة ولا في السجل. بتتحدد من النموذج فوق، والمتجر بيخزنها بشكل
        مشفّر ومش بيقدر يرجّعها.
      </Note>
    </>
  );
}
