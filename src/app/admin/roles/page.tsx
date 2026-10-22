// FE-10F roles list (server) + create form link.
// Reads: roles.view. Writes: roles.manage (create).

import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/rbac";
import { listRoles } from "@/lib/admin/queries";
import { toRole } from "@/lib/admin/serialize";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { PermissionGate } from "@/components/admin/permission-gate";
import { RoleCreateForm } from "@/components/admin/role-forms";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "الأدوار — الإدارة",
  robots: { index: false, follow: false },
};

export default async function AdminRolesPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; cursor?: string }>;
}) {
  const admin = await requirePermission("roles.view");
  const sp = await searchParams;
  const search = typeof sp.search === "string" && sp.search.trim() !== "" ? sp.search.trim().slice(0, 60) : null;
  const cursor = typeof sp.cursor === "string" && sp.cursor !== "" ? sp.cursor : null;
  let rows: ReturnType<typeof toRole>[] | null = null;
  let next: string | null = null;
  try {
    const found = await listRoles({ limit: 20, cursor, search, active: null });
    next = found.length > 20 ? found[20].id : null;
    rows = found.slice(0, 20).map(toRole);
  } catch {
    rows = null;
  }
  return (
    <main className="grid gap-4">
      <h1 className="text-xl font-bold">الأدوار</h1>
      <form method="get" action="/admin/roles" className="flex gap-2">
        <label className="sr-only" htmlFor="role-search">بحث الأدوار</label>
        <input id="role-search" name="search" defaultValue={search ?? ""} maxLength={60} placeholder="اسم الدور…" className="min-h-[44px] flex-1 rounded-control border border-line bg-white px-3" />
        <button type="submit" className="min-h-[44px] rounded-control bg-brand px-5 font-semibold text-white">
          بحث
        </button>
      </form>
      {rows === null ? (
        <ErrorState title="تعذّر التحميل" text="حاول مجددًا." />
      ) : rows.length === 0 ? (
        <EmptyState title="لا توجد أدوار مطابقة" hint="جرّب بحثًا مختلفًا." />
      ) : (
        <ul className="grid gap-2">
          {rows.map((r) => (
            <li key={r.id} className="rounded-card border border-line bg-white p-3 text-sm">
              <Link href={`/admin/roles/${r.id}`} className="font-bold text-brand">
                {r.name}
              </Link>
              <p className="text-secondary">{r.isActive ? "نشط" : "موقوف"}</p>
            </li>
          ))}
        </ul>
      )}
      {next ? (
        <p>
          <Link
            href={`/admin/roles?${new URLSearchParams({ ...(search ? { search } : {}), cursor: next }).toString()}`}
            className="font-semibold text-brand"
          >
            الصفحة التالية
          </Link>
        </p>
      ) : null}
      <section aria-label="إنشاء دور" className="rounded-card border border-line bg-white p-4">
        <h2 className="font-bold">دور جديد (roles.manage)</h2>
        <div className="mt-2">
          <PermissionGate permissions={admin.permissions} required="roles.manage" action="إنشاء الأدوار">
            <RoleCreateForm />
          </PermissionGate>
        </div>
      </section>
    </main>
  );
}
