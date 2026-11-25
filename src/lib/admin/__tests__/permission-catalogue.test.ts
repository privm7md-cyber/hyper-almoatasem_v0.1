// @vitest-environment node
// ADM-OWNER G4 — the permission catalogue is the single source of truth.
//
// The owner asked to verify the previously reported drift (32 permission keys
// in the code against 31 granted to the owner, with `customers.manage`
// missing). This test proves what CAN be proven at the source level:
//   • the admin catalogue and the seed provision EXACTLY the same keys
//   • every key the code enforces is in the catalogue
//   • every key has an Arabic label for the operator
//   • the keys that are provisioned but not yet enforced are named, so a
//     future capability cannot be mistaken for a granted one
//
// What this test CANNOT prove (and must not claim): the state of the live
// database. The database is the owner's environment; the drift between the
// catalogue and the live `permissions` table is reported by the admin
// permissions screen (read-only) and by the idempotent seed step.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  computePermissionSyncPlan,
  expectedGrantsForRole,
  loadSourceOfTruth,
} from "../../../../scripts/admin-permission-sync.mjs";
import { PERMISSION_GROUPS, permissionLabel } from "@/lib/admin/terminology";
import {
  PERMISSION_CAPABILITIES,
  isSensitivePermission,
  permissionCapability,
  permissionDescription,
} from "@/lib/admin/terminology";

const ROOT = resolve(__dirname, "../../../..");

function seedPermissionKeys(): string[] {
  const seed = readFileSync(resolve(ROOT, "prisma/seed.mjs"), "utf8");
  const start = seed.indexOf("const PERMISSIONS");
  const end = seed.indexOf("\n];", start);
  const keys = [...seed.slice(start, end).matchAll(/key:\s*"([^"]+)"/g)].map((match) => match[1]);
  return [...new Set(keys)].sort();
}

function catalogueKeys(): string[] {
  return [
    ...new Set(PERMISSION_GROUPS.flatMap((group) => group.permissions.map((p) => p.key))),
  ].sort();
}

describe("G4 — the permission catalogue", () => {
  it("the admin catalogue and the seed provision exactly the same keys", () => {
    expect(catalogueKeys()).toEqual(seedPermissionKeys());
  });

  it("the catalogue holds 33 distinct keys (32 + the owner-approved anonymization capability)", () => {
    expect(catalogueKeys()).toHaveLength(33);
  });

  it("`customers.anonymize` is a catalogue key and is granted to SUPER_ADMIN only", () => {
    expect(catalogueKeys()).toContain("customers.anonymize");
    const seed = readFileSync(resolve(ROOT, "prisma/seed.mjs"), "utf8");
    expect(seed).toContain('key: "customers.anonymize"');
    // It is excluded from STORE_ADMIN: only SUPER_ADMIN holds it by default.
    const excluded = seed.slice(seed.indexOf("const STORE_ADMIN_EXCLUDED_KEYS"));
    expect(excluded.slice(0, excluded.indexOf("];")).length).toBeGreaterThan(0);
    expect(excluded.slice(0, excluded.indexOf("];")).includes('"customers.anonymize"')).toBe(true);
  });

  it("the seed's expected counts match the new permission set", () => {
    const seed = readFileSync(resolve(ROOT, "prisma/seed.mjs"), "utf8");
    expect(seed).toContain("permissions: 33");
    // 33 for SUPER_ADMIN + 25 for STORE_ADMIN (33 minus the 8 exclusions).
    expect(seed).toContain("rolePermissions: 58");
  });

  it("`customers.manage` is a catalogue key (the one the previous review found missing)", () => {
    expect(catalogueKeys()).toContain("customers.manage");
    // The seed grants it to the two business roles (SUPER_ADMIN + STORE_ADMIN).
    const seed = readFileSync(resolve(ROOT, "prisma/seed.mjs"), "utf8");
    expect(seed).toContain('key: "customers.manage"');
  });

  it("every key has an Arabic label the operator can read", () => {
    for (const key of catalogueKeys()) {
      const label = permissionLabel(key);
      expect(label.length, key).toBeGreaterThan(3);
      expect(label, key).not.toBe(key);
    }
  });

  it("the formerly unbound keys are now enforced (E-3 closure), not merely provisioned", () => {
    // E-3: these four were provisioned by the seed and displayed in the UI
    // while nothing in the code consumed them. They are now bound to a real
    // server-side gate; `permission-enforcement.test.ts` proves the binding
    // from the source, and the live suites prove it over HTTP.
    for (const key of ["delivery.view", "delivery.assign", "notifications.view", "reports.view"]) {
      expect(catalogueKeys()).toContain(key);
    }
  });

  it("the write capabilities the policies need are catalogued", () => {
    // The three owner policies need these three gates to exist and to be
    // separate from the read capabilities.
    for (const key of ["products.delete", "customers.manage", "customers.anonymize", "promotions.update"]) {
      expect(catalogueKeys()).toContain(key);
    }
    // `customers.manage` must NOT imply `customers.anonymize`: they are two
    // different capabilities with different severities.
    expect(catalogueKeys()).not.toContain("customers.delete");
    expect(catalogueKeys().includes("customers.manage")).toBe(true);
    expect(catalogueKeys().includes("customers.anonymize")).toBe(true);
  });
});

describe("ADM-09 — capability, description and sensitivity for every key", () => {
  const capabilityKeys = PERMISSION_CAPABILITIES.map((entry) => entry.key);

  it("gives every catalogued key a capability from the frozen vocabulary", () => {
    for (const key of catalogueKeys()) {
      const capability = permissionCapability(key);
      expect(capability, key).not.toBeNull();
      expect(capabilityKeys, key).toContain(capability);
    }
  });

  it("gives every key a real Arabic explanation that is not its label", () => {
    for (const key of catalogueKeys()) {
      const description = permissionDescription(key);
      expect(description.length, key).toBeGreaterThan(10);
      expect(description, key).not.toBe(key);
      expect(description, key).not.toBe("صلاحية غير معروفة.");
      expect(description, key).not.toBe(permissionLabel(key));
    }
  });

  it("marks the owner-locked sensitive capabilities as sensitive", () => {
    for (const key of [
      "customers.anonymize",
      "products.delete",
      "prices.view",
      "prices.update",
      "roles.manage",
      "users.manage",
      "settings.manage",
      "audit_logs.view",
    ]) {
      expect(isSensitivePermission(key), key).toBe(true);
    }
    // Editing customer data is a write capability, but it is deliberately NOT
    // the irreversible anonymization and is not marked as the same severity.
    expect(isSensitivePermission("customers.manage")).toBe(false);
  });

  it("does not mark ordinary read-only catalogue keys as sensitive", () => {
    for (const key of ["products.view", "categories.view", "inventory.view", "orders.view", "coupons.view"]) {
      expect(isSensitivePermission(key), key).toBe(false);
    }
  });

  it("keeps definition separate from activation: a catalogue entry alone is not a grant", () => {
    // Source-level statement of the boundary the UI must preserve: the
    // catalogue has no `granted` field, so rendering a key cannot imply it is
    // active. Actual activation is computed by `effective-permissions.ts`
    // from the database graph (tested separately).
    for (const group of PERMISSION_GROUPS) {
      for (const permission of group.permissions) {
        expect(permission).not.toHaveProperty("granted");
        expect(permission).not.toHaveProperty("active");
      }
    }
  });
});

describe("G4b — admin-permission-sync role grant policy & dry-run plan", () => {
  const truth = loadSourceOfTruth(ROOT);

  it("derives role grants directly from seed policy without hardcoding a single role or magic count", () => {
    const roleNames = truth.roles.map((role) => role.name);
    expect(roleNames).toEqual(["SUPER_ADMIN", "STORE_ADMIN"]);

    const superKeys = expectedGrantsForRole("SUPER_ADMIN", truth.permissions, truth.exclusions).map((p) => p.key);
    const storeKeys = expectedGrantsForRole("STORE_ADMIN", truth.permissions, truth.exclusions).map((p) => p.key);

    expect(superKeys).toEqual(truth.permissions.map((p) => p.key));
    expect(storeKeys).toContain("customers.manage");
    expect(storeKeys).not.toContain("customers.anonymize");
    for (const excludedKey of truth.exclusions) {
      expect(storeKeys).not.toContain(excludedKey);
    }
    expect(storeKeys).toHaveLength(truth.permissions.length - truth.exclusions.length);
  });

  it("proposes the exact 2 permissions and 3 grants when live DB sits at 31 / 31 / 24", () => {
    const baselinePerms = truth.permissions.filter(
      (p) => p.key !== "customers.manage" && p.key !== "customers.anonymize",
    );
    const excludedSet = new Set(truth.exclusions);
    const existingGrants = [
      ...baselinePerms.map((p) => ({ role: "SUPER_ADMIN", key: p.key })),
      ...baselinePerms.filter((p) => !excludedSet.has(p.key)).map((p) => ({ role: "STORE_ADMIN", key: p.key })),
    ];
    const plan = computePermissionSyncPlan({
      permissions: truth.permissions,
      exclusions: truth.exclusions,
      seededRoles: truth.roles,
      existingPermissions: baselinePerms,
      existingRoles: [
        { id: "role-super", name: "SUPER_ADMIN" },
        { id: "role-store", name: "STORE_ADMIN" },
      ],
      existingGrants,
    });

    expect(plan.driftedRows).toEqual([]);
    expect(plan.unauthorizedGrants).toEqual([]);
    expect(plan.missingRoles).toEqual([]);
    expect(plan.missingRows.map((p) => p.key)).toEqual(["customers.manage", "customers.anonymize"]);
    expect(plan.missingGrants.map((g) => `${g.role}->${g.key}`)).toEqual([
      "SUPER_ADMIN->customers.manage",
      "SUPER_ADMIN->customers.anonymize",
      "STORE_ADMIN->customers.manage",
    ]);
    expect(plan.expectedGrantCountsByRole).toEqual({ SUPER_ADMIN: 33, STORE_ADMIN: 25 });
  });

  it("is strictly idempotent once DB reaches 33 / 33 / 25", () => {
    const excludedSet = new Set(truth.exclusions);
    const existingGrants = [
      ...truth.permissions.map((p) => ({ role: "SUPER_ADMIN", key: p.key })),
      ...truth.permissions.filter((p) => !excludedSet.has(p.key)).map((p) => ({ role: "STORE_ADMIN", key: p.key })),
    ];
    const plan = computePermissionSyncPlan({
      permissions: truth.permissions,
      exclusions: truth.exclusions,
      seededRoles: truth.roles,
      existingPermissions: truth.permissions,
      existingRoles: [
        { id: "role-super", name: "SUPER_ADMIN" },
        { id: "role-store", name: "STORE_ADMIN" },
      ],
      existingGrants,
    });

    expect(plan.missingRows).toEqual([]);
    expect(plan.missingGrants).toEqual([]);
    expect(plan.driftedRows).toEqual([]);
    expect(plan.unauthorizedGrants).toEqual([]);
  });

  it("flags an unauthorized STORE_ADMIN anonymize grant before apply", () => {
    const plan = computePermissionSyncPlan({
      permissions: truth.permissions,
      exclusions: truth.exclusions,
      seededRoles: truth.roles,
      existingPermissions: truth.permissions,
      existingRoles: [
        { id: "role-super", name: "SUPER_ADMIN" },
        { id: "role-store", name: "STORE_ADMIN" },
      ],
      existingGrants: [{ role: "STORE_ADMIN", key: "customers.anonymize" }],
    });

    expect(plan.unauthorizedGrants).toEqual([{ role: "STORE_ADMIN", key: "customers.anonymize" }]);
  });
});
