// FE-10C promotions list (server) + basic create island (DRAFT-first flow).
// Reads: promotions.view. Writes: promotions.create/update + status flips.

import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/rbac";
import { listPromotions } from "@/lib/promotions/queries";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { PromotionCreateForm } from "@/components/admin/promotion-forms";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "العروض — الإدارة",
  robots: { index: false, follow: false },
};

export default async function AdminPromotionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; search?: string; cursor?: string }>;
}) {
  await requirePermission("promotions.view");
  const sp = await searchParams;
  const status = typeof sp.status === "string" && ["DRAFT", "ACTIVE", "DISABLED"].includes(sp.status) ? sp.status : null;
  const search = typeof sp.search === "string" && sp.search.trim() !== "" ? sp.search.trim().slice(0, 160) : null;
  const cursor = typeof sp.cursor === "string" && sp.cursor !== "" ? sp.cursor : null;
  let rows: Awaited<ReturnType<typeof listPromotions>> | null = null;
  let next: string | null = null;
  try {
    const found = await listPromotions({ limit: 20, cursor, status, type: null, scope: null, search });
    next = found.length > 20 ? found[20].id : null;
    rows = found.slice(0, 20);
  } catch {
    rows = null;
  }
  return (
    <main className="grid gap-4">
      <h1 className="text-xl font-bold">العروض الترويجية</h1>
      <form method="get" action="/admin/promotions" className="flex flex-wrap gap-2">
        <label className="grid gap-1 text-sm font-semibold">
          الحالة
          <select name="status" defaultValue={status ?? ""} className="min-h-[44px] rounded-control border border-line bg-white px-2">
            <option value="">الكل</option>
            <option value="DRAFT">مسودة</option>
            <option value="ACTIVE">مفعّل</option>
            <option value="DISABLED">موقوف</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          بحث
          <input name="search" defaultValue={search ?? ""} maxLength={160} className="min-h-[44px] rounded-control border border-line bg-white px-2" />
        </label>
        <button type="submit" className="min-h-[44px] self-end rounded-control bg-brand px-5 font-semibold text-white">
          بحث
        </button>
      </form>
      {rows === null ? (
        <ErrorState title="تعذّر التحميل" text="حاول مجددًا." />
      ) : rows.length === 0 ? (
        <EmptyState title="لا توجد عروض مطابقة" hint="أنشئ عرضًا أدناه." />
      ) : (
        <ul className="grid gap-2">
          {rows.map((p) => (
            <li key={p.id} className="rounded-card border border-line bg-white p-3 text-sm">
              <Link href={`/admin/promotions/${p.id}`} className="font-bold text-brand">
                {p.name}
              </Link>
              <p className="text-secondary">
                {p.type} · {p.scope} · {p.status}
              </p>
            </li>
          ))}
        </ul>
      )}
      {next ? (
        <p>
          <Link
            href={`/admin/promotions?${new URLSearchParams({ ...(status ? { status } : {}), ...(search ? { search } : {}), cursor: next }).toString()}`}
            className="font-semibold text-brand"
          >
            الصفحة التالية
          </Link>
        </p>
      ) : null}
      <section aria-label="إنشاء عرض" className="rounded-card border border-line bg-white p-4">
        <h2 className="font-bold">عرض جديد (يُنشأ كمسودة — فعّله بعد إضافة الاستهداف)</h2>
        <div className="mt-2">
          <PromotionCreateForm />
        </div>
      </section>
    </main>
  );
}
