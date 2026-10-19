import { describe, expect, it } from "vitest";
import { slugMatches, wireSlugOf } from "../slug";

describe("slugMatches (FE-3/FE-4/FE-5 canonical slug comparison)", () => {
  it("matches a decoded wire segment identical to the canonical slug", () => {
    expect(slugMatches("أفطار", "أفطار")).toBe(true);
  });

  it("matches a percent-encoded wire segment (what Next passes to dynamic params)", () => {
    const wire = encodeURIComponent("أفطار");
    expect(wire).toBe("%D8%A3%D9%81%D8%B7%D8%A7%D8%B1");
    expect(slugMatches(wire, "أفطار")).toBe(true);
  });

  it("keeps stale-slug semantics: a different text still mismatches (canonical redirect fires)", () => {
    expect(slugMatches(encodeURIComponent("old-name"), "أفطار")).toBe(false);
    expect(slugMatches("old-name", "أفطار")).toBe(false);
  });

  it("handles spaces in Arabic slugs (%20 form)", () => {
    const canonical = "الألبان والأجبان";
    expect(slugMatches(encodeURIComponent(canonical), canonical)).toBe(true);
  });

  it("never throws on malformed escapes; treated as non-matching", () => {
    expect(() => slugMatches("%E0%A4%E4", "أفطار")).not.toThrow();
    expect(slugMatches("%E0%A4%E4", "أفطار")).toBe(false);
  });

  it("ASCII slugs round-trip", () => {
    expect(slugMatches("milk-1l", "milk-1l")).toBe(true);
    expect(wireSlugOf("milk-1l")).toBe("milk-1l");
  });

  it("wireSlugOf encodes canonical for hrefs", () => {
    expect(wireSlugOf("أفطار")).toBe("%D8%A3%D9%81%D8%B7%D8%A7%D8%B1");
  });
});
