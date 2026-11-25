// @vitest-environment node
// ADM-11 — the audit vocabulary is the single list.
//
// The old filter offered 61 actions while the store wrote 68, so seven real
// actions were unfilterable. This test reads the actual `action:` literals from
// `src/` (test files excluded) and requires the vocabulary to match EXACTLY,
// in both directions. It also proves the read-time PII policy.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  AUDIT_ACTIONS,
  AUDIT_ACTION_KEYS,
  AUDIT_FORBIDDEN_FIELDS,
  AUDIT_MASKED_FIELDS,
  auditActionOutcome,
  auditActionText,
  isSensitiveAuditAction,
  maskAuditValue,
  maskAuditValues,
} from "@/lib/admin/audit-vocabulary";

const ROOT = resolve(__dirname, "../../../..");

function sourceActions(): Set<string> {
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "__tests__" && entry.name !== "node_modules") walk(path);
      } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.includes(".test.")) {
        const text = readFileSync(path, "utf8");
        for (const match of text.matchAll(/action:\s*"([a-z0-9_.]+)"/g)) found.add(match[1]);
      }
    }
  };
  walk(join(ROOT, "src"));
  return found;
}

describe("ADM-11 — audit action vocabulary", () => {
  it("lists every action the source writes, with no extra and no missing key", () => {
    const expected = [...sourceActions()].sort();
    expect(expected.length).toBeGreaterThan(60);
    expect([...AUDIT_ACTION_KEYS].sort()).toEqual(expected);
  });

  it("has unique keys and an Arabic label for each (never the raw token)", () => {
    expect(new Set(AUDIT_ACTION_KEYS).size).toBe(AUDIT_ACTION_KEYS.length);
    for (const entry of AUDIT_ACTIONS) {
      expect(entry.label.length, entry.action).toBeGreaterThan(3);
      expect(entry.label, entry.action).not.toBe(entry.action);
      expect(auditActionText(entry.action), entry.action).toBe(entry.label);
    }
    expect(auditActionText("not.a.real.action")).toBe("عمل غير معروف");
  });

  it("derives the outcome instead of guessing it", () => {
    for (const entry of AUDIT_ACTIONS) {
      expect(["SUCCESS", "FAILURE"], entry.action).toContain(entry.outcome);
      expect(auditActionOutcome(entry.action), entry.action).toBe(entry.outcome);
    }
    expect(AUDIT_ACTIONS.filter((entry) => entry.outcome === "FAILURE").map((entry) => entry.action).sort()).toEqual([
      "auth.account_locked",
      "auth.login_failure",
    ]);
    expect(auditActionOutcome("unknown.action")).toBe("SUCCESS");
  });

  it("marks access, money, identity and destructive actions as sensitive", () => {
    for (const action of [
      "users.create",
      "users.role_assign",
      "roles.grant",
      "roles.revoke",
      "roles.delete",
      "settings.update",
      "variants.price",
      "products.hard_delete",
      "products.archive",
      "orders.cancel",
      "customers.anonymize",
      "coupons.delete",
      "auth.login_failure",
      "auth.account_locked",
    ]) {
      expect(isSensitiveAuditAction(action), action).toBe(true);
    }
    for (const action of ["products.update", "images.register", "inventory.adjust", "orders.advance", "auth.login_success"]) {
      expect(isSensitiveAuditAction(action), action).toBe(false);
    }
    expect(isSensitiveAuditAction("unknown.action")).toBe(false);
  });

  it("declares the forbidden and masked field policies explicitly", () => {
    for (const key of ["password", "token", "cookie", "authorization", "secret"]) {
      expect(AUDIT_FORBIDDEN_FIELDS).toContain(key);
    }
    expect(AUDIT_MASKED_FIELDS.slice().sort()).toEqual(["email", "firstname", "lastname", "phone"]);
  });
});

describe("ADM-11 — audit PII masking", () => {
  it("masks email, phone and names when the reader lacks the customer capability", () => {
    const masked = maskAuditValues(
      {
        email: "customer@example.invalid",
        phone: "01012345678",
        firstName: "أحمد",
        lastName: "محمود",
        status: "ACTIVE",
      },
      false,
    ) as Record<string, string>;
    expect(masked.email).toBe("c•••••••@example.invalid");
    expect(masked.phone).toBe("010••••••78");
    expect(masked.firstName).not.toBe("أحمد");
    expect(masked.firstName.startsWith("أ")).toBe(true);
    expect(masked.lastName).not.toBe("محمود");
    expect(masked.status).toBe("ACTIVE");
  });

  it("does not mask the same values for a reader who can read customers", () => {
    const values = { email: "customer@example.invalid", phone: "01012345678", firstName: "أحمد" };
    expect(maskAuditValues(values, true)).toEqual(values);
  });

  it("masks nested objects and arrays without changing their shape", () => {
    const masked = maskAuditValues(
      { customer: { email: "a@b.co" }, contacts: [{ phone: "01000000000" }] },
      false,
    ) as { customer: { email: string }; contacts: Array<{ phone: string }> };
    expect(masked.customer.email).not.toBe("a@b.co");
    expect(masked.contacts[0].phone).not.toBe("01000000000");
    expect(masked.contacts).toHaveLength(1);
  });

  it("replaces a forbidden field with a marker even when the reader can see PII", () => {
    const masked = maskAuditValues({ password: "synthetic", nested: { token: "synthetic" } }, true) as {
      password: string;
      nested: { token: string };
    };
    expect(masked.password).toBe("[محجوب]");
    expect(masked.nested.token).toBe("[محجوب]");
  });

  it("leaves nulls, numbers, booleans and booleans inside arrays untouched", () => {
    expect(maskAuditValues(null, false)).toBeNull();
    expect(maskAuditValues(42, false)).toBe(42);
    expect(maskAuditValues({ count: 3, active: true, empty: null }, false)).toEqual({ count: 3, active: true, empty: null });
    expect(maskAuditValues([1, "plain"], false)).toEqual([1, "plain"]);
  });

  it("keeps a short value masked rather than leaking it", () => {
    expect(maskAuditValue("a")).toBe("a•");
    expect(maskAuditValue("")).toBe("");
    expect(maskAuditValue("01012345678")).toHaveLength(11);
    expect(maskAuditValue("x@y.co")).toContain("@y.co");
  });
});
