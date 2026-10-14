// FE-3 categories index (server): all active categories as tiles → /c/[id]/[slug].
// No product counts (no verified count source — contract rule).

import type { Metadata } from "next";
import Link from "next/link";
import { StoreShell } from "@/components/store/store-shell";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { PageTitle } from "@/components/ui/container";
import { getAllCategories } from "@/lib/frontend/storefront-reads";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "الأقسام",
  description: "تصفح أقسام هايبر المعتصم.",
};

export default async function CategoriesPage() {
  let categories: Awaited<ReturnType<typeof getAllCategories>> | null = null;
  try {
    categories = await getAllCategories();
  } catch {
    categories = null;
  }
  return (
    <StoreShell>
      <div className="mt-6">
        <PageTitle>الأقسام</PageTitle>
      </div>
      {categories === null ? (
        <div className="mt-4">
          <ErrorState title="تعذّر تحميل الأقسام" text="حاول إعادة تحميل الصفحة." />
        </div>
      ) : categories.length === 0 ? (
        <div className="mt-4">
          <EmptyState title="لا توجد أقسام حاليًا" hint="عُد لاحقًا." />
        </div>
      ) : (
        <ul className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {categories.map((c) => (
            <li key={c.id} className="rounded-card border border-line bg-white p-4 text-center">
              <Link
                href={`/c/${c.id}/${encodeURIComponent(c.slug)}`}
                className="font-bold text-brand"
                aria-label={`قسم ${c.name}`}
              >
                {c.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </StoreShell>
  );
}
