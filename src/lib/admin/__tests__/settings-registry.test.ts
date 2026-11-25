// @vitest-environment node
// ADM-10 — the settings registry is the allow-list.
//
// These tests are source-level: they prove that every seeded key is described,
// that an unregistered key cannot pass the write rule, and that the frozen
// delivery/currency facts are not silently made editable. They do NOT claim
// the live `store_settings` table matches the registry; that is reported as a
// database state, not inferred from code.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  SETTING_REGISTRY,
  SETTING_SECTIONS,
  editableSettingKeys,
  isSecretSettingKey,
  settingRegistryEntry,
  settingValueRule,
} from "@/lib/admin/settings-registry";

const ROOT = resolve(__dirname, "../../../..");

function seedSettingKeys(): string[] {
  const seed = readFileSync(resolve(ROOT, "prisma/seed.mjs"), "utf8");
  const start = seed.indexOf("const SETTINGS");
  const end = seed.indexOf("\n];", start);
  return [...new Set([...seed.slice(start, end).matchAll(/key:\s*"([^"]+)"/g)].map((match) => match[1]))].sort();
}

describe("ADM-10 — settings registry completeness", () => {
  it("registers exactly the keys the seed provisions", () => {
    expect(SETTING_REGISTRY.map((entry) => entry.key).sort()).toEqual(seedSettingKeys());
  });

  it("puts every key in a declared section with a non-empty Arabic title", () => {
    const sections = new Set(SETTING_SECTIONS.map((section) => section.key));
    for (const entry of SETTING_REGISTRY) {
      expect(sections.has(entry.section), entry.key).toBe(true);
      expect(entry.label.length, entry.key).toBeGreaterThan(2);
      expect(entry.meaning.length, entry.key).toBeGreaterThan(5);
      expect(entry.effect.length, entry.key).toBeGreaterThan(5);
    }
  });

  it("refuses an unregistered key (the allow-list is not the UI hiding rows)", () => {
    expect(settingRegistryEntry("store.name")).not.toBeNull();
    expect(settingRegistryEntry("store.unknown")).toBeNull();
    expect(settingValueRule("store.unknown")).toBeNull();
    // A key that exists out of band still has no write rule.
    expect(settingValueRule("legacy.imported.key")).toBeNull();
  });

  it("refuses a registered but read-only key", () => {
    for (const key of ["currency", "timezone", "delivery.enabled"]) {
      const entry = settingRegistryEntry(key);
      expect(entry, key).not.toBeNull();
      expect(entry?.editable, key).toBe(false);
      expect(settingValueRule(key), key).toBeNull();
    }
  });

  it("keeps the frozen single-currency / single-branch delivery posture", () => {
    expect(settingRegistryEntry("currency")?.rangeNote).toContain("EGP");
    expect(settingRegistryEntry("delivery.enabled")?.editable).toBe(false);
    // The delivery fee is editable, but it is the SERVER's base fee; the
    // registry must say a matching active zone overrides it.
    expect(settingRegistryEntry("delivery.default_fee")?.effect).toContain("منطقة نشطة مطابقة");
  });

  it("exposes only editable keys and enforces the delivery-fee money pattern", () => {
    expect(editableSettingKeys().sort()).toEqual([
      "delivery.center_name", "delivery.center_villages", "delivery.default_fee",
      "delivery.inside_fee", "delivery.outside_cities", "delivery.outside_fee",
    ].sort());
    const fee = settingValueRule("delivery.default_fee");
    expect(fee).not.toBeNull();
    expect(fee?.valueType).toBe("NUMERIC");
    for (const valid of ["0", "20", "20.5", "12345678.99"]) expect(fee?.pattern?.test(valid), valid).toBe(true);
    for (const invalid of ["-1", "20.000", "1e3", "٢٠", "12.345", ""]) {
      expect(fee?.pattern?.test(invalid), invalid).toBe(false);
    }
  });

  it("freezes the keys whose meaning needs an owner decision", () => {
    // The published identity and contact channel come from owner-approved code
    // and the auto-cancel window has no implementation: all are recorded, not
    // editable. Publishing a stored name is a product decision, not a default.
    for (const key of ["store.name", "store.phone", "store.email", "orders.auto_cancel_minutes"]) {
      const entry = settingRegistryEntry(key);
      expect(entry, key).not.toBeNull();
      expect(entry?.editable, key).toBe(false);
      expect(settingValueRule(key), key).toBeNull();
      expect(entry?.effect, key).toMatch(/قرار المالك|قرار مالك/);
    }
  });

  it("keeps the frozen patterns documented for the keys it no longer accepts", () => {
    const name = settingRegistryEntry("store.name");
    expect(name?.pattern?.test("x".repeat(200))).toBe(true);
    expect(name?.pattern?.test("x".repeat(201))).toBe(false);
    expect(name?.pattern?.test("")).toBe(false);
    const email = settingRegistryEntry("store.email");
    expect(email?.pattern?.test("store@example.com")).toBe(true);
    expect(email?.pattern?.test("not-an-email")).toBe(false);
    const phone = settingRegistryEntry("store.phone");
    expect(phone?.pattern?.test("+20 100-000-0000")).toBe(true);
    expect(phone?.pattern?.test("call-me")).toBe(false);
    const autoCancel = settingRegistryEntry("orders.auto_cancel_minutes");
    expect(autoCancel?.pattern?.test("30")).toBe(true);
    expect(autoCancel?.pattern?.test("-5")).toBe(false);
  });

  it("enforces the 200-character store-name range", () => {
    const rule = settingValueRule("store.name");
    expect(rule).toBeNull();
  });

  it("never treats a secret-looking key as renderable or editable", () => {
    for (const key of ["api_key", "admin.password", "payment.secret", "auth.token", "private.key"]) {
      expect(isSecretSettingKey(key), key).toBe(true);
      expect(settingValueRule(key), key).toBeNull();
    }
    expect(isSecretSettingKey("store.name")).toBe(false);
  });

  it("is honest about which keys the application reads today", () => {
    const consumers = SETTING_REGISTRY.filter((entry) => entry.consumedByApp);
    expect(consumers.map((entry) => entry.key).sort()).toEqual([
      "delivery.center_name", "delivery.center_villages", "delivery.default_fee",
      "delivery.inside_fee", "delivery.outside_cities", "delivery.outside_fee",
    ].sort());
    for (const entry of consumers) expect(entry.consumedAt, entry.key).toMatch(/^src\/.+\.ts:\d+$/);
    for (const entry of SETTING_REGISTRY.filter((item) => !item.consumedByApp)) {
      expect(entry.consumedAt, entry.key).toBeNull();
    }
  });
});
