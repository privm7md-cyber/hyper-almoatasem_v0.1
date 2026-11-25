// FE-3 categories index (server): the REAL category structure — every active
// main category with its subcategories, from the backend tree
// (`getHomeCategorySections`), never a flat list and never a hand-made tree.
// No product counts (no verified count source — contract rule).

import type { Metadata } from "next";
import { canonicalMetadata } from "@/lib/seo/canonical";
import Link from "next/link";
import { StoreShell } from "@/components/store/store-shell";
import { iconFor } from "@/components/store/home-categories";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { PageTitle } from "@/components/ui/container";
import { ArrowLeft } from "lucide-react";
import { getHomeCategorySections } from "@/lib/frontend/storefront-reads";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  ...canonicalMetadata("/categories"),
  title: "الأقسام",
  description: "تصفح أقسام هايبر المعتصم.",
};

export default async function CategoriesPage() {
  let sections: Awaited<ReturnType<typeof getHomeCategorySections>> | null = null;
  try {
    sections = await getHomeCategorySections();
  } catch {
    sections = null;
  }
  const childrenByParent = new Map(
    (sections?.subs ?? []).map((s) => [s.parent.id, s.children] as const),
  );
  return (
    <StoreShell>
      <div className="mt-6 rounded-card border border-line bg-white p-5 shadow-xs">
        <PageTitle>الأقسام</PageTitle>
        <p className="mt-1 text-sm text-secondary">اختر القسم الرئيسي أو انتقل مباشرة إلى أحد أقسامه الفرعية.</p>
      </div>
      {sections === null ? (
        <div className="mt-4">
          <ErrorState title="تعذّر تحميل الأقسام" text="حاول إعادة تحميل الصفحة." />
        </div>
      ) : sections.mains.length === 0 ? (
        <div className="mt-4">
          <EmptyState title="لا توجد أقسام حاليًا" hint="عُد لاحقًا." />
        </div>
      ) : (
        <ul className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sections.mains.map((m) => {
            const children = childrenByParent.get(m.id) ?? [];
            const Icon = iconFor(m.name);
            return (
              <li
                key={m.id}
                className="flex flex-col justify-between rounded-card border border-line bg-white p-5 shadow-xs transition-[border-color,box-shadow] duration-200 hover:border-brand/50 hover:shadow-sm"
              >
                <div>
                  <Link
                    href={`/c/${m.id}/${encodeURIComponent(m.slug)}`}
                    prefetch={false}
                    className="group flex min-h-[44px] items-center justify-between gap-3 font-bold text-ink hover:text-brand"
                    aria-label={`قسم ${m.name}`}
                  >
                    <span className="flex items-center gap-3">
                      <span
                        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-card bg-purple-surface text-brand transition-colors duration-200 group-hover:bg-brand group-hover:text-white"
                        aria-hidden="true"
                      >
                        <Icon size={20} />
                      </span>
                      <span className="text-base">{m.name}</span>
                    </span>
                    <ArrowLeft
                      size={16}
                      aria-hidden="true"
                      className="shrink-0 text-secondary transition-transform duration-200 group-hover:-translate-x-0.5 group-hover:text-brand"
                    />
                  </Link>
                  {children.length > 0 ? (
                    <ul className="mt-4 flex flex-wrap gap-2 border-t border-line/70 pt-3.5">
                      {children.map((c) => (
                        <li key={c.id}>
                          <Link
                            href={`/c/${c.id}/${encodeURIComponent(c.slug)}`}
                            prefetch={false}
                            className="inline-flex min-h-[38px] items-center rounded-badge border border-line/80 bg-purple-surface/65 px-3 text-xs font-medium text-ink transition-colors duration-150 hover:border-brand hover:bg-purple-surface hover:text-brand sm:text-sm"
                            aria-label={`قسم فرعي ${c.name} ضمن ${m.name}`}
                          >
                            {c.name}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </StoreShell>
  );
}
