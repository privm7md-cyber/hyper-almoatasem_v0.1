// BA-2 catalog serialization (boundary shapes).
//
// Decimals serialize as exact strings via Prisma Decimal toString (which
// normalizes away trailing zeros: "130.00" -> "130" — numerically exact;
// clients must parse as decimal, never string-compare). DateTimes as ISO
// strings. Public shapes exclude internal fields (`costPrice` is
// admin-only). Field sets mirror the frozen tables.
import type {
  Brand,
  Category,
  Product,
  ProductCode,
  ProductVariant,
} from "@prisma/client";
import { dec, decReq, iso } from "@/lib/api/serialize";
import type { MediaRow } from "@/lib/catalog/media";

export interface CategoryShape {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  image: string | null;
  parentId: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export function toCategory(c: Category): CategoryShape {
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    description: c.description,
    image: c.image,
    parentId: c.parentId,
    isActive: c.isActive,
    sortOrder: c.sortOrder,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export interface BrandShape {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toBrand(b: Brand): BrandShape {
  return {
    id: b.id,
    name: b.name,
    slug: b.slug,
    logo: b.logo,
    isActive: b.isActive,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

export interface ProductListItem {
  id: string;
  name: string;
  slug: string;
  productType: string;
  unit: string;
  saleStepGrams: number | null;
  isActive: boolean;
  category: { id: string; name: string; slug: string };
  brand: { id: string; name: string; slug: string } | null;
}

type ProductWithTaxonomy = Product & {
  category: Pick<Category, "id" | "name" | "slug">;
  brand: Pick<Brand, "id" | "name" | "slug"> | null;
};

export function toProductListItem(p: ProductWithTaxonomy): ProductListItem {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    productType: p.productType,
    unit: p.unit,
    saleStepGrams: p.saleStepGrams,
    isActive: p.isActive,
    category: { id: p.category.id, name: p.category.name, slug: p.category.slug },
    brand: p.brand ? { id: p.brand.id, name: p.brand.name, slug: p.brand.slug } : null,
  };
}

/**
 * Product DETAIL shape (BA-B1): list-item fields + description. Variants,
 * stock, gallery, and promos stay on their dedicated endpoints (separate
 * concerns, separate permissions — see docs/backend-integration.md BA-B).
 * Additive only: list shapes are byte-identical.
 */
export interface ProductDetail extends ProductListItem {
  description: string | null;
}

export function toProductDetail(p: ProductWithTaxonomy & { description: string | null }): ProductDetail {
  return { ...toProductListItem(p), description: p.description };
}

export interface VariantShape {
  id: string;
  productId: string;
  name: string;
  sizeValue: string | null;
  sizeUnit: string | null;
  price: string;
  compareAtPrice: string | null;
  isActive: boolean;
}

export function toVariant(v: ProductVariant): VariantShape {
  return {
    id: v.id,
    productId: v.productId,
    name: v.name,
    sizeValue: dec(v.sizeValue),
    sizeUnit: v.sizeUnit,
    price: decReq(v.price),
    compareAtPrice: dec(v.compareAtPrice),
    isActive: v.isActive,
  };
}

/** Admin-only extension: internal cost basis. Never sent on storefront shapes. */
export interface AdminVariantShape extends VariantShape {
  costPrice: string | null;
}

export function toAdminVariant(v: ProductVariant): AdminVariantShape {
  return { ...toVariant(v), costPrice: dec(v.costPrice) };
}

export interface CodeResolution {
  code: string;
  type: string;
  isPrimary: boolean;
  variant: VariantShape;
  product: ProductListItem;
}

type CodeWithGraph = ProductCode & {
  variant: ProductVariant & { product: ProductWithTaxonomy };
};

export function toCodeResolution(c: CodeWithGraph): CodeResolution {
  return {
    code: c.code,
    type: c.type,
    isPrimary: c.isPrimary,
    variant: toVariant(c.variant),
    product: toProductListItem(c.variant.product),
  };
}

export { iso };

/**
 * Media shapes (BA-B4): public delivery references only (url/alt/mime/
 * dimensions/order/primary + ISO timestamps). Never storage internals,
 * never binary content. Gallery order is (sort_order, id); primary is
 * the is_primary row else the first gallery row else null — deterministic
 * fallback, never a broken URL.
 */
export interface MediaShape {
  id: string;
  url: string;
  altText: string | null;
  mimeType: string | null;
  byteSize: number | null;
  width: number | null;
  height: number | null;
  sortOrder: number;
  isPrimary: boolean;
  createdAt: string;
}

export function toMediaImage(r: MediaRow): MediaShape {
  return {
    id: r.id,
    url: r.url,
    altText: r.altText,
    mimeType: r.mimeType,
    byteSize: r.byteSize,
    width: r.width,
    height: r.height,
    sortOrder: r.sortOrder,
    isPrimary: r.isPrimary,
    createdAt: r.createdAt.toISOString(),
  };
}

export interface GalleryShape {
  primary: MediaShape | null;
  gallery: MediaShape[];
}

export function toGallery(rows: MediaRow[]): GalleryShape {
  const gallery = rows.map(toMediaImage);
  const primary = gallery.find((g) => g.isPrimary) ?? gallery[0] ?? null;
  return { primary, gallery };
}
