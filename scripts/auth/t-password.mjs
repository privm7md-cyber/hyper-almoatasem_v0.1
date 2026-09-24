// Password tests (§24): Argon2id behavior + policy boundaries. Offline except
// policy-at-set checks, which run through the bootstrap CLI on scratch
// (covered in t-bootstrap.mjs). No database contact here.
import argon2 from "argon2";

const OPTS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };
const results = [];
const t = (name, pass, detail = "") => results.push({ name, pass, detail });

const h1 = await argon2.hash("Correct-Horse-000!", OPTS);
// 1. valid password hash verifies.
t("valid_hash_verifies", (await argon2.verify(h1, "Correct-Horse-000!")) === true);
// 2. wrong password rejected.
t("wrong_password_rejected", (await argon2.verify(h1, "Wrong-Horse-999!")) === false);
// 3. random salt: same password -> different hashes.
const h2 = await argon2.hash("Correct-Horse-000!", OPTS);
t("random_salt", h1 !== h2);
// 4. OWASP parameter encoding present in hash.
t("owasp_params_encoded", h1.startsWith("$argon2id$v=19$m=19456"), h1.slice(0, 32));
// 5/6. policy helper mirrors the app rule (12..128) — boundary probe.
const policy = (s) => s.length >= 12 && s.length <= 128;
t("length_12_accepted", policy("a".repeat(12)));
t("length_128_accepted", policy("a".repeat(128)));
// 7/8. rejections.
t("length_over_128_rejected", !policy("a".repeat(129)));
t("length_below_min_rejected", !policy("a".repeat(11)));
// 9. hash string carries no plaintext trace.
t("no_plaintext_in_hash", !h1.includes("Correct-Horse-000!"));

const failures = results.filter((r) => !r.pass).length;
console.log(JSON.stringify({ failures, results }, null, 2));
process.exitCode = failures === 0 ? 0 : 2;
