// NAV-02 (approved return-destination policy; Phase-04 D26/OD): after auth success the
// user is returned to the internal destination they were heading to. Only a safe,
// internal, non-auth, non-admin, non-API path is preserved; everything else falls back
// to the signed-in default /account. Front-end navigation policy ONLY — this never
// adds or removes protection from any route.

export const DEFAULT_RETURN_TO = "/account";

const BLOCKED_PREFIXES = ["/admin", "/api"];

function hasUnsafeCharacters(value: string): boolean {
  // Backslashes and control characters (incl. newline) can trick URL parsers.
  return /[\\\u0000-\u001f]/.test(value);
}

export function safeReturnTo(raw: unknown): string {
  if (typeof raw !== "string") return DEFAULT_RETURN_TO;
  const value = raw.trim();
  if (value === "" || value.length > 512) return DEFAULT_RETURN_TO;
  if (hasUnsafeCharacters(value)) return DEFAULT_RETURN_TO;
  if (!value.startsWith("/")) return DEFAULT_RETURN_TO;
  // Protocol-relative and encoded-slash forms can act as open redirects.
  const lower = value.toLowerCase();
  if (
    lower.startsWith("//") ||
    lower.startsWith("/\\") ||
    lower.startsWith("/%2f") ||
    lower.startsWith("/%5c")
  ) {
    return DEFAULT_RETURN_TO;
  }
  const path = (value.split("?")[0]?.split("#")[0] ?? "").toLowerCase();
  // Auth pages themselves would loop; admin/api are out of scope for the storefront session.
  if (path === "/login" || path === "/register") return DEFAULT_RETURN_TO;
  if (BLOCKED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}?`) || path.startsWith(`${p}#`))) {
    return DEFAULT_RETURN_TO;
  }
  return value;
}

/** Query-string fragment for auth cross-links: empty when the target is the default. */
export function returnToQuery(raw: unknown): string {
  const target = safeReturnTo(raw);
  if (target === DEFAULT_RETURN_TO) return "";
  return `?next=${encodeURIComponent(target)}`;
}
