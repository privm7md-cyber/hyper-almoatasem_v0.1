// Unit tests for the centralized log sanitizer (R-04 remediation).
//
// The contract under test: a key that can carry a secret is dropped at EVERY
// depth, not only at the top level. Before the fix the traversal stopped at
// the first level, so a payload such as { user: { password: "..." } } was
// logged verbatim.
import { describe, expect, it } from "vitest";
import { sanitizeLogFields } from "@/lib/api/log";

describe("sanitizeLogFields", () => {
  it("drops forbidden keys at the top level (unchanged behaviour)", () => {
    const clean = sanitizeLogFields({
      orderId: "abc",
      password: "x",
      password_hash: "y",
      token: "z",
      DATABASE_URL: "u",
      userAgent: "ua",
    });
    expect(clean).toEqual({ orderId: "abc", userAgent: "ua" });
  });

  it("drops a forbidden key nested inside an object", () => {
    const clean = sanitizeLogFields({
      actor: { id: "u1", password: "hunter2", name: "Ali" },
    });
    expect(clean).toEqual({ actor: { id: "u1", name: "Ali" } });
  });

  it("drops a forbidden key nested inside an array of objects", () => {
    const clean = sanitizeLogFields({
      actors: [{ id: "u1", token: "abc" }, { id: "u2", token: "def" }],
    });
    expect(clean).toEqual({ actors: [{ id: "u1" }, { id: "u2" }] });
  });

  it("drops a forbidden key at an arbitrary depth", () => {
    const clean = sanitizeLogFields({
      a: { b: { c: { d: { secret: "x", keep: 1 } } } },
    });
    expect(clean).toEqual({ a: { b: { c: { d: { keep: 1 } } } } });
  });

  it("matches the key name case-insensitively and by substring", () => {
    const clean = sanitizeLogFields({
      nested: { Authorization: "Bearer x", "Set-Cookie": "a=b", API_KEY: "k", GuestTokenHash: "h" },
    });
    expect(clean).toEqual({ nested: {} });
  });

  it("keeps the surrounding payload intact when a nested key is dropped", () => {
    const clean = sanitizeLogFields({
      orderId: "o1",
      payload: { fee: "20.00", sessionToken: "s", zone: { name: "Z", token: "t" } },
    });
    expect(clean).toEqual({ orderId: "o1", payload: { fee: "20.00", zone: { name: "Z" } } });
  });

  it("never emits the secret value anywhere in the serialized result", () => {
    const clean = sanitizeLogFields({
      outer: { inner: { password: "TOP-SECRET-VALUE" }, list: [{ cookie: "TOP-SECRET-VALUE" }] },
    });
    expect(JSON.stringify(clean)).not.toContain("TOP-SECRET-VALUE");
  });

  it("preserves non-plain values so they keep their own serialization", () => {
    const when = new Date("2026-10-30T00:00:00.000Z");
    const clean = sanitizeLogFields({ when, count: BigInt(3), flag: false, nil: null });
    expect(clean.when).toBe(when);
    expect(clean.count).toBe("3");
    expect(clean.flag).toBe(false);
    expect(clean.nil).toBeNull();
  });

  it("cuts a cycle instead of recursing forever", () => {
    const node: Record<string, unknown> = { id: "n1" };
    node.self = node;
    const clean = sanitizeLogFields({ node });
    expect(clean).toEqual({ node: { id: "n1", self: "[circular]" } });
  });

  it("serializes a shared (non-cyclic) reference twice", () => {
    const shared = { id: "s1" };
    const clean = sanitizeLogFields({ a: shared, b: shared });
    expect(clean).toEqual({ a: { id: "s1" }, b: { id: "s1" } });
  });

  it("replaces a value beyond the depth limit with a marker", () => {
    let deep: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 40; i++) deep = { next: deep };
    const clean = sanitizeLogFields({ deep });
    expect(JSON.stringify(clean)).toContain("[truncated]");
  });
});
