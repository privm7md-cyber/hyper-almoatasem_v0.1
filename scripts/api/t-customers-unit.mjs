// BA-4 customer unit tests (no database, no server, no secrets).
// Run: node scripts/api/t-customers-unit.mjs
// Covers: R8 identity ladder vectors, canonical equivalence, contact
// (landline passthrough + mobile canonicalization), Zod boundary shapes
// (strict objects, explicit booleans, email normalization, no governorate).
import { register } from "node:module";
register("./ts-resolve-hook.mjs", import.meta.url);
const [{ normalizeIdentityPhone, isIdentityPhone, normalizeContactPhone, isContactPhone }] = await Promise.all([
  import("../../src/lib/customers/phone.ts"),
]);
const validation = await import("../../src/lib/customers/validation.ts");
const { orderLockIds } = await import("../../src/lib/api/concurrency.ts");

const results = [];
const t = (name, pass, detail = "") => results.push({ name, pass: pass === true, detail });
const done = (code) => {
  const failures = results.filter((r) => !r.pass);
  console.log(JSON.stringify({ suite: "customers-unit", total: results.length, failures: failures.length, failed: failures.map((f) => f.name), passed: results.filter((r) => r.pass).map((r) => r.name) }, null, 2));
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

// --- R8 identity ladder (frozen vectors) ---
t("ladder-010", normalizeIdentityPhone("01012345678") === "201012345678");
t("ladder-plus-20", normalizeIdentityPhone("+201012345678") === "201012345678");
t("ladder-00-drop", normalizeIdentityPhone("00201012345678") === "201012345678");
t("ladder-canonical", normalizeIdentityPhone("201012345678") === "201012345678");
t("ladder-equivalence", ["01012345678", "+201012345678", "00201012345678", "201012345678"]
  .every((raw) => normalizeIdentityPhone(raw) === "201012345678"));
t("ladder-011-012-015", normalizeIdentityPhone("01122223333") === "201122223333"
  && normalizeIdentityPhone("01233334444") === "201233334444"
  && normalizeIdentityPhone("01544445555") === "201544445555");
t("ladder-spaces-dashes", normalizeIdentityPhone("010 1234 5678") === "201012345678"
  && normalizeIdentityPhone("010-1234-5678") === "201012345678");
t("ladder-reject-short", throws(() => normalizeIdentityPhone("123")));
t("ladder-reject-empty", throws(() => normalizeIdentityPhone("")));
t("ladder-reject-letters", throws(() => normalizeIdentityPhone("abc123")));
t("ladder-reject-prefix-014", throws(() => normalizeIdentityPhone("01412345678")));
t("ladder-reject-prefix-019", throws(() => normalizeIdentityPhone("01912345678")));
t("ladder-reject-foreign", throws(() => normalizeIdentityPhone("+14155552671")));
t("ladder-reject-10digit-non1", throws(() => normalizeIdentityPhone("2012345678")));
t("ladder-reject-13digits", throws(() => normalizeIdentityPhone("2010123456789")));
t("is-identity-bool", isIdentityPhone("01012345678") === true && isIdentityPhone("abc") === false);

// --- contact ladder (mobile canonicalizes, landline passes stripped) ---
t("contact-mobile-canonical", normalizeContactPhone("01012345678") === "201012345678"
  && normalizeContactPhone("+201012345678") === "201012345678");
t("contact-landline-passthrough", normalizeContactPhone("0223456789") === "0223456789"
  && normalizeContactPhone("02-23456789") === "0223456789");
t("contact-reject-short", throws(() => normalizeContactPhone("1234567")));
t("contact-reject-long", throws(() => normalizeContactPhone("1234567890123456")));
t("contact-reject-empty", throws(() => normalizeContactPhone("   ")));
t("is-contact-bool", isContactPhone("0223456789") === true && isContactPhone("12") === false);

// --- boundary schemas ---
const { identifyInputSchema, adminCustomerListQuerySchema, customerPatchSchema, registerInputSchema, addressInputSchema, addressPatchSchema } = validation;
t("identify-ok", identifyInputSchema.safeParse({ phone: "01012345678", firstName: "Mohamed" }).success);
t("identify-blank-phone-400", !identifyInputSchema.safeParse({ phone: "   ", firstName: "M" }).success);
t("identify-missing-name-400", !identifyInputSchema.safeParse({ phone: "01012345678" }).success);
t("identify-strict-unknown", !identifyInputSchema.safeParse({ phone: "01012345678", firstName: "M", governorate: "Cairo" }).success);
t("identify-no-coerce-number", !identifyInputSchema.safeParse({ phone: 1012345678, firstName: "M" }).success);
t("address-requires-city-phone", addressInputSchema.safeParse({ city: "Cairo", phone: "01012345678" }).success
  && !addressInputSchema.safeParse({ phone: "01012345678" }).success
  && !addressInputSchema.safeParse({ city: "Cairo" }).success);
t("address-no-governorate", !addressInputSchema.safeParse({ city: "Cairo", phone: "01012345678", governorate: "Giza" }).success);
t("address-no-geo", !addressInputSchema.safeParse({ city: "Cairo", phone: "01012345678", latitude: 30.1 }).success
  && !addressInputSchema.safeParse({ city: "Cairo", phone: "01012345678", postalCode: "12345" }).success);
t("address-arabic-ok", addressInputSchema.safeParse({ city: "القاهرة", street: "شارع عباس العقاد", phone: "01012345678", landmark: "بجوار سيتي سنتر" }).success);
t("address-blank-city-400", !addressInputSchema.safeParse({ city: "   ", phone: "01012345678" }).success);
t("address-length-caps", !addressInputSchema.safeParse({ city: "x".repeat(81), phone: "01012345678" }).success
  && !addressInputSchema.safeParse({ city: "Cairo", phone: "01012345678", buildingNumber: "x".repeat(31) }).success);
t("address-patch-partial", addressPatchSchema.safeParse({ city: "Giza" }).success
  && addressPatchSchema.safeParse({}).success
  && !addressPatchSchema.safeParse({ governorate: "Giza" }).success);
t("register-shape", registerInputSchema.safeParse({ password: "x".repeat(12) }).success
  && !registerInputSchema.safeParse({}).success
  && !registerInputSchema.safeParse({ password: 123456789012 }).success);
t("email-normalizes", (() => {
  const r = validation.emailSchema.safeParse("  Sara.Ahmed@Example.COM ");
  return r.success && r.data === "sara.ahmed@example.com";
})());
t("email-rejects", !validation.emailSchema.safeParse("not-an-email").success
  && !validation.emailSchema.safeParse("has space@x.com").success);
t("patch-email-nullable", customerPatchSchema.safeParse({ email: null }).success
  && customerPatchSchema.safeParse({ email: "A@X.COM" }).success);
t("list-bool-explicit", (() => {
  const ok = adminCustomerListQuerySchema.safeParse({ registered: "true", active: "false" });
  const bad = adminCustomerListQuerySchema.safeParse({ registered: true });
  return ok.success && !bad.success;
})());
t("lock-order-asc", JSON.stringify(orderLockIds(["b", "a"])) === JSON.stringify(["a", "b"]));

done();
