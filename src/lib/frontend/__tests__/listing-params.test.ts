// FE-3 listing URL-state unit tests (pure parse/build; no backend).
import { describe, expect, it } from "vitest";
import {
  buildListingQuery,
  parseListingParams,
  parseSearchQuery,
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
