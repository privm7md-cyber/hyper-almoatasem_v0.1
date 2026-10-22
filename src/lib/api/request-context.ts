import "server-only";
// Central request context for the audit trail (Phase-10 remediation, G06).
//
// Before this module the audit trail stored `ip_address`/`user_agent` only for
// the four session actions, because the transaction-bound audit helper
// (`auditInTx`) had no access to the request. Every domain write therefore
// produced an audit row with a NULL IP — the columns existed, the data never
// arrived. This module is the SINGLE place that extracts the request context,
// so every audited operation records it consistently.
//
// Trust model for the client IP (never a client-supplied value by default):
//   * A forwarded header is only read when the deployment EXPLICITLY declares
//     a trusted reverse proxy (`TRUSTED_PROXY=1`). Without that declaration
//     the IP stays NULL — an unproven header is not recorded as an identity.
//   * The value must parse as an IPv4/IPv6 address (`node:net` isIP) before it
//     is used, because the column is PostgreSQL `inet` and a malformed value
//     would abort the audited transaction.
//   * The User-Agent is client metadata, not an identity claim: it is recorded
//     (bounded + sanitized) in every environment.
//
// NEVER recorded: cookies, authorization headers, session tokens, guest
// tokens, passwords or hashes. This module only ever reads the two headers
// below.
import { headers } from "next/headers";
import { isIP } from "node:net";

/** audit_logs.user_agent is VARCHAR(500) — keep the value inside the column. */
export const MAX_USER_AGENT_LENGTH = 500;

export interface RequestContext {
  /** Trusted client IP, or null when no trusted source is available. */
  ip: string | null;
  /** Bounded, sanitized User-Agent, or null when the client sent none. */
  userAgent: string | null;
}

export interface HeaderReader {
  get(name: string): string | null;
}

/**
 * The deployment declares a trusted reverse proxy with `TRUSTED_PROXY=1`.
 * Until it does, forwarded headers are IGNORED for identity purposes.
 */
export function isTrustedProxyContext(env: Record<string, string | undefined> = process.env): boolean {
  return env.TRUSTED_PROXY === "1";
}

/**
 * Extract the client IP from the request headers — only when a trusted proxy
 * is declared. `x-vercel-forwarded-for` is checked first (platform-written,
 * single value), then the first entry of `x-forwarded-for` (the original
 * client in the standard chain), then `x-real-ip`.
 */
export function extractClientIp(h: HeaderReader, trusted: boolean): string | null {
  if (!trusted) return null;
  const candidates = [
    h.get("x-vercel-forwarded-for"),
    h.get("x-forwarded-for"),
    h.get("x-real-ip"),
  ];
  for (const raw of candidates) {
    if (!raw) continue;
    const first = raw.split(",")[0]?.trim() ?? "";
    if (first !== "" && isIP(first) !== 0) return first;
  }
  return null;
}

/** Bounded + control-character-free User-Agent (never null when present). */
export function extractUserAgent(h: HeaderReader): string | null {
  const raw = h.get("user-agent");
  if (!raw) return null;
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (cleaned === "") return null;
  return cleaned.slice(0, MAX_USER_AGENT_LENGTH);
}

/** Build the context from any header reader (pure — unit-testable). */
export function buildRequestContext(h: HeaderReader, trusted: boolean): RequestContext {
  return { ip: extractClientIp(h, trusted), userAgent: extractUserAgent(h) };
}

/**
 * The request context of the CURRENT request. Returns a null context when
 * there is no request scope (e.g. a script or a background job) — never
 * throws, so an audited transaction can never fail because of it.
 */
export async function resolveRequestContext(): Promise<RequestContext> {
  try {
    const h = await headers();
    return buildRequestContext(h, isTrustedProxyContext());
  } catch {
    return { ip: null, userAgent: null };
  }
}

/**
 * The rate-limit bucket source: the forwarded header value when present.
 *
 * This is intentionally NOT the trusted IP: the login buckets are keyed by
 * the address the request claims, exactly as before this change, so the
 * existing lockout thresholds keep their meaning. The account bucket
 * (10 attempts / 15 min) remains the hard limit either way. The TRUSTED ip
 * is what the audit trail records.
 */
export function extractForwardedIp(h: HeaderReader): string | null {
  const forwarded = h.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim() ?? "";
  return first === "" ? null : first;
}

/** True when the request reached the app over HTTPS (proxy-aware). */
export function isHttpsRequest(h: HeaderReader, requestProtocol?: string | null): boolean {
  if (requestProtocol) return requestProtocol === "https:";
  const proto = h.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0]?.trim() === "https";
  return false;
}

const LOCAL_ORIGIN_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * True when the request ORIGIN is a browser "potentially trustworthy" one
 * (localhost / 127.0.0.1 / ::1). Browsers accept `Secure` cookies on such
 * origins even over plain HTTP, so a `Secure` session cookie is NOT dropped
 * there. Any other host over plain HTTP really would lose the cookie.
 */
export function isLocalOrigin(host: string | null | undefined): boolean {
  if (!host) return false;
  const hostname = host.replace(/:\d+$/, "").toLowerCase();
  return LOCAL_ORIGIN_HOSTS.has(hostname);
}
