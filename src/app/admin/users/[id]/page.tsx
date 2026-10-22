// FE-10F user detail (server): profile + roles + credential provisioning.
// Reads: users.view. Writes: users.manage. Self/demotion guards live server-side.

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/rbac";
import { getUser, listRoles } from "@/lib/admin/queries";
import { toAdminUser } from "@/lib/admin/serialize";
import { AdminSection } from "@/components/admin/admin-table";
import { PermissionGate } from "@/components/admin/permission-gate";
import { UserPatchForm, UserPasswordForm, UserRolesManager } from "@/components/admin/user-detail-forms";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "تفاصيل المستخدم — الإدارة",
  robots: { index: false, follow: false },
};

export default async function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requirePermission("users.view");
  const { id } = await params;
  const row = await getUser(id).catch(() => null);
  if (!row) notFound();
  const user = toAdminUser(row);
  const allRoles = await listRoles({ limit: 100, cursor: null, search: null, active: null }).catch(() => []);

  return (
    <main className="grid gap-4">
      <h1 className="text-xl font-bold">{user.name}</h1>
      <p className="text-sm text-secondary">
        <bdi>{user.email}</bdi> · {user.isActive ? "نشط" : "موقوف"} · آخر دخول: {user.lastLoginAt ?? "—"}
      </p>
      <AdminSection title="البيانات (users.manage)">
        <PermissionGate permissions={admin.permissions} required="users.manage" action="تعديل بيانات المستخدم">
          <UserPatchForm id={user.id} name={user.name} email={user.email} phone={user.phone} isActive={user.isActive} />
        </PermissionGate>
      </AdminSection>
      <AdminSection title="الأدوار (roles.manage)">
        <PermissionGate permissions={admin.permissions} required="roles.manage" action="إدارة أدوار المستخدم">
          <UserRolesManager userId={user.id} assigned={user.roles} allRoles={allRoles.map((r) => ({ id: r.id, name: r.name }))} />
        </PermissionGate>
      </AdminSection>
      <AdminSection title="كلمة المرور (users.manage)">
        <PermissionGate permissions={admin.permissions} required="users.manage" action="تعيين كلمة مرور المستخدم">
          <UserPasswordForm id={user.id} />
        </PermissionGate>
      </AdminSection>
    </main>
  );
}
