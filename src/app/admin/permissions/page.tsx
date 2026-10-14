// FE-10F permissions catalog (server, read-only): the valid grant universe.
// No writes exist by contract — attach happens on role detail pages.

import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/rbac";
import { listPermissions } from "@/lib/admin/queries";
import { toPermission } from "@/lib/admin/serialize";
import { EmptyState, ErrorState } from "@/components/ui/states";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "الصلاحيات — الإدارة",
  robots: { index: false, follow: false },
};

export default async function AdminPermissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; cursor?: string }>;
}) {
  await requirePermission("roles.view");
  const sp = await searchParams;
  const search = typeof sp.search === "string" && sp.search.trim() !== "" ? sp.search.trim().slice(0, 120) : null;
  const cursor = typeof sp.cursor === "string" && sp.cursor !== "" ? sp.cursor : null;
  let rows: ReturnType<typeof toPermission>[] | null = null;
  let next: string | null = null;
  try {
    const found = await listPermissions({ limit: 50, cursor, search });
    next = found.length > 50 ? found[50].id : null;
    rows = found.slice(0, 50).map(toPermission);
  } catch {
    rows = null;
  }
  return (
    <main className="grid gap-4">
      <h1 className="text-xl font-bold">الصلاحيات</h1>
      <p className="text-sm text-secondary">كتالوج القراءة فقط للصلاحيات القابلة للمنح — لا توجد عمليات كتابة.</p>
      <form method="get" action="/admin/permissions" className="flex gap-2">
        <label className="sr-only" htmlFor="perm-search">بحث الصلاحيات</label>
        <input id="perm-search" name="search" defaultValue={search ?? ""} maxLength={120} placeholder="users.view…" dir="ltr" className="min-h-[44px] flex-1 rounded-control border border-line bg-white px-3" />
        <button type="submit" className="min-h-[44px] rounded-control bg-brand px-5 font-semibold text-white">
          بحث
        </button>
      </form>
      {rows === null ? (
        <ErrorState title="تعذّر التحميل" text="حاول مجددًا." />
      ) : rows.length === 0 ? (
        <EmptyState title="لا توجد صلاحيات مطابقة" hint="جرّب بحثًا مختلفًا." />
      ) : (
        <ul className="grid gap-2">
          {rows.map((p) => (
            <li key={p.id} className="rounded-card border border-line bg-white p-3 text-sm">
              <p dir="ltr" className="font-mono font-bold">{p.key}</p>
              {p.description ? <p className="text-secondary">{p.description}</p> : null}
            </li>
          ))}
        </ul>
      )}
      {next ? (
        <p>
          <Link
            href={`/admin/permissions?${new URLSearchParams({ ...(search ? { search } : {}), cursor: next }).toString()}`}
            className="font-semibold text-brand"
          >
            الصفحة التالية
          </Link>
        </p>
      ) : null}
    </main>
  );
}
