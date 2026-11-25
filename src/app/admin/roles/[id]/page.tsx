// ADMIN ROLE DETAIL — one role: what it can do and who holds it (server).
//
// The role is read as a group of capabilities: every granted capability is
// shown under the section of the store it belongs to, in the words the team
// uses. The machine key stays a quiet second line for the people who need it.
//
// The writes live in the role-forms island and are gated by the roles.manage
// capability, exactly like the server checks them.

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { PERMISSION_GROUPS, formatDate, permissionLabel } from "@/lib/admin/terminology";
import { PermissionGate } from "@/components/admin/permission-gate";
import { RoleDeleteButton, RoleGrantsManager, RolePatchForm } from "@/components/admin/role-forms";
import { EmptyState, KeyValue, Note, PageHead, Panel, Pill } from "@/components/admin/ui/surfaces";
import { roleDisplayName } from "../role-labels";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "تفاصيل الدور — الإدارة",
  robots: { index: false, follow: false },
};

const ARABIC_TEXT = /[\u0600-\u06FF]/;
const MEMBERS_PAGE = 50;

export default async function AdminRoleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requirePermission("roles.view");
  const { id } = await params;

  const role = await prisma.role
    .findUnique({
      where: { id },
      include: {
        rolePermissions: { include: { permission: { select: { key: true } } } },
        _count: { select: { userRoles: true } },
      },
    })
    .catch(() => null);
  if (!role || role.deletedAt) notFound();

  const grantedKeys = role.rolePermissions.map((grant) => grant.permission.key);

  const members = await prisma.userRole
    .findMany({
      where: { roleId: id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: MEMBERS_PAGE + 1,
      include: { user: { select: { id: true, name: true, email: true, isActive: true } } },
    })
    .catch(() => []);

  const permissions = await prisma.permission
    .findMany({ where: { isActive: true }, orderBy: [{ key: "asc" }] })
    .catch(() => []);

  const shownMembers = members.slice(0, MEMBERS_PAGE);
  const extraMembers = members.length - shownMembers.length;
  const displayName = roleDisplayName(role.name);

  return (
    <>
      <PageHead
        eyebrow="الأدوار"
        title={displayName}
        intro={`دور «${displayName}» فيه ${grantedKeys.length} صلاحية، و${role._count.userRoles} عضو يشغل الدور. أي حد يشغل الدور بياخد كل الصلاحيات دي مع بعض.`}
      />

      <Panel title="بيانات الدور" sub="الاسم والوصف والحالة">
        <KeyValue
          items={[
            { label: "اسم الدور", value: displayName },
            {
              label: "الوصف",
              value: role.description && ARABIC_TEXT.test(role.description) ? role.description : "—",
            },
            {
              label: "الحالة",
              value: role.isActive ? (
                <Pill tone="success">نشط</Pill>
              ) : (
                <Pill tone="warn">موقوف</Pill>
              ),
            },
            { label: "عدد الصلاحيات", value: grantedKeys.length },
            { label: "عدد الأعضاء", value: role._count.userRoles },
            { label: "تاريخ الإنشاء", value: formatDate(role.createdAt) },
          ]}
        />
      </Panel>

      <Panel title="الصلاحيات اللي في الدور" sub="مرتبة حسب أقسام المتجر">
        {grantedKeys.length === 0 ? (
          <EmptyState
            title="مفيش صلاحيات في الدور لسه"
            hint="الدور ده فاضي. أول ما تضيف صلاحية، هتظهر هنا تحت قسمها."
          />
        ) : (
          <div className="adm-stagger">
            {PERMISSION_GROUPS.map((group) => {
              const granted = grantedKeys.filter((key) =>
                group.permissions.some((permission) => permission.key === key),
              );
              if (granted.length === 0) return null;
              return (
                <div className="adm-field" key={group.title}>
                  <span className="adm-cell-title">{group.title}</span>
                  <p className="adm-hint">{group.intro}</p>
                  <div className="adm-chips">
                    {granted.map((key) => (
                      <span className="adm-chip" key={key}>
                        <span>{permissionLabel(key)}</span>
                        <span className="adm-cell-id" dir="ltr">
                          {key}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
            {(() => {
              const knownKeys = new Set(PERMISSION_GROUPS.flatMap((group) => group.permissions.map((permission) => permission.key)));
              const ungrouped = grantedKeys.filter((key) => !knownKeys.has(key));
              if (ungrouped.length === 0) return null;
              return (
                <div className="adm-field" key="other-permissions">
                  <span className="adm-cell-title">صلاحيات أخرى</span>
                  <p className="adm-hint">صلاحيات إضافية مسجّلة للدور خارج التصنيفات القياسية.</p>
                  <div className="adm-chips">
                    {ungrouped.map((key) => (
                      <span className="adm-chip" key={key}>
                        <span>{permissionLabel(key)}</span>
                        <span className="adm-cell-id" dir="ltr">
                          {key}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </Panel>

      <Panel title="الأعضاء اللي يشغلون الدور" sub={`${role._count.userRoles} عضو`}>
        {shownMembers.length === 0 ? (
          <EmptyState
            title="مفيش أعضاء يشغلون الدور"
            hint="محدش ماسك الدور ده دلوقتي. تقدر تضيف الدور للأعضاء من صفحة كل عضو."
          />
        ) : (
          <div className="adm-chips">
            {shownMembers.map((member) => (
              <span className="adm-chip" key={member.id}>
                <Link href={`/admin/users/${member.user.id}`} className="adm-cell-title">
                  {member.user.name}
                </Link>
                <bdi>{member.user.email}</bdi>
                {member.user.isActive ? "" : <span className="adm-cell-sub">موقوف</span>}
              </span>
            ))}
          </div>
        )}
        {extraMembers > 0 ? (
          <p className="adm-hint">وفيه {extraMembers} عضو تاني يشغل الدور، مش ظاهرين في الصفحة دي.</p>
        ) : null}
      </Panel>

      <Panel title="تعديل بيانات الدور" sub="الاسم والوصف والحالة">
        <PermissionGate permissions={admin.permissions} required="roles.manage" action="تعديل بيانات الدور">
          <RolePatchForm
            id={role.id}
            name={role.name}
            description={role.description}
            isActive={role.isActive}
          />
        </PermissionGate>
      </Panel>

      <Panel title="إضافة وسحب الصلاحيات" sub="الصلاحية بتشتغل بس لما تكون في دور يملكه عضو">
        <PermissionGate permissions={admin.permissions} required="roles.manage" action="منح وسحب صلاحيات الدور">
          <RoleGrantsManager
            roleId={role.id}
            granted={grantedKeys}
            allPermissions={permissions.map((permission) => ({
              id: permission.id,
              key: permission.key,
              description: permission.description,
            }))}
          />
        </PermissionGate>
      </Panel>

      <Panel title="حذف الدور" sub="الحذف نهائي ومش بيرجع">
        <PermissionGate permissions={admin.permissions} required="roles.manage" action="حذف الدور">
          <RoleDeleteButton id={role.id} memberCount={role._count.userRoles} roleName={displayName} />
        </PermissionGate>
        <Note tone="warn">
          حذف الدور بيشيل الصلاحيات من كل عضو يشغل الدور، وأعضاء الفريق مش هيبقوا عندهم أي صلاحية من
          صلاحياته. لو فيه أعضاء يشغلون الدور، الخادم هيرفض الحذف لحد ما تشيلهم من الدور.
        </Note>
      </Panel>
    </>
  );
}
