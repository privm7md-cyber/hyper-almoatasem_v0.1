// FE-10F users list (evolved in place: kept list, added create + detail links).
// Reads: users.view. Writes: users.manage (create).

import Link from "next/link";import { requirePermission } from "@/lib/auth/rbac";
import { listUsers } from "@/lib/admin/queries";
import { toAdminUser } from "@/lib/admin/serialize";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { PermissionGate } from "@/components/admin/permission-gate";
import { UserCreateForm } from "@/components/admin/user-forms";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "المستخدمون — هايبر المعتصم",
  robots: { index: false, follow: false },
};

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; cursor?: string }>;
}) {
  const admin = await requirePermission("users.view");
  const sp = await searchParams;
  const search = typeof sp.search === "string" && sp.search.trim() !== "" ? sp.search.trim().slice(0, 160) : null;
  const cursor = typeof sp.cursor === "string" && sp.cursor !== "" ? sp.cursor : null;
  let rows: ReturnType<typeof toAdminUser>[] | null = null;
  let next: string | null = null;
  try {
    const found = await listUsers({ limit: 20, cursor, search, active: null });
    next = found.length > 20 ? found[20].id : null;
    rows = found.slice(0, 20).map(toAdminUser);
  } catch {
    rows = null;
  }
  return (
    <main className="grid gap-4">
      <h1 className="text-xl font-bold">المستخدمون</h1>
      <form method="get" action="/admin/users" className="flex gap-2">
        <label className="sr-only" htmlFor="user-search">بحث المستخدمين</label>
        <input id="user-search" name="search" defaultValue={search ?? ""} maxLength={160} placeholder="اسم أو بريد…" className="min-h-[44px] flex-1 rounded-control border border-line bg-white px-3" />
        <button type="submit" className="min-h-[44px] rounded-control bg-brand px-5 font-semibold text-white">
          بحث
        </button>
      </form>
      {rows === null ? (
        <ErrorState title="تعذّر التحميل" text="حاول مجددًا." />
      ) : rows.length === 0 ? (
        <EmptyState title="لا يوجد مستخدمون مطابقون" hint="جرّب بحثًا مختلفًا." />
      ) : (
        <ul className="grid gap-2">
          {rows.map((u) => (
            <li key={u.id} className="rounded-card border border-line bg-white p-3 text-sm">
              <Link href={`/admin/users/${u.id}`} className="font-bold text-brand">
                {u.name} — <bdi>{u.email}</bdi>
              </Link>
              <p className="text-secondary">
                {u.roles.join("، ") || "بلا أدوار"} · {u.isActive ? "نشط" : "موقوف"}
              </p>
            </li>
          ))}
        </ul>
      )}
      {next ? (
        <p>
          <Link
            href={`/admin/users?${new URLSearchParams({ ...(search ? { search } : {}), cursor: next }).toString()}`}
            className="font-semibold text-brand"
          >
            الصفحة التالية
          </Link>
        </p>
      ) : null}
      <section aria-label="إنشاء مستخدم" className="rounded-card border border-line bg-white p-4">
        <h2 className="font-bold">مستخدم جديد (users.manage)</h2>
        <div className="mt-2">
          <PermissionGate permissions={admin.permissions} required="users.manage" action="إنشاء المستخدمين">
            <UserCreateForm />
          </PermissionGate>
        </div>
      </section>
    </main>
  );
}
