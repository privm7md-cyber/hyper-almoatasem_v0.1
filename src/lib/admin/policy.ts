// BA-9 admin policy primitives (pure, no DB, no server-only).
//
// SUPER_ADMIN-row identity plus the settings value-type mirror live here
// so plain-node unit tests can import them without the server-only data
// layer (writes.ts maps violations to API errors).
// Importable under plain-node tests (no imports at all).

/** Frozen platform-role identity (seed-fixed name; renames/deletes denied). */
export const SUPER_ADMIN_ROLE = "SUPER_ADMIN";

/**
 * Money-valued settings use the SAME wire shape as delivery zones and the
 * checkout contract: non-negative, at most two decimals, bounded by
 * NUMERIC(10,2). Pure so the boundary tests can import it without DB/server.
 */
export const MONEY_SETTING_KEYS = new Set([
  "delivery.default_fee",
  "delivery.inside_fee",
  "delivery.outside_fee",
]);
export const MONEY_SETTING_TEXT_RE = /^\d{1,8}(\.\d{1,2})?$/;

/** Mirror of the frozen chk_settings_typed branches (DB CHECK enforces). */
export function isSettingValueValid(valueType: string, value: string): boolean {
  if (valueType === "BOOLEAN") return value === "true" || value === "false";
  if (valueType === "INTEGER") return /^-?[0-9]+$/.test(value);
  if (valueType === "NUMERIC") return /^-?[0-9]+(\.[0-9]+)?$/.test(value);
  if (valueType === "TEXT") return true;
  if (valueType === "JSON") {
    try {
      JSON.parse(value);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}
