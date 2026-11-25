// FE-4 product details (server): live product + variants + gallery + stock.
// Unknown/inactive id → not-found (never a substitute product). Related section omitted
// (no relation endpoint — documented, not faked).

import type { Metadata } from "next";
import { canonicalMetadata } from "@/lib/seo/canonical";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { StoreShell } from "@/components/store/store-shell";
import { ProductGallery } from "@/components/store/product-gallery";
import { PurchasePanel } from "@/components/store/purchase-panel";
import { getAllCategories, getProductPage } from "@/lib/frontend/storefront-reads";
import { selectCategoryParent } from "@/lib/frontend/category-context";
import { wireSlugOf, slugMatches } from "@/lib/frontend/slug";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string; slug: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const product = await getProductPage(id).catch(() => null);
  if (!product) return { title: "منتج غير موجود" };
  return {
    title: product.name,
    description: product.description ?? `تفاصيل ${product.name} في هايبر المعتصم.`,
    ...canonicalMetadata(`/p/${product.id}/${wireSlugOf(product.slug)}`),
  };
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string; slug: string }>;
}) {
  const { id, slug } = await params;

  // Batch 6 perf: Parallelize product details fetch and active categories read via Promise.all
  const [product, allActiveCategories] = await Promise.all([
    getProductPage(id).catch(() => null),
    getAllCategories().catch(() => []),
  ]);

  if (!product) notFound();
  if (!slugMatches(slug, product.slug)) permanentRedirect(`/p/${product.id}/${wireSlugOf(product.slug)}`);

  // PDP breadcrumb chain (CTR-3): the product's REAL category is always a link
  // back to its /c page; when that category is a sub, its active parent precedes
  // it. Same active-list source as the category pages, same degrading rule: a
  // parent that is not on the active list never becomes a broken link.
  const parent = selectCategoryParent(product.category, allActiveCategories);

  return (
    <StoreShell>
      <nav aria-label="مسار التنقل" className="mt-4 text-sm text-secondary">
        <Link href="/" prefetch={false} className="hover:text-brand">
          الرئيسية
        </Link>
        <span aria-hidden="true"> / </span>
        <Link href="/categories" prefetch={false} className="hover:text-brand">
          الأقسام
        </Link>
        {parent ? (
          <>
            <span aria-hidden="true"> / </span>
            <Link href={`/c/${parent.id}/${wireSlugOf(parent.slug)}`} prefetch={false} className="hover:text-brand">
              {parent.name}
            </Link>
          </>
        ) : null}
        <span aria-hidden="true"> / </span>
        <Link href={`/c/${product.category.id}/${wireSlugOf(product.category.slug)}`} prefetch={false} className="hover:text-brand">
          {product.category.name}
        </Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">{product.name}</span>
      </nav>
      <article aria-label={product.name} className="mt-5 grid gap-6 md:grid-cols-[minmax(0,1.02fr)_minmax(0,0.98fr)] md:items-start lg:gap-8">
        <ProductGallery images={product.gallery} name={product.name} productType={product.productType} />
        <div className="grid content-start gap-4">
          <div className="rounded-card border border-line bg-white p-5 shadow-xs">
            <h1 className="text-2xl font-extrabold leading-tight text-brand-deep md:text-[26px]">{product.name}</h1>
            <p className="mt-2 text-sm text-secondary">
              {product.category.name}
              {product.brandName ? ` · ${product.brandName}` : ""}
              {` · ${product.productType === "PIECE" ? "بالقطعة" : "بالوزن"}`}
            </p>
            {product.description ? (
              <p className="mt-3 border-t border-line/70 pt-3 text-sm leading-relaxed text-ink">
                {product.description}
              </p>
            ) : null}
            <p className="mt-3 rounded-badge bg-purple-surface px-2.5 py-0.5 text-xs text-secondary" role="note">
              توفر المنتجات بيتأكد أثناء تجهيز الطلب، ولو صنف مش موجود هنبعتلك بدائل.
            </p>
          </div>
          <PurchasePanel product={product} />
        </div>
      </article>
    </StoreShell>
  );
}
