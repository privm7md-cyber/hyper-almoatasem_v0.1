// FE-4 product details (server): live product + variants + gallery + stock.
// Unknown/inactive id → not-found (never a substitute product). Related section omitted
// (no relation endpoint — documented, not faked).

import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { StoreShell } from "@/components/store/store-shell";
import { ProductGallery } from "@/components/store/product-gallery";
import { PurchasePanel } from "@/components/store/purchase-panel";
import { getProductPage } from "@/lib/frontend/storefront-reads";
import { slugMatches, wireSlugOf } from "@/lib/frontend/slug";

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
  };
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string; slug: string }>;
}) {
  const { id, slug } = await params;
  const product = await getProductPage(id).catch(() => null);
  if (!product) notFound();
  if (!slugMatches(slug, product.slug)) permanentRedirect(`/p/${product.id}/${wireSlugOf(product.slug)}`);

  return (
    <StoreShell>
      <article aria-label={product.name} className="mt-6 grid gap-6 md:grid-cols-2">
        <ProductGallery images={product.gallery} name={product.name} />
        <div className="grid content-start gap-3">
          <h1 className="text-2xl font-extrabold">{product.name}</h1>
          <p className="text-sm text-secondary">
            {product.categoryName}
            {product.brandName ? ` · ${product.brandName}` : ""}
            {` · ${product.productType === "PIECE" ? "بالقطعة" : "بالوزن"}`}
          </p>
          {product.description ? <p className="text-sm">{product.description}</p> : null}
          <PurchasePanel product={product} />
        </div>
      </article>
    </StoreShell>
  );
}
