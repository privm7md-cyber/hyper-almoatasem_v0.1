// FE-2 storefront homepage (server): live reads via src/lib/frontend/storefront-reads.
// Fresh data per request (force-dynamic); each section fails independently into honest
// empty/error states — one source failing never blanks the page. No offers feed exists,
// so the Offers section is omitted by contract (FP03-C2), never faked.

import type { Metadata } from "next";
import Link from "next/link";
import { StoreShell } from "@/components/store/store-shell";
import { ProductCard } from "@/components/store/product-card";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SectionTitle } from "@/components/ui/container";
import {
  getFeaturedProducts,
  getHomeCategories,
  type HomeProductCard,
} from "@/lib/frontend/storefront-reads";
import type { CategoryShape } from "@/lib/catalog/serialize";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "الرئيسية",
  description: "احتياجات بيتك بسهولة ووضوح، وثقة في كل خطوة.",
};

async function CategoriesSection() {
  let categories: CategoryShape[] | null = null;
  let failed = false;
  try {
    categories = await getHomeCategories();
  } catch {
    failed = true;
  }
  return (
    <section aria-labelledby="home-categories" className="mt-8">
      <SectionTitle>
        <span id="home-categories">الأقسام</span>
      </SectionTitle>
      {failed || categories === null ? (
        <div className="mt-3">
          <ErrorState title="تعذّر تحميل الأقسام" text="حاول إعادة تحميل الصفحة." />
        </div>
      ) : categories.length === 0 ? (
        <div className="mt-3">
          <EmptyState title="لا توجد أقسام حاليًا" hint="عُد لاحقًا لتصفح أقسام المتجر." />
        </div>
      ) : (
        <ul className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          {categories.map((c) => (
            <li
              key={c.id}
              className="rounded-card border border-line bg-white p-4 text-center font-bold"
            >
              <Link
                href={`/c/${c.id}/${encodeURIComponent(c.slug)}`}
                className="text-brand"
                aria-label={`قسم ${c.name}`}
              >
                {c.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

async function FeaturedSection() {
  let products: HomeProductCard[] | null = null;
  let failed = false;
  try {
    products = await getFeaturedProducts();
  } catch {
    failed = true;
  }
  return (
    <section aria-labelledby="home-featured" className="mt-8">
      <SectionTitle>
        <span id="home-featured">منتجات من المتجر</span>
      </SectionTitle>
      <p className="mt-1 text-sm text-secondary">مختارات حديثة من الكتالوج — بلا ادعاء أكثر مبيعًا.</p>
      {failed || products === null ? (
        <div className="mt-3">
          <ErrorState title="تعذّر تحميل المنتجات" text="حاول إعادة تحميل الصفحة." />
        </div>
      ) : products.length === 0 ? (
        <div className="mt-3">
          <EmptyState title="لا توجد منتجات حاليًا" hint="عُد لاحقًا لتصفح المنتجات." />
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
    </section>
  );
}

export default function HomePage() {
  return (
    <StoreShell>
      <section aria-labelledby="home-hero" className="mt-6 rounded-card bg-purple-surface p-6 md:p-10">
        <h1 id="home-hero" className="text-2xl font-extrabold md:text-3xl">
          احتياجات بيتك بسهولة ووضوح
        </h1>
        <p className="mt-2 text-secondary">وثقة في كل خطوة.</p>
      </section>
      <div id="categories">
        <CategoriesSection />
      </div>
      <FeaturedSection />
      <p className="mt-6 text-sm">
        <Link href="/categories" className="font-semibold text-brand">
          تصفح كل الأقسام
        </Link>
        {" · "}
        <Link href="/brands" className="font-semibold text-brand">
          العلامات التجارية
        </Link>
      </p>
    </StoreShell>
  );
}
