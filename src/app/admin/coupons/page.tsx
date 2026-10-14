// FE-10C coupons list (server) + create island.
// Reads: coupons.view. Writes: coupons.create (promotionId + code + limits/windows).

import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/rbac";
import { listCoupons } from "@/lib/promotions/queries";
import { toCoupon } from "@/lib/promotions/serialize";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { CouponCreateForm } from "@/components/admin/coupon-forms";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "الكوبونات — الإدارة",
  robots: { index: false, follow: false },
};

export default async function AdminCouponsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; cursor?: string }>;
}) {
  await requirePermission("coupons.view");
  const sp = await searchParams;
  const search = typeof sp.search === "string" && sp.search.trim() !== "" ? sp.search.trim().slice(0, 64) : null;
  const cursor = typeof sp.cursor === "string" && sp.cursor !== "" ? sp.cursor : null;
  let rows: ReturnType<typeof toCoupon>[] | null = null;
  let next: string | null = null;
  try {
    const found = await listCoupons({ limit: 20, cursor, search, active: null });
    next = found.length > 20 ? found[20].id : null;
    rows = found.slice(0, 20).map(toCoupon);
  } catch {
    rows = null;
  }
  return (
    <main className="grid gap-4">
      <h1 className="text-xl font-bold">الكوبونات</h1>
      <form method="get" action="/admin/coupons" className="flex gap-2">
        <label className="sr-only" htmlFor="coupon-search">بحث الكوبونات</label>
        <input id="coupon-search" name="search" defaultValue={search ?? ""} maxLength={64} placeholder="بحث بالكود…" className="min-h-[44px] flex-1 rounded-control border border-line bg-white px-3" />
        <button type="submit" className="min-h-[44px] rounded-control bg-brand px-5 font-semibold text-white">
          بحث
        </button>
      </form>
      {rows === null ? (
        <ErrorState title="تعذّر التحميل" text="حاول مجددًا." />
      ) : rows.length === 0 ? (
        <EmptyState title="لا توجد كوبونات مطابقة" hint="أنشئ كوبونًا أدناه." />
      ) : (
        <ul className="grid gap-2">
          {rows.map((c) => (
            <li key={c.id} className="rounded-card border border-line bg-white p-3 text-sm">
              <Link href={`/admin/coupons/${c.id}`} className="font-bold text-brand">
                <bdi>{c.code}</bdi>
              </Link>
              <p className="text-secondary">
                مستخدم {c.usedCount}{c.usageLimit !== null ? ` من ${c.usageLimit}` : ""} ·{" "}
                {c.isActive ? "نشط" : "موقوف"}
              </p>
            </li>
          ))}
        </ul>
      )}
      {next ? (
        <p>
          <Link
            href={`/admin/coupons?${new URLSearchParams({ ...(search ? { search } : {}), cursor: next }).toString()}`}
            className="font-semibold text-brand"
          >
            الصفحة التالية
          </Link>
        </p>
      ) : null}
      <section aria-label="إنشاء كوبون" className="rounded-card border border-line bg-white p-4">
        <h2 className="font-bold">كوبون جديد (يرتبط بعرض موجود)</h2>
        <div className="mt-2">
          <CouponCreateForm />
        </div>
      </section>
    </main>
  );
}
