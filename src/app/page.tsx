// FE-2 storefront homepage (server): live reads via src/lib/frontend/storefront-reads.
// Fresh data per request (force-dynamic); each section fails independently into honest
// empty/error states — one source failing never blanks the page. No offers feed exists,
// so the Offers section is omitted by contract (FP03-C2), never faked.
// VXP pass: composed hero, icon-led category tiles, banded product section, restrained
// scroll-reveal (Reveal wrapper) — data paths and contracts unchanged.

import { Suspense } from "react";
import type { Metadata } from "next";
import { canonicalMetadata } from "@/lib/seo/canonical";
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
  ...canonicalMetadata("/"),
  title: "الرئيسية",
  description: "احتياجات بيتك بسهولة ووضوح، وثقة في كل خطوة.",
};

function HeadingRow({ id, title, hint, actionHref, actionLabel }: { id: string; title: string; hint?: string; actionHref?: string; actionLabel?: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <SectionTitle>
          <span id={id}>{title}</span>
        </SectionTitle>
        {hint ? <p className="mt-1 text-sm text-secondary">{hint}</p> : null}
      </div>
      {actionHref && actionLabel ? (
        <Link
          href={actionHref}
          prefetch={false}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-control border border-line bg-white px-3.5 text-sm font-semibold text-brand transition-colors duration-200 hover:border-brand hover:bg-purple-surface"
        >
          {actionLabel}
          <ArrowLeft size={15} aria-hidden="true" />
        </Link>
      ) : null}
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
      <HeadingRow id="home-categories" title="أقسام الهايبر" hint="تصفّح الأقسام الرئيسية والأقسام الفرعية المنظّمة." actionHref="/categories" actionLabel="كل الأقسام" />
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
              prefetch={false}
              className="inline-flex min-h-[44px] items-center gap-1.5 font-semibold text-brand transition-colors duration-200 hover:text-[color:var(--ink-purple-deep)]"
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
      className="mt-10 rounded-card border border-line bg-[color:var(--surface-subtle)] px-4 py-8 md:px-7 md:py-10"
    >
      <HeadingRow
        id="home-featured"
        title="منتجات من المتجر"
        hint="مختارات حديثة من الكتالوج — بلا ادعاء أكثر مبيعًا."
        actionHref="/search"
        actionLabel="تصفّح الكتالوج"
      />
      {failed || products === null ? (
        <div className="mt-3">
          <ErrorState title="تعذّر تحميل المنتجات" text="حاول إعادة تحميل الصفحة." />
        </div>
      ) : products.length === 0 ? (
        <div className="mt-3">
          <EmptyState title="لا توجد منتجات حاليًا" hint="عُد لاحقًا لتصفح المنتجات." />
        </div>
      ) : (
        <Reveal className="mt-5">
          <ul className="grid grid-cols-2 gap-3.5 md:grid-cols-4 md:gap-4">
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

function CategoriesFallback() {
  return (
    <section aria-labelledby="home-categories" className="mt-10 min-h-[160px]" aria-busy="true">
      <HeadingRow id="home-categories" title="أقسام الهايبر" hint="تصفّح الأقسام الرئيسية والأقسام الفرعية المنظّمة." />
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4" aria-hidden="true">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="vxp-shimmer h-20 rounded-card bg-purple-surface" />
        ))}
      </div>
    </section>
  );
}

function FeaturedFallback() {
  return (
    <section
      aria-labelledby="home-featured"
      className="mt-10 min-h-[300px] rounded-card border border-line bg-[color:var(--surface-subtle)] px-4 py-8 md:px-7 md:py-10"
      aria-busy="true"
    >
      <HeadingRow id="home-featured" title="منتجات من المتجر" hint="مختارات حديثة من الكتالوج — بلا ادعاء أكثر مبيعًا." />
      <div className="mt-5 grid grid-cols-2 gap-3.5 md:grid-cols-4 md:gap-4" aria-hidden="true">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="vxp-shimmer h-56 rounded-card bg-purple-surface" />
        ))}
      </div>
    </section>
  );
}

export default function HomePage() {
  return (
    <StoreShell>
      <div>
        <HomeHero />
      </div>
      <div id="categories">
        <Suspense fallback={<CategoriesFallback />}>
          <CategoriesSection />
        </Suspense>
      </div>
      <Suspense fallback={<FeaturedFallback />}>
        <FeaturedSection />
      </Suspense>
      <section
        aria-label="طرق تصفح إضافية"
        className="mt-10 flex flex-wrap items-center justify-between gap-4 rounded-card border border-line bg-white px-5 py-4 shadow-xs"
      >
        <p className="text-sm font-medium text-secondary">لا تجد ما تبحث عنه؟ جرّب البحث المباشر أو تصفّح العلامات التجارية.</p>
        <div className="flex flex-wrap items-center gap-2.5">
          <Link
            href="/search"
            prefetch={false}
            className="inline-flex min-h-[44px] items-center rounded-control border border-line-strong bg-purple-surface/60 px-4 text-sm font-semibold text-brand transition-colors duration-200 hover:border-brand hover:bg-purple-surface"
          >
            ابحث في المتجر
          </Link>
          <Link
            href="/brands"
            prefetch={false}
            className="inline-flex min-h-[44px] items-center rounded-control border border-line bg-white px-4 text-sm font-semibold text-brand transition-colors duration-200 hover:border-brand hover:bg-purple-surface"
          >
            العلامات التجارية
          </Link>
        </div>
      </section>
    </StoreShell>
  );
}
