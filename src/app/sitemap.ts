import type { MetadataRoute } from "next";
import { listBrands, listCategories, listProducts } from "@/lib/catalog/queries";
import { wireSlugOf } from "@/lib/frontend/slug";
import { SITE_ORIGIN, mayAdvertiseOrigin } from "@/lib/site-origin";

// Public sitemap (Phase-12).
//
// The catalogue holds thousands of products, so the product URLs are collected
// with the keyset cursor and appended to the same file: the result stays far
// below the protocol limits (50 000 URLs / 50 MB), and the file is cached for
// an hour so a crawler never re-runs the whole walk on every request.
//
// Nothing private is listed: no admin, no session, no cart / checkout /
// account / orders, no unpublished pages, and — Final-Closure — no preview or
// localhost host is EVER advertised from a production build: entries are
// emitted only from an explicitly configured origin (src/lib/site-origin.ts).

const PRODUCT_PAGE_SIZE = 1000;
const CATEGORY_LIMIT = 5000;
const BRAND_LIMIT = 5000;

/** The sitemap is cached for an hour (a catalogue walk on every request is wasteful). */
export const revalidate = 3600;

/** Kept for external importers/tests; the live entries use mayAdvertiseOrigin(). */
export const ORIGIN = SITE_ORIGIN;

const STATIC_PAGES: {
  path: string;
  priority: number;
  changeFrequency: "daily" | "weekly" | "monthly";
}[] = [
  { path: "/", priority: 1, changeFrequency: "daily" },
  { path: "/categories", priority: 0.9, changeFrequency: "weekly" },
  { path: "/brands", priority: 0.7, changeFrequency: "weekly" },
  { path: "/about", priority: 0.5, changeFrequency: "monthly" },
  { path: "/faq", priority: 0.6, changeFrequency: "monthly" },
  { path: "/delivery", priority: 0.5, changeFrequency: "monthly" },
  { path: "/cancellation", priority: 0.5, changeFrequency: "monthly" },
  { path: "/replacement", priority: 0.5, changeFrequency: "monthly" },
  { path: "/order-help", priority: 0.6, changeFrequency: "monthly" },
  { path: "/contact", priority: 0.5, changeFrequency: "monthly" },
];

export interface ProductRef {
  id: string;
  slug: string;
  updatedAt?: Date | null;
}

/** Every active, sellable product (id + canonical slug), paged with the keyset cursor. */
export async function listAllProductRefs(): Promise<ProductRef[]> {
  const out: ProductRef[] = [];
  let cursor: string | null = null;
  // A hard bound: the sitemap must never grow without limit.
  for (let guard = 0; guard < 200; guard++) {
    const page = await listProducts({
      limit: PRODUCT_PAGE_SIZE,
      cursor,
      sort: "name",
      dir: "asc",
      search: null,
      categoryId: null,
      brandId: null,
      productType: null,
      active: null,
      minPrice: null,
      maxPrice: null,
      inStock: null,
    });
    for (const row of page.rows) out.push({ id: row.id, slug: row.slug, updatedAt: row.updatedAt ?? null });
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
    if (page.rows.length === 0) break;
  }
  return out;
}

export async function staticSitemapEntries(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const entries: MetadataRoute.Sitemap = STATIC_PAGES.map((p) => ({
    url: `${ORIGIN}${p.path}`,
    lastModified: now,
    changeFrequency: p.changeFrequency,
    priority: p.priority,
  }));

  const categories = await listCategories({
    limit: CATEGORY_LIMIT,
    cursor: null,
    sort: "name",
    dir: "asc",
    search: null,
    parent: undefined,
    active: null,
  }).catch(() => null);
  for (const c of categories?.rows ?? []) {
    entries.push({
      url: `${ORIGIN}/c/${c.id}/${wireSlugOf(c.slug)}`,
      lastModified: c.updatedAt ?? now,
      changeFrequency: "weekly",
      priority: 0.6,
    });
  }

  const brands = await listBrands({
    limit: BRAND_LIMIT,
    cursor: null,
    sort: "name",
    dir: "asc",
    search: null,
    active: null,
  }).catch(() => null);
  for (const b of brands?.rows ?? []) {
    entries.push({
      url: `${ORIGIN}/brand/${b.id}/${wireSlugOf(b.slug)}`,
      lastModified: b.updatedAt ?? now,
      changeFrequency: "weekly",
      priority: 0.5,
    });
  }
  return entries;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // "No fabricated origin": a production build without an explicitly
  // configured origin emits an EMPTY sitemap (the route still answers 200) —
  // a production host that was never told its own domain must not publish
  // entry URLs under a guessed host. Local/development environments keep the
  // full behaviour (Phase-12/17 contract).
  if (!mayAdvertiseOrigin()) return [];
  const entries = await staticSitemapEntries();
  const products = await listAllProductRefs().catch(() => []);
  const now = new Date();
  for (const p of products) {
    entries.push({
      url: `${ORIGIN}/p/${p.id}/${wireSlugOf(p.slug)}`,
      lastModified: p.updatedAt ?? now,
      changeFrequency: "weekly",
      priority: 0.7,
    });
  }
  return entries;
}
