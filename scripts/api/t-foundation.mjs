// BA-1 foundation unit tests (no database, no server, no secrets).
// Run: node scripts/api/t-foundation.mjs
// Style mirrors scripts/auth/t-*.mjs: JSON results, exit 2 on failure.
import { register } from "node:module";
register("./ts-resolve-hook.mjs", import.meta.url);
const [{ ApiError, businessRule, conflict, normalizeError },
  { statusForCode },
  { ok, created, fail },
  validation,
  { decideIdempotentWrite, idempotencyConflictError },
  { orderLockIds, isConcurrencyConflict },
  { sanitizeLogFields }] = await Promise.all([
  import("../../src/lib/api/errors.ts"),
  import("../../src/lib/api/http-status.ts"),
  import("../../src/lib/api/respond.ts"),
  import("../../src/lib/api/validation.ts"),
  import("../../src/lib/api/idempotency.ts"),
  import("../../src/lib/api/concurrency.ts"),
  import("../../src/lib/api/log.ts"),
]);
const { uuidSchema, strictObject, idempotencyKeySchema, quantitySchema, paginationSchema } = validation;

const results = [];
const t = (name, pass, detail = "") => results.push({ name, pass: pass === true, detail });

// --- errors ---
t("business-rule-shape", (() => { const e = businessRule("No stock."); return e instanceof ApiError && e.code === "BUSINESS_RULE" && e.retryable === false; })());
t("conflict-retryable", (() => { const e = conflict("Race."); return e.code === "CONFLICT" && e.retryable === true; })());
t("normalize-passthrough", (() => { const e = businessRule("x"); return normalizeError(e) === e; })());
t("normalize-unknown-safe", (() => {
  const e = normalizeError(new Error("db connection string postgres://x SELECT * FROM users stack"));
  return e.code === "INTERNAL" && e.message === "Unexpected error.";
})());

// --- status mapping (extends, never contradicts, existing 400/401/403) ---
const expected = { VALIDATION: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, BUSINESS_RULE: 422, RATE_LIMITED: 429, INTERNAL: 500 };
t("status-mapping", Object.entries(expected).every(([c, s]) => statusForCode(c) === s));

// --- envelopes ---
t("ok-envelope", (() => { const r = ok({ a: 1 }, { page: 1 }); return r.status === 200 && r.body.data.a === 1 && r.body.meta.page === 1; })());
t("created-envelope", (() => ok({}).status === 200 && created({}).status === 201)());
t("fail-envelope", (() => {
  const r = fail(businessRule("Bad weight.", { step: 125 }));
  return r.status === 422 && r.body.error.code === "BUSINESS_RULE" && r.body.error.details.step === 125;
})());
t("fail-unknown-500-generic", (() => {
  const r = fail(new Error("secret password_hash leak SELECT"));
  return r.status === 500 && r.body.error.message === "Unexpected error." && !JSON.stringify(r.body).includes("password_hash");
})());

// --- validation primitives ---
t("uuid-accept", uuidSchema.safeParse("02800000-0000-7000-8000-000000000001").success);
t("uuid-reject", !uuidSchema.safeParse("not-a-uuid").success);
t("strict-rejects-unknown", !strictObject({ a: uuidSchema }).safeParse({ a: "02800000-0000-7000-8000-000000000001", b: 1 }).success);
t("strict-accepts-known", strictObject({ a: uuidSchema }).safeParse({ a: "02800000-0000-7000-8000-000000000001" }).success);
t("idemkey-accept", idempotencyKeySchema.safeParse("550e8400-e29b-41d4-a716-446655440000").success);
t("idemkey-reject-space", !idempotencyKeySchema.safeParse("has space").success);
t("idemkey-reject-empty", !idempotencyKeySchema.safeParse("").success);
t("quantity-accept", quantitySchema.safeParse("0.125").success && quantitySchema.safeParse("2").success);
t("quantity-reject", !quantitySchema.safeParse("0").success && !quantitySchema.safeParse("-1").success && !quantitySchema.safeParse("0.0001").success);
t("pagination-bounds", (() => {
  const p = paginationSchema.parse({});
  const over = paginationSchema.safeParse({ limit: 500 });
  const under = paginationSchema.safeParse({ limit: 0 });
  return p.limit === 20 && !over.success && !under.success;
})());

// --- idempotency decisions ---
t("idem-proceed", decideIdempotentWrite(null, "fp1").outcome === "proceed");
t("idem-replay", (() => { const d = decideIdempotentWrite({ fingerprint: "fp1" }, "fp1"); return d.outcome === "replay"; })());
t("idem-conflict", (() => { const d = decideIdempotentWrite({ fingerprint: "fp1" }, "fp2"); return d.outcome === "conflict"; })());
t("idem-conflict-throws-409", (() => {
  try { idempotencyConflictError(); return false; }
  catch (e) { return e instanceof ApiError && e.code === "CONFLICT"; }
})());

// --- concurrency primitives ---
t("lock-order-deterministic", (() => {
  const a = orderLockIds(["c", "a", "b", "a"]);
  return JSON.stringify(a) === JSON.stringify(["a", "b", "c"]);
})());
t("conflict-classifier", isConcurrencyConflict({ code: "40P01" }) && isConcurrencyConflict({ code: "40001" }) && !isConcurrencyConflict({ code: "23505" }) && !isConcurrencyConflict(null));

// --- log redaction ---
t("log-redact-secrets", (() => {
  const clean = sanitizeLogFields({ orderId: "abc", password: "x", password_hash: "y", token: "z", DATABASE_URL: "u", userAgent: "ua" });
  return clean.orderId === "abc" && clean.userAgent === "ua" && !("password" in clean) && !("password_hash" in clean) && !("token" in clean) && !("DATABASE_URL" in clean);
})());

const failures = results.filter((r) => !r.pass);
console.log(JSON.stringify({ suite: "api-foundation", total: results.length, failures: failures.length, failed: failures.map((f) => f.name) }, null, 2));
process.exitCode = failures.length === 0 ? 0 : 2;
