// FE-10F customers list (server): phone/name search + first keyset page.
// Reads: customers.view. No row counts (no verified source).

import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/rbac";
import { listCustomers } from "@/lib/customers/queries";
import { EmptyState, ErrorState } from "@/components/ui/states";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "العملاء — الإدارة",
  robots: { index: false, follow: false },
};

export default async function AdminCustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; cursor?: string }>;
}) {
  await requirePermission("customers.view");
  const sp = await searchParams;
  const search = typeof sp.search === "string" && sp.search.trim() !== "" ? sp.search.trim().slice(0, 80) : null;
  const cursor = typeof sp.cursor === "string" && sp.cursor !== "" ? sp.cursor : null;
  let rows: Awaited<ReturnType<typeof listCustomers>> | null = null;
  let next: string | null = null;
  try {
    const found = await listCustomers({ limit: 20, cursor, search, registered: null, active: null });
    next = found.length > 20 ? found[20].id : null;
    rows = found.slice(0, 20);
  } catch {
    rows = null;
  }
  return (
    <main className="grid gap-4">
      <h1 className="text-xl font-bold">العملاء</h1>
      <form method="get" action="/admin/customers" className="flex gap-2">
        <label className="sr-only" htmlFor="cust-search">بحث العملاء</label>
        <input id="cust-search" name="search" defaultValue={search ?? ""} maxLength={80} placeholder="هاتف أو اسم…" className="min-h-[44px] flex-1 rounded-control border border-line bg-white px-3" />
        <button type="submit" className="min-h-[44px] rounded-control bg-brand px-5 font-semibold text-white">
          بحث
        </button>
      </form>
      {rows === null ? (
        <ErrorState title="تعذّر التحميل" text="حاول مجددًا." />
      ) : rows.length === 0 ? (
        <EmptyState title="لا يوجد عملاء مطابقون" hint="جرّب بحثًا مختلفًا." />
      ) : (
        <ul className="grid gap-2">
          {rows.map((c) => (
            <li key={c.id} className="rounded-card border border-line bg-white p-3 text-sm">
              <Link href={`/admin/customers/${c.id}`} className="font-bold text-brand">
                {c.firstName} — <bdi>{c.phone}</bdi>
              </Link>
              <p className="text-secondary">{c.isRegistered ? "مسجل" : "ضيف"} · {c.isActive ? "نشط" : "موقوف"}</p>
            </li>
          ))}
        </ul>
      )}
      {next ? (
        <p>
          <Link
            href={`/admin/customers?${new URLSearchParams({ ...(search ? { search } : {}), cursor: next }).toString()}`}
            className="font-semibold text-brand"
          >
            الصفحة التالية
          </Link>
        </p>
      ) : null}
    </main>
  );
}
