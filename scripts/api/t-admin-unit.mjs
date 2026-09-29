// BA-9 admin unit tests (no database, no server, no secrets).
// Run: node scripts/api/t-admin-unit.mjs
// Covers: settings type-mirror (frozen CHECK branches), SUPER_ADMIN guard
// identity, query booleans, boundary shapes (strict, email/phone/role
// formats, no invented fields).
import { register } from "node:module";
register("./ts-resolve-hook.mjs", import.meta.url);
const [{ isSettingValueValid, SUPER_ADMIN_ROLE }] = await Promise.all([
  import("../../src/lib/admin/policy.ts"),
]);
const validation = await import("../../src/lib/admin/validation.ts");

const results = [];
const t = (name, pass, detail = "") => results.push({ name, pass: pass === true, detail });
const done = (code) => {
  const failures = results.filter((r) => !r.pass);
  console.log(JSON.stringify({ suite: "admin-unit", total: results.length, failures: failures.length, failed: failures.map((f) => f.name), passed: results.filter((r) => r.pass).map((r) => r.name) }, null, 2));
  process.exitCode = code ?? (failures.length === 0 ? 0 : 2);
};
const throws = (fn) => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};
const accepts = (type, value) => isSettingValueValid(type, value);

// --- settings type mirror (frozen chk_settings_typed branches) ---
t("setting-boolean", accepts("BOOLEAN", "true") && accepts("BOOLEAN", "false") && !accepts("BOOLEAN", "yes"));
t("setting-integer", accepts("INTEGER", "30") && accepts("INTEGER", "-5") && !accepts("INTEGER", "20.00") && !accepts("INTEGER", "abc"));
t("setting-numeric", accepts("NUMERIC", "20.00") && accepts("NUMERIC", "-3.5") && !accepts("NUMERIC", "abc"));
t("setting-text", accepts("TEXT", "anything at all 123 !"));
t("setting-json", accepts("JSON", '{"a":1}') && accepts("JSON", "[1,2]") && !accepts("JSON", "{oops"));
t("setting-unknown-type", !accepts("BOGUS", "x"));

// --- SUPER_ADMIN identity ---
t("super-admin-name", SUPER_ADMIN_ROLE === "SUPER_ADMIN");

// --- boundaries ---
const { userInputSchema, userPatchSchema, userPasswordSchema, roleInputSchema, rolePatchSchema,
  settingPatchSchema, auditListQuerySchema, permissionListQuerySchema, userListQuerySchema } = validation;
t("user-create-shape", userInputSchema.safeParse({ name: "Ops", email: "Ops@X.com" }).success);
t("user-email-normalizes", (() => {
  const r = validation.adminEmailSchema.safeParse("Ops@X.COM ");
  return r.success && r.data === "ops@x.com";
})());
t("user-email-rejects", !validation.adminEmailSchema.safeParse("nope").success
  && !validation.adminEmailSchema.safeParse("has space@x.com").success);
t("user-phone-shape", validation.adminPhoneSchema.safeParse("201012345678").success
  && !validation.adminPhoneSchema.safeParse("+201012345678").success
  && !validation.adminPhoneSchema.safeParse("abc").success);
t("user-create-strict", !userInputSchema.safeParse({ name: "O", email: "o@x.com", passwordHash: "x" }).success
  && !userInputSchema.safeParse({ name: "O" }).success);
t("user-patch-partial", userPatchSchema.safeParse({ isActive: false }).success
  && userPatchSchema.safeParse({}).success
  && !userPatchSchema.safeParse({ isActive: "false" }).success);
t("user-password-shape", userPasswordSchema.safeParse({ password: "x".repeat(12) }).success
  && !userPasswordSchema.safeParse({}).success
  && !userPasswordSchema.safeParse({ password: 123456789012 }).success);
t("role-name-shape", validation.roleNameSchema.safeParse("SUPPORT").success
  && !validation.roleNameSchema.safeParse("has space").success
  && !validation.roleNameSchema.safeParse("").success);
t("role-create-strict", roleInputSchema.safeParse({ name: "SUPPORT" }).success
  && !roleInputSchema.safeParse({ name: "SUPPORT", permissions: ["x"] }).success);
t("role-patch-nullable", rolePatchSchema.safeParse({ description: null }).success);
t("setting-patch-shape", settingPatchSchema.safeParse({ value: "30" }).success
  && !settingPatchSchema.safeParse({}).success
  && !settingPatchSchema.safeParse({ value: 30 }).success
  && !settingPatchSchema.safeParse({ value: "x", key: "y" }).success);
t("audit-query-shape", auditListQuerySchema.safeParse({ action: "users.create" }).success
  && auditListQuerySchema.safeParse({ since: "2026-01-01T00:00:00.000Z" }).success
  && !auditListQuerySchema.safeParse({ since: "yesterday" }).success
  && !auditListQuerySchema.safeParse({ limit: 500 }).success);
t("list-bool-explicit", (() => {
  const ok = userListQuerySchema.safeParse({ active: "true" });
  const bad = userListQuerySchema.safeParse({ active: true });
  return ok.success && !bad.success;
})());
t("permission-search", permissionListQuerySchema.safeParse({ search: "orders" }).success);
t("throws-helper", throws(() => { throw new Error("x"); }) && !throws(() => {}));

done();
