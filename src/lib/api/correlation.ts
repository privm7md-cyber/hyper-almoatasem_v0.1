// Correlation id for the audit trail (BL-01 hardening — doc 11 P3).
//
// A request may carry a correlation id under a well-known header. The value
// is CLIENT/PROXY-SUPPLIED, so it is treated as an identifier, never as
// trusted content: only a bounded safe charset is accepted; anything else —
// or an absent header — yields null. An unproven value is never recorded.
//
// When present, `auditInTx` records it INSIDE the audit payload
// (`new_values.correlation_id`) so log lines ↔ audit rows join within one
// request batch, without widening the frozen `audit_logs` table (no new
// column, no new CHECK, no Prisma-model change).
export interface HeaderReader {
  get(name: string): string | null;
}

/** audit payload values must stay bounded (user_agent is capped at 500). */
export const MAX_CORRELATION_ID_LENGTH = 64;

const SAFE_CORRELATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:\-]{0,63}$/;

/**
 * First present header wins; a present-but-invalid value yields null —
 * a malformed id is never laundered into a valid-looking one.
 */
export function extractCorrelationId(h: HeaderReader): string | null {
  for (const name of ["x-correlation-id", "x-request-id"]) {
    const raw = h.get(name);
    if (raw === null || raw.trim() === "") continue;
    const cleaned = raw.trim();
    return SAFE_CORRELATION_ID.test(cleaned) ? cleaned : null;
  }
  return null;
}

/**
 * Bounded reason text for audit payloads (same hygiene rules as the
 * User-Agent: control characters folded to spaces, trimmed, capped).
 */
export function normalizeAuditReason(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (cleaned === "") return null;
  return cleaned.slice(0, 500);
}
