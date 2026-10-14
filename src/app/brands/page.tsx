// FE-3 brands index (server): brand directory from the verified brand entity
// (FP-09 D08). Logos render only from non-null metadata URLs; otherwise neutral tile.

import type { Metadata } from "next";
import Link from "next/link";
import { StoreShell } from "@/components/store/store-shell";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { PageTitle } from "@/components/ui/container";
import { getAllBrands } from "@/lib/frontend/storefront-reads";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
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
      <div className="mt-6">
        <PageTitle>العلامات التجارية</PageTitle>
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
        <ul className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {brands.map((b) => (
            <li key={b.id} className="rounded-card border border-line bg-white p-4 text-center">
              <Link
                href={`/brand/${b.id}/${encodeURIComponent(b.slug)}`}
                className="font-bold text-brand"
                aria-label={`منتجات ${b.name}`}
              >
                {b.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </StoreShell>
  );
}
