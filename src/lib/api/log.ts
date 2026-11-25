// Shared structured server logging (BA-1 foundation).
//
// Debuggability without secret leakage. Values are allowlisted per event;
// keys that can carry secrets are dropped centrally, never by callers.
// Never logs: passwords, hashes, raw tokens, cookies, DATABASE_URL, API keys,
// full customer PII beyond operational need. Console-only (Vercel logs +
// audit_logs cover persistence); no new platform.
//
// The drop-list is applied to EVERY key at EVERY depth: a secret nested
// inside a payload object is dropped exactly like a top-level one. Only
// plain objects and arrays are traversed — Dates, Prisma Decimals and other
// class instances keep their own serialization.
const FORBIDDEN_KEYS = new Set([
  "password",
  "passwordHash",
  "password_hash",
  "token",
  "tokenHash",
  "token_hash",
  "cookie",
  "cookies",
  "set-cookie",
  "authorization",
  "database_url",
  "api_key",
  "secret",
]);

export interface LogFields {
  [key: string]: unknown;
}

/** Deepest level traversed before a value is replaced by a marker. */
const MAX_DEPTH = 12;

function isForbiddenKey(key: string): boolean {
  const lowered = key.toLowerCase();
  for (const forbidden of FORBIDDEN_KEYS) {
    if (lowered.includes(forbidden)) {
      return true;
    }
  }
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * `ancestors` holds the objects on the current path only, so a shared
 * reference is serialized twice while a true cycle is cut.
 */
function sanitizeValue(value: unknown, depth: number, ancestors: WeakSet<object>): unknown {
  if (depth > MAX_DEPTH) return "[truncated]";
  if (typeof value === "bigint") return value.toString();
  if (!Array.isArray(value) && !isPlainObject(value)) return value;
  if (ancestors.has(value)) return "[circular]";
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => sanitizeValue(item, depth + 1, ancestors));
    }
    const clean: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (isForbiddenKey(key)) continue;
      clean[key] = sanitizeValue(item, depth + 1, ancestors);
    }
    return clean;
  } finally {
    ancestors.delete(value);
  }
}

/** Strip secret-bearing keys (case-insensitive substring match) at any depth. */
export function sanitizeLogFields(fields: LogFields): LogFields {
  const clean: LogFields = {};
  const ancestors = new WeakSet<object>();
  ancestors.add(fields);
  for (const [key, value] of Object.entries(fields)) {
    if (isForbiddenKey(key)) continue;
    clean[key] = sanitizeValue(value, 0, ancestors);
  }
  return clean;
}

/** Emit one JSON log line. Pure formatting + console; no persistence. */
export function logEvent(event: string, fields: LogFields = {}): void {
  const safe = sanitizeLogFields(fields);
  console.log(JSON.stringify({ event, ...safe }));
}
