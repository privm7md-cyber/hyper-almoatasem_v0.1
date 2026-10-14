// FE-10F role detail (server): profile + grants matrix + members.
// Reads: roles.view (+ roles.manage-gated writes via islands). Members list is
// read-only observability; separation happens on user detail pages.

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/rbac";
import { getRole, listPermissions, listRoleMembers } from "@/lib/admin/queries";
import { toRole } from "@/lib/admin/serialize";
import { AdminSection } from "@/components/admin/admin-table";
import { RolePatchForm, RoleDeleteButton, RoleGrantsManager } from "@/components/admin/role-forms";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "تفاصيل الدور — الإدارة",
  robots: { index: false, follow: false },
};

export default async function AdminRoleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("roles.view");
  const { id } = await params;
  const row = await getRole(id).catch(() => null);
  if (!row) notFound();
  const role = toRole(row);
  const granted = role.permissions ?? [];
  const perms = await listPermissions({ limit: 200, cursor: null, search: null }).catch(() => []);
  const members = await listRoleMembers(id, { limit: 20, cursor: null }).catch(() => []);

  return (
    <main className="grid gap-4">
      <h1 className="text-xl font-bold">{role.name}</h1>
      <p className="text-sm text-secondary">
        {role.isActive ? "نشط" : "موقوف"} · {row._count.userRoles} عضوًا (لقطة قراءة فقط)
      </p>
      <AdminSection title="البيانات (roles.manage)">
        <RolePatchForm id={role.id} name={role.name} description={role.description} isActive={role.isActive} />
      </AdminSection>
      <AdminSection title="الصلاحيات (roles.manage)">
        <RoleGrantsManager
          roleId={role.id}
          granted={granted}
          allPermissions={perms.map((p) => ({ id: p.id, key: p.key, description: p.description }))}
        />
      </AdminSection>
      <AdminSection title="الأعضاء">
        {members.length === 0 ? (
          <p className="text-sm text-secondary">لا يوجد أعضاء.</p>
        ) : (
          <ul className="grid gap-2">
            {members.map((m) => (
              <li key={m.id} className="rounded-card border border-line bg-white p-3 text-sm">
                <Link href={`/admin/users/${m.user.id}`} className="font-bold text-brand">
                  {m.user.name} — <bdi>{m.user.email}</bdi>
                </Link>
                <p className="text-secondary">{m.user.isActive ? "نشط" : "موقوف"}</p>
              </li>
            ))}
          </ul>
        )}
      </AdminSection>
      <AdminSection title="الحذف (roles.manage)">
        <RoleDeleteButton id={role.id} memberCount={row._count.userRoles} />
      </AdminSection>
    </main>
  );
}
