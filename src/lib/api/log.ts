// Shared structured server logging (BA-1 foundation).
//
// Debuggability without secret leakage. Values are allowlisted per event;
// keys that can carry secrets are dropped centrally, never by callers.
// Never logs: passwords, hashes, raw tokens, cookies, DATABASE_URL, API keys,
// full customer PII beyond operational need. Console-only (Vercel logs +
// audit_logs cover persistence); no new platform.

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

/** Strip secret-bearing keys (case-insensitive substring match). */
export function sanitizeLogFields(fields: LogFields): LogFields {
  const clean: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    const lowered = key.toLowerCase();
    let blocked = false;
    for (const forbidden of FORBIDDEN_KEYS) {
      if (lowered.includes(forbidden)) {
        blocked = true;
        break;
      }
    }
    if (!blocked) clean[key] = value;
  }
  return clean;
}

/** Emit one JSON log line. Pure formatting + console; no persistence. */
export function logEvent(event: string, fields: LogFields = {}): void {
  const safe = sanitizeLogFields(fields);
  console.log(JSON.stringify({ event, ...safe }));
}
