// BA-B3 product search (raw SQL, database-side only).
//
// Engine decision (documented in docs/backend-integration.md BA-B):
// PostgreSQL pg_trgm similarity + GIN functional indexes on
// hyper_norm_ar(name) (products/brands/categories) + exact-code pin.
// FTS was evaluated and rejected: PostgreSQL ships no Arabic stemmer
// (external dicts = heavy ops), while trigram similarity is
// typo-tolerant, prefix-friendly, language-data-free, and GIN-indexable.
// No application-side ranking over bulk rows ever (frozen rule); the DB
// returns the final ordered page. NEVER loads 20k rows into Node.
//
// Ranking tiers (deterministic, total order):
//   exact code ......... pinned first as its own result (never fuzzy-covered)
//   tier 3 ............. normalized product name equals normalized query
//   tier 2 ............. normalized product name starts with the query
//   tier 1 ............. product-name similarity >= threshold
//   tier 0 ............. brand/category-name similarity >= threshold
// Within a tier: similarity DESC, id ASC. Pages use keyset on
// (tier, sim, id) — safe with ranking (no OFFSET).
//
// Filters (category subtree / brand / price window / stock / type) apply
// once in the outer query over candidate ids; each match arm stays
// index-assistable. Visibility mirrors storefront (active-only) unless
// the caller passes includeInactive (admin future use).
//
// SQL is assembled from FIXED fragments + $N placeholders bound
// positionally via $queryRawUnsafe (values never touch SQL text).
import "server-only";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api/errors";
import { uuidSchema } from "@/lib/api/validation";
import { expandCategorySubtree } from "@/lib/catalog/queries";

/** Minimum trigram similarity for tier-1/0 recall (BA-B corpus-tuned:
 * typo "بيسبي"≈0.20 and partial "بطاط"≈0.57 pass; unrelated ≈0.00 fails). */
export const SEARCH_MIN_SIMILARITY = 0.2;

/** Minimum normalized query length (single chars match everything). */
export const SEARCH_MIN_LENGTH = 2;

export interface SearchCursor {
  v: 2;
  t: number;
  s: number;
  id: string;
}

export function encodeSearchCursor(tier: number, sim: number, id: string): string {
  return Buffer.from(JSON.stringify({ v: 2, t: tier, s: sim, id }), "utf8").toString("base64url");
}

export function decodeSearchCursor(raw: string | null | undefined): SearchCursor | null {
  if (raw === null || raw === undefined || raw === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new ApiError("VALIDATION", "Invalid search cursor.", null);
  }
  const c = parsed as { v?: unknown; t?: unknown; s?: unknown; id?: unknown };
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    c.v !== 2 ||
    typeof c.t !== "number" ||
    typeof c.s !== "number" ||
    !uuidSchema.safeParse(c.id).success
  ) {
    throw new ApiError("VALIDATION", "Invalid search cursor.", null);
  }
  return { v: 2, t: c.t, s: c.s, id: c.id as string };
}

export interface SearchFilter {
  limit: number;
  cursor: string | null;
  sort: "relevance" | "newest";
  categoryId: string | null;
  brandId: string | null;
  productType: "PIECE" | "WEIGHT" | null;
  minPrice: string | null;
  maxPrice: string | null;
  inStock: boolean | null;
  includeInactive: boolean;
}

export interface SearchHit {
  id: string;
  name: string;
  slug: string;
  productType: string;
  unit: string;
  saleStepGrams: number | null;
  isActive: boolean;
  createdAt: string;
  category: { id: string; name: string; slug: string } | null;
  brand: { id: string; name: string; slug: string } | null;
  match: { kind: "code" | "text"; tier: number; score: number };
}

export interface SearchPage {
  rows: SearchHit[];
  nextCursor: string | null;
}

type ProductRow = {
  id: string;
  name: string;
  slug: string;
  product_type: string;
  unit: string;
  sale_step_grams: number | null;
  is_active: boolean;
  created_at: Date;
  cid: string | null;
  cname: string | null;
  cslug: string | null;
  bid: string | null;
  bname: string | null;
  bslug: string | null;
};

function toHit(
  r: ProductRow & { created_at: Date },
  match: { kind: "code" | "text"; tier: number; score: number },
): SearchHit {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    productType: r.product_type,
    unit: r.unit,
    saleStepGrams: r.sale_step_grams,
    isActive: r.is_active,
    createdAt: r.created_at.toISOString(),
    category: r.cid ? { id: r.cid, name: r.cname as string, slug: r.cslug as string } : null,
    brand: r.bid ? { id: r.bid, name: r.bname as string, slug: r.bslug as string } : null,
    match,
  };
}

const PRODUCT_COLS = `p.id::text AS id, p.name, p.slug, p.product_type, p.unit,
  p.sale_step_grams, p.is_active, p.created_at,
  c.id::text AS cid, c.name AS cname, c.slug AS cslug,
  b.id::text AS bid, b.name AS bname, b.slug AS bslug`;

/**
 * Text search over live products. Empty/blank queries are rejected by the
 * caller (400); normalized-to-empty likewise. Throws ApiError (400/404).
 */
export async function searchProducts(rawQuery: string, filter: SearchFilter): Promise<SearchPage> {
  if (rawQuery.trim() === "") throw new ApiError("VALIDATION", "Search query is required.", null);
  // Param ownership is per-branch (every bound value MUST be referenced in
  // its SQL text — a dangling $N fails with 42P18 under the extended
  // protocol). Relevance arms use hyper_norm_ar($1) with the raw query as
  // params[0] (single server-side normalization point — no client/JS
  // mirror of the fold); newest binds only its own filters.
  const vis = filter.includeInactive ? `TRUE` : `p.is_active AND p.deleted_at IS NULL`;
  const categoryIds =
    filter.categoryId === null || filter.categoryId === undefined
      ? null
      : await expandCategorySubtree(filter.categoryId);
  const buildConds = (params: unknown[]): string => {
    const conds: string[] = [vis];
    const push = (fragment: string, value: unknown): string => {
      params.push(value);
      return fragment.replaceAll("?", `$${params.length}`);
    };
    if (categoryIds !== null) conds.push(push(`p.category_id = ANY(?::uuid[])`, categoryIds));
    if (filter.brandId !== null && filter.brandId !== undefined) {
      conds.push(push(`p.brand_id = ?::uuid`, filter.brandId));
    }
    if (filter.productType !== null && filter.productType !== undefined) {
      conds.push(push(`p.product_type = ?`, filter.productType));
    }
    if (filter.minPrice !== null && filter.minPrice !== undefined) {
      conds.push(
        push(
          `EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id
            AND v.is_active AND v.deleted_at IS NULL AND v.price >= ?::numeric)`,
          filter.minPrice,
        ),
      );
    }
    if (filter.maxPrice !== null && filter.maxPrice !== undefined) {
      conds.push(
        push(
          `EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id
            AND v.is_active AND v.deleted_at IS NULL AND v.price <= ?::numeric)`,
          filter.maxPrice,
        ),
      );
    }
    if (filter.inStock === true) {
      conds.push(`EXISTS (SELECT 1 FROM product_variants v JOIN inventory i
        ON i.product_variant_id = v.id WHERE v.product_id = p.id
        AND v.is_active AND v.deleted_at IS NULL AND i.available_quantity > 0)`);
    }
    return conds.join(" AND ");
  };
  const params: unknown[] = [rawQuery.trim()];
  const filterWhere = buildConds(params);

  if (filter.sort === "newest") {
    // Own bind array (the raw query is meaningless here and MUST NOT be
    // bound — every $N must be referenced). Same filter builder, fresh array.
    const nparams: unknown[] = [];
    const nfilterWhere = buildConds(nparams);
    let keyset = ``;
    const cursor = decodeSearchCursor(filter.cursor);
    if (cursor) {
      const at = new Date(cursor.s);
      if (Number.isNaN(at.getTime())) throw new ApiError("VALIDATION", "Invalid search cursor.", null);
      nparams.push(at.toISOString(), cursor.id);
      const n = nparams.length;
      keyset = ` AND (p.created_at < $${n - 1}::timestamptz OR
        (p.created_at = $${n - 1}::timestamptz AND p.id > $${n}::uuid))`;
    }
    nparams.push(filter.limit + 1);
    const rows = await prisma.$queryRawUnsafe<Array<ProductRow>>(
      `SELECT ${PRODUCT_COLS}
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         LEFT JOIN brands b ON b.id = p.brand_id
        WHERE ${nfilterWhere}${keyset}
        ORDER BY p.created_at DESC, p.id ASC
        LIMIT $${nparams.length}`,
      ...nparams,
    );
    const hits = rows.map((r) => toHit(r, { kind: "text", tier: 0, score: 0 }));
    if (hits.length <= filter.limit) return { rows: hits, nextCursor: null };
    const page = hits.slice(0, filter.limit);
    const last = rows[filter.limit - 1];
    return {
      rows: page,
      nextCursor: encodeSearchCursor(0, new Date(last.created_at).getTime(), last.id),
    };
  }

  // ---- relevance: UNION ALL of index-assistable arms, then rank ----
  // Arm shape: (pid, tier, sim). The % operator (backed by SET LOCAL
  // pg_trgm.similarity_threshold in the wrapping read tx) drives the
  // functional GIN indexes; LIKE-prefix arms ride them too. LIKE patterns
  // escape user-supplied %/_ (ESCAPE '\') so queries stay literal.
  // Tier 4 is the exact-code pin (cashier semantics): it flows through the
  // SAME outer filterWhere as text arms, so filters never contradict the
  // pin — and no fuzzy row can outrank it.
  const armsActive = filter.includeInactive ? `TRUE` : `p.is_active AND p.deleted_at IS NULL`;
  const armsVariantActive = filter.includeInactive
    ? `TRUE`
    : `v.is_active AND v.deleted_at IS NULL`;
  const likePat = `replace(replace(hyper_norm_ar($1), '%', '\\%'), '_', '\\_') || '%' ESCAPE '\\'`;
  const arms = `
    SELECT p.id AS pid, 4 AS tier, 1.0::float8 AS sim
      FROM products p
      JOIN product_variants v ON v.product_id = p.id
      JOIN product_codes pc ON pc.product_variant_id = v.id
     WHERE ${armsActive} AND ${armsVariantActive} AND pc.code = $1
    UNION ALL
    SELECT p.id AS pid, 3 AS tier, 1.0::float8 AS sim
      FROM products p WHERE ${armsActive} AND hyper_norm_ar(p.name) = hyper_norm_ar($1)
    UNION ALL
    SELECT p.id, 2, similarity(hyper_norm_ar(p.name), hyper_norm_ar($1))
      FROM products p WHERE ${armsActive} AND hyper_norm_ar(p.name) LIKE ${likePat}
        AND hyper_norm_ar(p.name) <> hyper_norm_ar($1)
    UNION ALL
    SELECT p.id, 1, similarity(hyper_norm_ar(p.name), hyper_norm_ar($1))
      FROM products p WHERE ${armsActive} AND hyper_norm_ar(p.name) % hyper_norm_ar($1)
        AND hyper_norm_ar(p.name) <> hyper_norm_ar($1)
        AND hyper_norm_ar(p.name) NOT LIKE ${likePat}
    UNION ALL
    SELECT p.id, 0, similarity(hyper_norm_ar(b.name), hyper_norm_ar($1))
      FROM products p JOIN brands b ON b.id = p.brand_id
     WHERE ${armsActive} AND hyper_norm_ar(b.name) % hyper_norm_ar($1)
    UNION ALL
    SELECT p.id, 0, similarity(hyper_norm_ar(c.name), hyper_norm_ar($1))
      FROM products p JOIN categories c ON c.id = p.category_id
     WHERE ${armsActive} AND hyper_norm_ar(c.name) % hyper_norm_ar($1)`;
  const cursor = decodeSearchCursor(filter.cursor);
  let keyset = ``;
  if (cursor) {
    params.push(cursor.t, cursor.s, cursor.id);
    const n = params.length;
    keyset = ` AND (r.t < $${n - 2} OR (r.t = $${n - 2}
      AND r.s < $${n - 1}) OR (r.t = $${n - 2}
      AND r.s = $${n - 1} AND r.id > $${n}::uuid))`;
  }
  params.push(filter.limit + 1);
  type RankRow = ProductRow & { tier: number; sim: number };
  // Read-only tx solely to scope SET LOCAL (similarity threshold backing
  // the % arms). No writes; nothing to roll back on failure.
  const rows = await prisma.$transaction(async (tx) => {
    // SEARCH_MIN_SIMILARITY is a code constant (never user input), so
    // inline interpolation here is safe; SET accepts no bind parameters.
    await tx.$executeRawUnsafe(`SET LOCAL pg_trgm.similarity_threshold = ${SEARCH_MIN_SIMILARITY}`);
    return tx.$queryRawUnsafe<Array<RankRow>>(
      `WITH cands(pid, tier, sim) AS (${arms}),
      ranked AS (
        SELECT pid AS id, MAX(tier) AS t, MAX(sim) AS s FROM cands GROUP BY pid
      )
      SELECT ${PRODUCT_COLS}, r.t AS tier, r.s AS sim
        FROM ranked r
        JOIN products p ON p.id = r.id
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN brands b ON b.id = p.brand_id
       WHERE ${filterWhere}${keyset}
       ORDER BY r.t DESC, r.s DESC, r.id ASC
       LIMIT $${params.length}`,
      ...params,
    );
  });
  const hits = rows.map((r) =>
    toHit(
      r,
      r.tier === 4
        ? { kind: "code" as const, tier: r.tier, score: 1 }
        : { kind: "text" as const, tier: r.tier, score: Number(Number(r.sim).toFixed(4)) },
    ),
  );
  if (hits.length <= filter.limit) return { rows: hits, nextCursor: null };
  const page = hits.slice(0, filter.limit);
  const last = rows[filter.limit - 1];
  return { rows: page, nextCursor: encodeSearchCursor(last.tier, Number(last.sim), last.id) };
}
