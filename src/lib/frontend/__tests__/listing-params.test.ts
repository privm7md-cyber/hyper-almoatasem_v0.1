// FE-3 listing URL-state unit tests (pure parse/build; no backend).
import { describe, expect, it } from "vitest";
import {
  buildListingQuery,
  hasReversedPriceWindow,
  loadMoreKey,
  parseListingParams,
  parseSearchQuery,
  searchRetryHref,
} from "../listing-params";

describe("parseListingParams", () => {
  it("defaults a bare listing to created_at desc", () => {
    expect(parseListingParams({}, "listing")).toMatchObject({ sort: "created_at", dir: "desc" });
  });

  it("accepts only contract sorts, falls back otherwise", () => {
    expect(parseListingParams({ sort: "price", dir: "up" }, "listing")).toMatchObject({
      sort: "created_at",
      dir: "desc",
    });
    expect(parseListingParams({ sort: "name", dir: "asc" }, "listing")).toMatchObject({
      sort: "name",
      dir: "asc",
    });
    expect(parseListingParams({ sort: "newest" }, "search")).toMatchObject({ sort: "newest" });
    expect(parseListingParams({ sort: "price" }, "search")).toMatchObject({ sort: "relevance" });
  });

  it("sanitizes filters (type enum, boolean, price shape, UUID)", () => {
    const q = parseListingParams(
      { type: "BOGUS", inStock: "maybe", minPrice: "-5", maxPrice: "10.999", brand: "not-a-uuid" },
      "listing",
    );
    expect(q.type).toBeNull();
    expect(q.inStock).toBeNull();
    expect(q.minPrice).toBeNull();
    expect(q.maxPrice).toBeNull();
    expect(q.brandId).toBeNull();
  });

  it("keeps valid filter values verbatim (no invention)", () => {
    const id = "123e4567-e89b-12d3-a456-426614174000";
    const q = parseListingParams(
      { type: "WEIGHT", inStock: "true", minPrice: "10.50", maxPrice: "99", brand: id },
      "listing",
    );
    expect(q).toMatchObject({ type: "WEIGHT", inStock: true, minPrice: "10.50", maxPrice: "99", brandId: id });
  });

  it("query text follows the 2..120 contract", () => {
    expect(parseSearchQuery({})).toBeNull();
    expect(parseSearchQuery({ q: "x" })).toBeNull();
    expect(parseSearchQuery({ q: "  أرز  " })).toBe("أرز");
  });
});

describe("parseSearchQuery boundaries (P08-T02 matrix: trimmed length 0/1/2/120/121)", () => {
  it("0: missing, empty, or spaces-only → null (approved guidance, no request ever)", () => {
    expect(parseSearchQuery({})).toBeNull();
    expect(parseSearchQuery({ q: "" })).toBeNull();
    expect(parseSearchQuery({ q: "   " })).toBeNull();
  });

  it("1: below the minimum → null (local gate; nothing invalid is sent)", () => {
    expect(parseSearchQuery({ q: "ا" })).toBeNull();
  });

  it("2 and 120 accept (trim first; Arabic BMP char count == string .length — same as the backend zod check)", () => {
    expect(parseSearchQuery({ q: "  عس  " })).toBe("عس");
    const q120 = "ل".repeat(120);
    expect(parseSearchQuery({ q: q120 })).toBe(q120);
  });

  it("121: above the maximum → null (rejected locally; the results page owns the honest max-length message)", () => {
    expect(parseSearchQuery({ q: "ل".repeat(121) })).toBeNull();
  });
});

describe("buildListingQuery encoding (Arabic + spaces, no hand-concatenation)", () => {
  it("encodes through URLSearchParams and round-trips the parsed query", () => {
    const q = parseListingParams({}, "search");
    const s = buildListingQuery(q, { sort: "relevance" }, "أرز بسمتي");
    expect(s.startsWith("?q=")).toBe(true);
    expect(s).not.toMatch(/[\u0600-\u06FF]/); // no raw Arabic outside encoding
    expect(parseSearchQuery(Object.fromEntries(new URLSearchParams(s)))).toBe("أرز بسمتي");
  });
});

describe("buildListingQuery", () => {
  it("omits defaults and round-trips", () => {
    const q = parseListingParams({}, "listing");
    expect(buildListingQuery(q, { sort: "created_at" })).toBe("");
    const full = parseListingParams(
      { sort: "name", dir: "asc", type: "PIECE", inStock: "true" },
      "listing",
    );
    const s = buildListingQuery(full, { sort: "created_at" });
    expect(s).toContain("sort=name");
    expect(s).toContain("dir=asc");
    expect(parseListingParams(Object.fromEntries(new URLSearchParams(s)), "listing")).toMatchObject({
      sort: "name",
      dir: "asc",
      type: "PIECE",
      inStock: true,
    });
  });
});

describe("searchRetryHref (D07 + P08-T02)", () => {
  it("reproduces the full result-defining state, not just the q term", () => {
    const q = parseListingParams({ type: "PIECE", inStock: "false", sort: "newest" }, "search");
    expect(searchRetryHref(q, "عسل")).toBe(
      "/search?q=%D8%B9%D8%B3%D9%84&sort=newest&type=PIECE&inStock=false",
    );
  });

  it("stays minimal at defaults and plain /search when the query is invalid", () => {
    const q = parseListingParams({}, "search");
    expect(searchRetryHref(q, "عسل")).toBe("/search?q=%D8%B9%D8%B3%D9%84");
    expect(searchRetryHref(q, null)).toBe("/search");
  });

  it("never serializes dir into a search retry link (search contract has no dir) while keeping every filter", () => {
    const q = parseListingParams(
      { dir: "asc", sort: "newest", type: "PIECE", inStock: "false", minPrice: "10.50" },
      "search",
    );
    const href = searchRetryHref(q, "عسل");
    expect(href).not.toContain("dir=");
    expect(href).toContain("sort=newest");
    expect(href).toContain("type=PIECE");
    expect(href).toContain("inStock=false");
    expect(href).toContain("minPrice=10.50");
  });

  it("loads from a hand-written URL state: invalid filter VALUES never reach the retry link", () => {
    const q = parseListingParams(
      { sort: "price", dir: "up", type: "BOGUS", inStock: "maybe", brand: "not-a-uuid" },
      "search",
    );
    // Sanitized parse → everything contract-invalid fell back; retry keeps only
    // contract-valid state (sort fell back to relevance → omitted).
    expect(searchRetryHref(q, "عسل")).toBe("/search?q=%D8%B9%D8%B3%D9%84");
  });
});

describe("hasReversedPriceWindow (P08: D25 completion)", () => {
  it("is true only when BOTH bounds exist and max < min", () => {
    expect(hasReversedPriceWindow({ minPrice: "99", maxPrice: "5" })).toBe(true);
    expect(hasReversedPriceWindow({ minPrice: null, maxPrice: "5" })).toBe(false);
    expect(hasReversedPriceWindow({ minPrice: "99", maxPrice: null })).toBe(false);
    expect(hasReversedPriceWindow({ minPrice: "5", maxPrice: "5" })).toBe(false);
    expect(hasReversedPriceWindow({ minPrice: "5", maxPrice: "99" })).toBe(false);
  });
});

describe("loadMoreKey (D24)", () => {
  it("is stable for identical result-defining states", () => {
    const a = parseListingParams({}, "listing");
    expect(loadMoreKey(a)).toBe(loadMoreKey(parseListingParams({}, "listing")));
  });

  it("changes when filters/type change so the island remounts", () => {
    const a = parseListingParams({}, "listing");
    const b = parseListingParams({ type: "PIECE" }, "listing");
    expect(loadMoreKey(a)).not.toBe(loadMoreKey(b));
  });
});
