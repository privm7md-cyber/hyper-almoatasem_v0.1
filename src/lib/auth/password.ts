import "server-only";
// Password hashing: Argon2id (OWASP first choice).
// Parameters (OWASP Password Storage minimums): memory 19 MiB (19456 KiB),
// iterations (timeCost) 2, parallelism 1. Salt is automatic and unique per
// password (argon2 embeds it in the encoded hash).
// Policy: 12..128 characters. The 128 cap keeps argon2 input bounded;
// the 12 floor is the admin password minimum (never weaken silently).
import argon2 from "argon2";

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

const ARGON2_OPTIONS = {
  type: argon2.argon2id as 2,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

// Constant dummy hash for the unknown-user path: a login for a nonexistent
// (or credential-less) account still runs a full Argon2 verification so its
// timing matches a real check. Generated once with the options above; the
// underlying secret is discarded and irrelevant — only the work factor matters.
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,p=1,t=2$WJGrqi8QQ33nNv4c2XvPDw$L4pl/JsvFS6MDHS5o+jUnZ93vRpRjwpuivswrU633y8";

export function checkPasswordPolicy(password: string): string | null {
  if (typeof password !== "string") return "كلمة المرور مطلوبة.";
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `كلمة المرور قصيرة (الحد الأدنى ${PASSWORD_MIN_LENGTH} حرفًا).`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `كلمة المرور طويلة (الحد الأقصى ${PASSWORD_MAX_LENGTH} حرفًا).`;
  }
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const policyError = checkPasswordPolicy(password);
  if (policyError) throw new Error(policyError);
  return argon2.hash(password, { ...ARGON2_OPTIONS });
}

// Returns true only on an exact match. argon2.verify resolves a boolean
// (it does NOT throw on mismatch) — callers must compare strictly.
// Note: verify takes no work-factor options; parameters come from the hash
// encoding itself (that's what makes future re-tuning backward compatible).
export async function verifyPassword(
  hash: string,
  password: string,
): Promise<boolean> {
  return argon2.verify(hash, password);
}

// Timing-equalizer for unknown/credential-less accounts. Runs the same work
// as a real verification; the result only tells "no credential matched".
export async function verifyDummyPassword(password: string): Promise<void> {
  await verifyPassword(DUMMY_HASH, password);
}
