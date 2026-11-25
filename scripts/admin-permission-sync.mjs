// ============================================================================
// ADMIN PERMISSION SYNC — read-only by default, idempotent, minimal writes.
//
// Derives permissions, role identities, and role grant policy directly from the
// repository's single sources of truth:
//   - `prisma/seed.mjs` (`ROLES`, `PERMISSIONS`, `STORE_ADMIN_EXCLUDED_KEYS`)
//   - `src/lib/admin/terminology.ts` (`PERMISSION_GROUPS`)
//
// Policy:
//   - SUPER_ADMIN: granted every catalogued/seeded permission explicitly.
//   - STORE_ADMIN: granted every catalogued/seeded permission EXCEPT those listed
//     in `STORE_ADMIN_EXCLUDED_KEYS` (e.g., `customers.anonymize` stays excluded).
//
// Usage:
//   node scripts/admin-permission-sync.mjs           -> DRY RUN (default, 0 writes)
//   node scripts/admin-permission-sync.mjs --apply   -> minimal INSERT-only sync
//
// Safety rules (all enforced below):
//   1. DRY RUN IS THE DEFAULT. `--apply` is required for any write.
//   2. Live database identity is asserted via `current_database()`, never env alone.
//   3. Cross-checks `prisma/seed.mjs` PERMISSIONS against `PERMISSION_GROUPS`
//      in `src/lib/admin/terminology.ts` before proposing any change.
//   4. Idempotent: existing matching rows/grants are no-ops; any id/description
//      drift or unauthorized grant triggers an explicit refusal (fail-closed).
//   5. INSERT-only: never deletes permissions, revokes grants, alters roles, or
//      touches users, passwords, or sessions.
// ============================================================================
import "dotenv/config";
import { Client } from "pg";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const APPROVED_DATABASES = ["hyper_almoatasem"];
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(MODULE_DIR, "..");

/**
 * @typedef {{ id: string, name: string, description: string, isActive: boolean }} SeedRole
 * @typedef {{ id: string, key: string, description: string }} SeedPermission
 * @typedef {{ role: string, key: string }} GrantPair
 */

/**
 * Parses `const PERMISSIONS = [...]` from `prisma/seed.mjs`.
 * @param {string} seedText
 * @returns {SeedPermission[]}
 */
export function sourcePermissions(seedText) {
  const start = seedText.indexOf("const PERMISSIONS");
  const end = seedText.indexOf("\n];", start);
  if (start === -1 || end === -1) {
    throw new Error("Unable to locate const PERMISSIONS in prisma/seed.mjs");
  }
  const block = seedText.slice(start, end);
  /** @type {SeedPermission[]} */
  const rows = [];
  const re = /\{\s*id:\s*"([^"]+)",\s*key:\s*"([^"]+)",\s*description:\s*"([^"]*)"\s*,?\s*\}/g;
  for (const match of block.matchAll(re)) {
    rows.push({ id: match[1], key: match[2], description: match[3] });
  }
  return rows;
}

/**
 * Parses `const ROLES = [...]` from `prisma/seed.mjs`.
 * @param {string} seedText
 * @returns {SeedRole[]}
 */
export function sourceRoles(seedText) {
  const start = seedText.indexOf("const ROLES");
  const end = seedText.indexOf("\n];", start);
  if (start === -1 || end === -1) {
    throw new Error("Unable to locate const ROLES in prisma/seed.mjs");
  }
  const block = seedText.slice(start, end);
  const re =
    /\{\s*id:\s*([A-Z0-9_]+),\s*name:\s*"([^"]+)",\s*description:\s*"([^"]+)",\s*isActive:\s*(true|false)\s*,?\s*\}/g;
  /** @type {SeedRole[]} */
  const roles = [];
  for (const match of block.matchAll(re)) {
    roles.push({
      id: match[1],
      name: match[2],
      description: match[3],
      isActive: match[4] === "true",
    });
  }
  if (roles.length === 0) {
    throw new Error("Parsed zero roles from const ROLES in prisma/seed.mjs");
  }
  return roles;
}

/**
 * Parses `const STORE_ADMIN_EXCLUDED_KEYS = [...]` from `prisma/seed.mjs`.
 * @param {string} seedText
 * @returns {string[]}
 */
export function storeAdminExclusions(seedText) {
  const start = seedText.indexOf("const STORE_ADMIN_EXCLUDED_KEYS");
  const end = seedText.indexOf("]", start);
  if (start === -1 || end === -1) {
    throw new Error("Unable to locate STORE_ADMIN_EXCLUDED_KEYS in prisma/seed.mjs");
  }
  return [...seedText.slice(start, end).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/**
 * Parses `export const PERMISSION_GROUPS` keys from `src/lib/admin/terminology.ts`.
 * @param {string} terminologyText
 * @returns {string[]}
 */
export function cataloguePermissionKeys(terminologyText) {
  const start = terminologyText.indexOf("export const PERMISSION_GROUPS");
  const end = terminologyText.indexOf("\n];", start);
  if (start === -1 || end === -1) {
    throw new Error("Unable to locate PERMISSION_GROUPS in src/lib/admin/terminology.ts");
  }
  const keys = [...terminologyText.slice(start, end).matchAll(/key:\s*"([^"]+)"/g)].map((m) => m[1]);
  return [...new Set(keys)].sort();
}

/**
 * Resolves the authoritative expected grants for a seeded role per role policy.
 * @param {string} roleName
 * @param {SeedPermission[]} permissions
 * @param {string[]} exclusions
 * @returns {SeedPermission[]}
 */
export function expectedGrantsForRole(roleName, permissions, exclusions) {
  if (roleName === "SUPER_ADMIN") {
    return permissions;
  }
  if (roleName === "STORE_ADMIN") {
    const excluded = new Set(exclusions);
    return permissions.filter((permission) => !excluded.has(permission.key));
  }
  throw new Error(`Unsupported seeded role for automatic permission grant policy: ${roleName}`);
}

/**
 * Reads and cross-validates the repository permission sources.
 * @param {string} [rootDir]
 */
export function loadSourceOfTruth(rootDir = REPO_ROOT) {
  const seedText = readFileSync(resolve(rootDir, "prisma/seed.mjs"), "utf8");
  const terminologyText = readFileSync(resolve(rootDir, "src/lib/admin/terminology.ts"), "utf8");

  const roles = sourceRoles(seedText);
  const permissions = sourcePermissions(seedText);
  const exclusions = storeAdminExclusions(seedText);
  const catalogueKeys = cataloguePermissionKeys(terminologyText);
  const seedKeys = [...new Set(permissions.map((p) => p.key))].sort();

  if (
    catalogueKeys.length !== seedKeys.length ||
    catalogueKeys.some((key, index) => key !== seedKeys[index])
  ) {
    throw new Error(
      `Source-of-truth mismatch between PERMISSION_GROUPS (${catalogueKeys.length}) and prisma/seed.mjs (${seedKeys.length})`,
    );
  }

  return { roles, permissions, exclusions };
}

/**
 * Computes the pure INSERT-only sync diff against live DB metadata.
 * @param {{
 *   permissions: SeedPermission[],
 *   exclusions: string[],
 *   seededRoles: SeedRole[],
 *   existingPermissions: Array<{ id: string, key: string, description: string }>,
 *   existingRoles: Array<{ id: string, name: string }>,
 *   existingGrants: GrantPair[]
 * }} input
 */
export function computePermissionSyncPlan({
  permissions,
  exclusions,
  seededRoles,
  existingPermissions,
  existingRoles,
  existingGrants,
}) {
  const existingByKey = new Map(existingPermissions.map((row) => [row.key, row]));
  const grantSet = new Set(existingGrants.map((row) => `${row.role}|${row.key}`));
  const excludedSet = new Set(exclusions);

  /** @type {SeedPermission[]} */
  const missingRows = [];
  /** @type {Array<{ key: string, expected: SeedPermission, found: { id: string, key: string, description: string } }>} */
  const driftedRows = [];

  for (const permission of permissions) {
    const found = existingByKey.get(permission.key);
    if (!found) {
      missingRows.push(permission);
    } else if (found.id !== permission.id || found.description !== permission.description) {
      driftedRows.push({ key: permission.key, expected: permission, found });
    }
  }

  /** @type {string[]} */
  const missingRoles = [];
  /** @type {Array<{ role: string, key: string, roleId: string, permissionId: string }>} */
  const missingGrants = [];
  /** @type {Record<string, number>} */
  const expectedGrantCountsByRole = {};

  for (const roleSpec of seededRoles) {
    const expectedList = expectedGrantsForRole(roleSpec.name, permissions, exclusions);
    expectedGrantCountsByRole[roleSpec.name] = expectedList.length;

    const liveRole = existingRoles.find((r) => r.name === roleSpec.name);
    if (!liveRole) {
      missingRoles.push(roleSpec.name);
      continue;
    }

    for (const permission of expectedList) {
      if (!grantSet.has(`${roleSpec.name}|${permission.key}`)) {
        missingGrants.push({
          role: roleSpec.name,
          key: permission.key,
          roleId: liveRole.id,
          permissionId: permission.id,
        });
      }
    }
  }

  const unauthorizedGrants = existingGrants.filter((row) => {
    if (row.role === "STORE_ADMIN" && excludedSet.has(row.key)) return true;
    if (row.key === "customers.anonymize" && row.role !== "SUPER_ADMIN") return true;
    return false;
  });

  return {
    missingRows,
    driftedRows,
    missingRoles,
    missingGrants,
    unauthorizedGrants,
    expectedGrantCountsByRole,
  };
}

async function runCli() {
  const apply = process.argv.includes("--apply");
  const { roles: seededRoles, permissions, exclusions } = loadSourceOfTruth(REPO_ROOT);

  console.log(
    JSON.stringify(
      {
        mode: apply ? "APPLY" : "DRY-RUN",
        sourcePermissions: permissions.length,
        storeAdminExclusions: exclusions,
        grantTargetRoles: seededRoles.map((r) => r.name),
      },
      null,
      2,
    ),
  );

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("PERMISSION_SYNC_DENIED: DATABASE_URL is missing.");
    process.exit(1);
  }

  const client = new Client({ connectionString, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();

    // Guard: the LIVE database name decides — never the environment alone.
    const metaRes = await client.query(`SELECT current_database() AS db, current_user AS usr`);
    const meta = metaRes.rows[0];
    console.log(JSON.stringify({ connectedDatabase: meta.db, connectedUser: meta.usr }, null, 2));
    if (!APPROVED_DATABASES.includes(meta.db)) {
      console.error(`PERMISSION_SYNC_DENIED: database ${meta.db} is not the approved target.`);
      await client.end();
      process.exit(1);
    }

    const existingPermissions = (
      await client.query(`SELECT id::text, key, description FROM permissions ORDER BY key`)
    ).rows;
    const existingRoles = (await client.query(`SELECT id::text, name FROM roles ORDER BY name`)).rows;
    const existingGrants = (
      await client.query(
        `SELECT r.name AS role, p.key AS key FROM role_permissions rp
           JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id
          ORDER BY r.name, p.key`,
      )
    ).rows;

    const plan = computePermissionSyncPlan({
      permissions,
      exclusions,
      seededRoles,
      existingPermissions,
      existingRoles,
      existingGrants,
    });

    const preview = {
      wouldInsertPermissions: plan.missingRows.map((p) => ({ id: p.id, key: p.key })),
      driftedPermissions: plan.driftedRows.map((d) => ({ key: d.key, expected: d.expected, found: d.found })),
      missingRoles: plan.missingRoles,
      wouldInsertGrants: plan.missingGrants.map((g) => ({ role: g.role, key: g.key })),
      unauthorizedGrantsPresent: plan.unauthorizedGrants,
      expectedTotals: {
        permissions: permissions.length,
        byRole: plan.expectedGrantCountsByRole,
      },
      neverTouched: [
        "users",
        "customer_sessions",
        "password hashes",
        "role identities",
        "existing grants",
        "existing permission rows (only missing keys are inserted)",
      ],
    };
    console.log("PREVIEW:\n" + JSON.stringify(preview, null, 2));

    if (!apply) {
      console.log(
        "DRY RUN ONLY: nothing was written. Re-run with --apply (after owner approval) to insert the missing rows.",
      );
      await client.end();
      process.exit(0);
    }

    if (
      plan.driftedRows.length > 0 ||
      plan.unauthorizedGrants.length > 0 ||
      plan.missingRoles.length > 0
    ) {
      console.error("PERMISSION_SYNC_REFUSED: drift, missing role, or unauthorized grant detected before --apply.");
      await client.end();
      process.exit(1);
    }

    // --- APPLY (minimal, idempotent, one transaction) -------------------------
    await client.query("BEGIN");
    try {
      for (const permission of plan.missingRows) {
        await client.query(
          `INSERT INTO permissions (id, key, description) VALUES ($1::uuid, $2, $3)
             ON CONFLICT (id) DO NOTHING`,
          [permission.id, permission.key, permission.description],
        );
      }
      for (const grant of plan.missingGrants) {
        await client.query(
          `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1::uuid, $2::uuid)
             ON CONFLICT DO NOTHING`,
          [grant.roleId, grant.permissionId],
        );
      }
      await client.query("COMMIT");
      console.log(
        "APPLIED: " +
          JSON.stringify({
            insertedPermissions: plan.missingRows.length,
            insertedGrants: plan.missingGrants.length,
          }),
      );
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      const msg = error instanceof Error ? error.message : String(error);
      console.error("PERMISSION_SYNC_FAILED (rolled back): " + msg);
      process.exitCode = 1;
    } finally {
      await client.end();
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("PERMISSION_SYNC_UNAVAILABLE: " + msg);
    console.error(
      "The database is not reachable. Nothing was written. Start the approved service and re-run the DRY RUN first.",
    );
    process.exitCode = 2;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await runCli();
}
