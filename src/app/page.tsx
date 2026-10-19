// FE-2 storefront homepage (server): live reads via src/lib/frontend/storefront-reads.
// Fresh data per request (force-dynamic); each section fails independently into honest
// empty/error states — one source failing never blanks the page. No offers feed exists,
// so the Offers section is omitted by contract (FP03-C2), never faked.
// VXP pass: composed hero, icon-led category tiles, banded product section, restrained
// scroll-reveal (Reveal wrapper) — data paths and contracts unchanged.

import type { Metadata } from "next";
import Link from "next/link";
import { StoreShell } from "@/components/store/store-shell";
import { ProductCard } from "@/components/store/product-card";
import { HomeHero } from "@/components/store/home-hero";
import { CategoriesContent } from "@/components/store/home-categories";
import { Reveal } from "@/components/store/reveal";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SectionTitle } from "@/components/ui/container";
import { ArrowLeft } from "lucide-react";
import { getFeaturedProducts, type HomeProductCard } from "@/lib/frontend/storefront-reads";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "الرئيسية",
  description: "احتياجات بيتك بسهولة ووضوح، وثقة في كل خطوة.",
};

function HeadingRow({ id, title, hint }: { id: string; title: string; hint?: string }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <SectionTitle>
          <span id={id}>{title}</span>
        </SectionTitle>
        {hint ? <p className="mt-1 text-sm text-secondary">{hint}</p> : null}
      </div>
    </div>
  );
}

async function CategoriesSection() {
  let body: Awaited<ReturnType<typeof CategoriesContent>> = null;
  let failed = false;
  try {
    body = await CategoriesContent();
  } catch {
    failed = true;
  }
  return (
    <section aria-labelledby="home-categories" className="mt-10" >
      <HeadingRow id="home-categories" title="الأقسام" />
      {failed || body === null ? (
        <div className="mt-3">
          {failed ? (
            <ErrorState title="تعذّر تحميل الأقسام" text="حاول إعادة تحميل الصفحة." />
          ) : (
            <EmptyState title="لا توجد أقسام حاليًا" hint="عُد لاحقًا لتصفح أقسام المتجر." />
          )}
        </div>
      ) : (
        <div className="mt-4">
          <Reveal>{body}</Reveal>
          <p className="mt-5 flex justify-start text-sm">
            <Link
              href="/categories"
              className="inline-flex items-center gap-1.5 font-semibold text-brand transition-colors duration-200 hover:text-[color:var(--ink-purple-deep)]"
            >
              تصفح كل الأقسام
              <ArrowLeft size={16} aria-hidden="true" />
            </Link>
          </p>
        </div>
      )}
    </section>
  );
}

async function FeaturedSection() {
  let products: HomeProductCard[] | null = null;
  let failed = false;
  try {
    // bounded read (FEATURED_LIMIT) — no fetch-all behavior
    products = await getFeaturedProducts();
  } catch {
    failed = true;
  }
  return (
    <section
      aria-labelledby="home-featured"
      className="-mx-4 mt-10 border-y border-line bg-[color:var(--surface-subtle)] px-4 py-10 md:-mx-6 md:px-6"
    >
      <HeadingRow id="home-featured" title="منتجات من المتجر" hint="مختارات حديثة من الكتالوج — بلا ادعاء أكثر مبيعًا." />
      {failed || products === null ? (
        <div className="mt-3">
          <ErrorState title="تعذّر تحميل المنتجات" text="حاول إعادة تحميل الصفحة." />
        </div>
      ) : products.length === 0 ? (
        <div className="mt-3">
          <EmptyState title="لا توجد منتجات حاليًا" hint="عُد لاحقًا لتصفح المنتجات." />
        </div>
      ) : (
        <Reveal className="mt-4">
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {products.map((p) => (
              <li key={p.id} className="min-w-0">
                <ProductCard product={p} />
              </li>
            ))}
          </ul>
        </Reveal>
      )}
    </section>
  );
}

export default function HomePage() {
  return (
    <StoreShell>
      <div id="categories">
        <HomeHero />
        <CategoriesSection />
      </div>
      <FeaturedSection />
      <p className="mt-8 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-sm text-secondary">
        <span>لا تجد ما تبحث عنه؟</span>
        <Link href="/search" className="font-semibold text-brand transition-colors duration-200 hover:text-[color:var(--ink-purple-deep)]">
          ابحث في المتجر
        </Link>
        <span aria-hidden="true">·</span>
        <Link href="/brands" className="font-semibold text-brand transition-colors duration-200 hover:text-[color:var(--ink-purple-deep)]">
          العلامات التجارية
        </Link>
      </p>
    </StoreShell>
  );
}
