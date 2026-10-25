// FE-3 categories index (server): the REAL category structure — every active
// main category with its subcategories, from the backend tree
// (`getHomeCategorySections`), never a flat list and never a hand-made tree.
// No product counts (no verified count source — contract rule).

import type { Metadata } from "next";
import Link from "next/link";
import { StoreShell } from "@/components/store/store-shell";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { PageTitle } from "@/components/ui/container";
import { getHomeCategorySections } from "@/lib/frontend/storefront-reads";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
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
      <div className="mt-6">
        <PageTitle>الأقسام</PageTitle>
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
        <ul className="mt-4 grid gap-3">
          {sections.mains.map((m) => {
            const children = childrenByParent.get(m.id) ?? [];
            return (
              <li key={m.id} className="rounded-card border border-line bg-white p-4">
                <Link
                  href={`/c/${m.id}/${encodeURIComponent(m.slug)}`}
                  className="font-bold text-brand hover:text-[color:var(--ink-purple-deep)]"
                  aria-label={`قسم ${m.name}`}
                >
                  {m.name}
                </Link>
                {children.length > 0 ? (
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {children.map((c) => (
                      <li key={c.id}>
                        <Link
                          href={`/c/${c.id}/${encodeURIComponent(c.slug)}`}
                          className="inline-flex min-h-[36px] items-center rounded-badge bg-purple-surface px-3 text-sm text-secondary hover:text-brand"
                          aria-label={`قسم فرعي ${c.name} ضمن ${m.name}`}
                        >
                          {c.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </StoreShell>
  );
}
