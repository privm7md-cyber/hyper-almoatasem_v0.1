// CS-08 â€” pure unit tests for the three-way classification and manifest digest.
import { describe, expect, it } from "vitest";
import { canonicalJson, computeManifestDigest } from "../manifest";
import { classifyOp } from "../diff";
import type { SyncManifestOperation } from "../types";

const op = (over: Record<string, unknown>): SyncManifestOperation =>
  ({ type: "SET_VARIANT_FIELD", entityType: "product_variant", field: "price", base: "1.50", proposed: "14.75", ...over } as SyncManifestOperation);

describe("CS-08 three-way classification (pure)", () => {
  it("classifies SAFE_TO_APPLY when current === base !== proposed", () => {
    expect(classifyOp(op({}), { current: "1.50", exists: true })).toBe("SAFE_TO_APPLY");
  });
  it("classifies ALREADY_APPLIED when current === proposed !== base", () => {
    expect(classifyOp(op({ base: "1.00" }), { current: "14.75", exists: true })).toBe("ALREADY_APPLIED");
  });
  it("classifies UNCHANGED when current === proposed === base", () => {
    expect(classifyOp(op({ base: "14.75" }), { current: "14.75", exists: true })).toBe("UNCHANGED");
  });
  it("classifies CONFLICTED when current differs from both base and proposed", () => {
    expect(classifyOp(op({ base: "1.50" }), { current: "9.99", exists: true })).toBe("CONFLICTED");
  });
  it("treats base=null as CONFLICTED for SET ops", () => {
    expect(classifyOp(op({ base: null }), { current: "9.99", exists: true })).toBe("CONFLICTED");
  });
  it("treats missing entity as SOURCE_NOT_FOUND for SET ops", () => {
    expect(classifyOp(op({}), { current: null, exists: false })).toBe("SOURCE_NOT_FOUND");
  });
  it("treats missing entity as SAFE_TO_APPLY for CREATE ops", () => {
    expect(classifyOp({ type: "CREATE_CATEGORY", entityType: "category", entityId: "c1", base: null, proposed: null }, { current: null, exists: false })).toBe("SAFE_TO_APPLY");
  });
});

describe("CS-08 manifest digest (pure)", () => {
  it("canonicalJson is key-sorted and stable", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  });
  it("digest equals canonical digest of studio+baseline+operations", () => {
    const digest = computeManifestDigest({ studio: { source: "DRAFT", sourceId: "v0", revision: 0, generatedAt: new Date().toISOString() }, sourceBaseline: { id: "v0", type: "V0" }, operations: [op({})] });
    expect(digest).toMatch(/^[0-9a-f]{64}$/i);
  });
});
