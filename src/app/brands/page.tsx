// FE-3 brands index (server): brand directory from the verified brand entity
// (FP-09 D08). Logos render only from non-null metadata URLs; otherwise neutral tile.

import type { Metadata } from "next";
import { canonicalMetadata } from "@/lib/seo/canonical";
import Link from "next/link";
import { StoreShell } from "@/components/store/store-shell";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { PageTitle } from "@/components/ui/container";
import { Tag } from "lucide-react";
import { getAllBrands } from "@/lib/frontend/storefront-reads";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  ...canonicalMetadata("/brands"),
  title: "العلامات التجارية",
  description: "تصفح العلامات التجارية في هايبر المعتصم.",
};

export default async function BrandsPage() {
  let brands: Awaited<ReturnType<typeof getAllBrands>> | null = null;
  try {
    brands = await getAllBrands();
  } catch {
    brands = null;
  }
  return (
    <StoreShell>
      <div className="mt-6 rounded-card border border-line bg-white p-5 shadow-xs">
        <PageTitle>العلامات التجارية</PageTitle>
        <p className="mt-1 text-sm text-secondary">تصفّح المنتجات حسب العلامة التجارية المعتمدة في المتجر.</p>
      </div>
      {brands === null ? (
        <div className="mt-4">
          <ErrorState title="تعذّر تحميل العلامات" text="حاول إعادة تحميل الصفحة." />
        </div>
      ) : brands.length === 0 ? (
        <div className="mt-4">
          <EmptyState title="لا توجد علامات حاليًا" hint="عُد لاحقًا." />
        </div>
      ) : (
        <ul className="mt-5 grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4">
          {brands.map((b) => (
            <li key={b.id}>
              <Link
                href={`/brand/${b.id}/${encodeURIComponent(b.slug)}`}
                className="group flex min-h-[76px] flex-col items-center justify-center gap-2 rounded-card border border-line bg-white p-4 text-center font-bold text-ink shadow-xs transition-[border-color,box-shadow,color] duration-150 hover:border-brand/60 hover:text-brand hover:shadow-sm"
                aria-label={`منتجات ${b.name}`}
              >
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-purple-surface text-brand transition-colors duration-150 group-hover:bg-brand group-hover:text-white" aria-hidden="true">
                  <Tag size={15} />
                </span>
                <span>{b.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </StoreShell>
  );
}
