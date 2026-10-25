// Phase 07 unit tests: the search engine must apply the QUERY for every sort.
// The "newest" branch used to rebuild its WHERE from the filters alone, so
// sorting by newest returned the newest rows of the whole catalog instead of
// the newest rows that MATCH the query (P07-F10). The prisma client is mocked:
// these tests assert the SQL contract (candidate set + filters + ordering),
// never a database result.
import { describe, expect, it, vi, beforeEach } from "vitest";

// "server-only" is a Next.js guard that throws when imported outside a server
// bundle; the search module is server-side by contract, so the guard is stubbed
// here (the module's behaviour, not its bundling, is under test).
vi.mock("server-only", () => ({}));

const queryRawUnsafe = vi.fn();
const executeRawUnsafe = vi.fn();
const expandCategorySubtree = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRawUnsafe: (...args: unknown[]) => queryRawUnsafe(...args),
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        $queryRawUnsafe: (...args: unknown[]) => queryRawUnsafe(...args),
        $executeRawUnsafe: (...args: unknown[]) => executeRawUnsafe(...args),
      }),
  },
}));

vi.mock("@/lib/catalog/queries", () => ({
  expandCategorySubtree: (...args: unknown[]) => expandCategorySubtree(...args),
}));

import { searchProducts, type SearchFilter } from "@/lib/catalog/search";

function filter(overrides: Partial<SearchFilter> = {}): SearchFilter {
  return {
    limit: 12,
    cursor: null,
    sort: "newest",
    categoryId: null,
    brandId: null,
    productType: null,
    minPrice: null,
    maxPrice: null,
    inStock: null,
    includeInactive: false,
    ...overrides,
  };
}

function lastSql(): string {
  return String(queryRawUnsafe.mock.calls.at(-1)?.[0] ?? "");
}

function lastParams(): unknown[] {
  return (queryRawUnsafe.mock.calls.at(-1)?.slice(1) ?? []) as unknown[];
}

describe("searchProducts — the sort never changes WHICH rows match", () => {
  beforeEach(() => {
    queryRawUnsafe.mockReset();
    executeRawUnsafe.mockReset();
    expandCategorySubtree.mockReset();
    queryRawUnsafe.mockResolvedValue([]);
  });

  it("applies the text query for the newest sort (shared candidate set)", async () => {
    await searchProducts("لورد", filter({ sort: "newest" }));
    const sql = lastSql();
    // The candidate CTE (the matching arms) must be part of the statement and
    // the raw query must stay bound at $1 — the newest branch used to select
    // from products with no text predicate at all.
    expect(sql).toContain("WITH cands(pid, tier, sim) AS");
    expect(sql).toContain("hyper_norm_ar(p.name) = hyper_norm_ar($1)");
    expect(sql).toContain("pc.code = $1");
    expect(lastParams()[0]).toBe("لورد");
    // ordering is the only difference between the two sorts
    expect(sql).toContain("ORDER BY p.created_at DESC, p.id ASC");
  });

  it("keeps the relevance ordering as the default sort", async () => {
    await searchProducts("لورد", filter({ sort: "relevance" }));
    const sql = lastSql();
    expect(sql).toContain("WITH cands(pid, tier, sim) AS");
    expect(sql).toContain("ORDER BY r.t DESC, r.s DESC, r.id ASC");
    expect(lastParams()[0]).toBe("لورد");
  });

  it("keeps the supported filters in the newest sort", async () => {
    expandCategorySubtree.mockResolvedValue(["11111111-1111-4111-8111-111111111111"]);
    await searchProducts(
      "لورد",
      filter({
        sort: "newest",
        categoryId: "11111111-1111-4111-8111-111111111111",
        brandId: "22222222-2222-4222-8222-222222222222",
        productType: "WEIGHT",
        minPrice: "10",
        maxPrice: "99",
        inStock: true,
      }),
    );
    const sql = lastSql();
    expect(sql).toContain("p.category_id = ANY(");
    expect(sql).toContain("p.brand_id =");
    expect(sql).toContain("p.product_type =");
    expect(sql).toContain("v.price >=");
    expect(sql).toContain("v.price <=");
    expect(sql).toContain("i.available_quantity > 0");
    const params = lastParams();
    expect(params).toContain("22222222-2222-4222-8222-222222222222");
    expect(params).toContain("10");
    expect(params).toContain("99");
  });

  it("pages the newest sort with the same keyset mechanism", async () => {
    const cursor = Buffer.from(JSON.stringify({ v: 2, t: 0, s: 0, id: "33333333-3333-4333-8333-333333333333" })).toString("base64url");
    await searchProducts("لورد", filter({ sort: "newest", cursor }));
    const sql = lastSql();
    expect(sql).toContain("p.created_at <");
    expect(sql).toContain("ORDER BY p.created_at DESC, p.id ASC");
  });

  it("scopes the similarity threshold inside the read transaction", async () => {
    await searchProducts("لورد", filter({ sort: "newest" }));
    expect(String(executeRawUnsafe.mock.calls.at(-1)?.[0] ?? "")).toContain(
      "SET LOCAL pg_trgm.similarity_threshold",
    );
  });

  it("rejects a blank query before touching the database", async () => {
    await expect(searchProducts("   ", filter())).rejects.toThrow();
    expect(queryRawUnsafe).not.toHaveBeenCalled();
  });
});
