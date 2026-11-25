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
//   * The identity comes from `./client-ip`, which resolves it against the
//     DEPLOYMENT's trust model: the Vercel platform header on a Vercel
//     deployment, or a single-valued forwarded header when the operator
//     declares a trusted proxy (`TRUSTED_PROXY=1`). Without either, the IP
//     stays NULL — an unproven header is not recorded as an identity.
//   * The value must parse as an IPv4/IPv6 address (`node:net` isIP) before it
//     is used, because the column is PostgreSQL `inet` and a malformed value
//     would abort the audited transaction.
//   * The User-Agent is client metadata, not an identity claim: it is recorded
//     (bounded + sanitized) in every environment.
//
// NEVER recorded: cookies, authorization headers, session tokens, guest
// tokens, passwords or hashes. This module only ever reads the two headers
// below.
import { isIP } from "node:net";
import { headers } from "next/headers";
import { isDeclaredTrustedProxy, isVercelRuntime, resolveClientIp, type EnvLike } from "@/lib/api/client-ip";
import { extractCorrelationId } from "@/lib/api/correlation";
import { ApiError } from "@/lib/api/errors";

/** audit_logs.user_agent is VARCHAR(500) — keep the value inside the column. */
export const MAX_USER_AGENT_LENGTH = 500;

export interface RequestContext {
  /** Trusted client IP, or null when no trusted source is available. */
  ip: string | null;
  /** Bounded, sanitized User-Agent, or null when the client sent none. */
  userAgent: string | null;
  /** Sanitized correlation id from a well-known header, or null (BL-01 P3). */
  correlationId: string | null;
}

export interface HeaderReader {
  get(name: string): string | null;
}

/**
 * Resolve the trusted client IP for this deployment. The trust model lives in
 * `./client-ip`; this function is the context-shaped view of it.
 */
export function extractClientIp(h: HeaderReader, env: EnvLike = process.env): string | null {
  return resolveClientIp(h, env).ip;
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
export function buildRequestContext(h: HeaderReader, env: EnvLike = process.env): RequestContext {
  return { ip: extractClientIp(h, env), userAgent: extractUserAgent(h), correlationId: extractCorrelationId(h) };
}

/**
 * The request context of the CURRENT request. Returns a null context when
 * there is no request scope (e.g. a script or a background job) — never
 * throws, so an audited transaction can never fail because of it.
 */
export async function resolveRequestContext(): Promise<RequestContext> {
  try {
    const h = await headers();
    return buildRequestContext(h);
  } catch {
    return { ip: null, userAgent: null, correlationId: null };
  }
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
 * (localhost / 127.0.0.1 / ::1 / [::1], with optional valid port 1..65535).
 * Browsers accept `Secure` cookies on such origins even over plain HTTP, so a
 * `Secure` session cookie is NOT dropped there. Any other host over plain HTTP
 * really would lose the cookie.
 */
export function isLocalOrigin(host: string | null | undefined): boolean {
  if (!host || /[\s\u0000-\u001f]/.test(host)) return false;
  if (host === "::1") return true;
  const match = /^(localhost|127\.0\.0\.1|\[::1\])(?::([0-9]{1,5}))?$/i.exec(host);
  if (!match || match[0] !== host) return false;
  if (match[2] !== undefined) {
    const port = Number(match[2]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
  }
  return LOCAL_ORIGIN_HOSTS.has(match[1].toLowerCase());
}

/** True when running behind a declared trusted proxy (`TRUSTED_PROXY=1`, `TRUST_PROXY=true`, or `VERCEL=1`). */
export function isTrustedProxyContext(env: EnvLike = process.env): boolean {
  return (
    isDeclaredTrustedProxy(env) ||
    isVercelRuntime(env) ||
    env.TRUST_PROXY === "true" ||
    env.TRUST_PROXY === "1"
  );
}

/** Validated first IP from `x-forwarded-for`, or null if missing/invalid. */
export function extractForwardedIp(h: HeaderReader): string | null {
  const forwarded = h.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim() ?? "";
  if (first === "" || isIP(first) === 0) return null;
  return first;
}

/**
 * Validated IP source for rate-limiting buckets:
 * delegates to `resolveClientIp` so untrusted client headers are never trusted
 * unless a platform (`VERCEL=1`) or operator (`TRUSTED_PROXY=1`) proxy is declared.
 */
export function extractRateLimitIp(
  h: HeaderReader,
  env: EnvLike = process.env,
): string | null {
  return resolveClientIp(h, env).ip;
}

/**
 * CSRF Same-Origin verifier for state-changing requests (`POST`, `PUT`, `PATCH`, `DELETE`).
 * - If `Origin` header is absent (non-browser CLI / server-to-server), returns `true`
 *   (`SameSite=Lax` + `HttpOnly` cookies protect browser navigation requests).
 * - If `Origin` is `"null"` (sandboxed iframe / `data:` URI), returns `false`.
 * - Otherwise compares `new URL(origin).host` against the request's `Host`
 *   (or `X-Forwarded-Host` when `isTrustedProxyContext(env)` is true, or `requestUrl` host).
 */
export function verifySameOrigin(
  h: HeaderReader,
  requestUrl?: string,
  env: EnvLike = process.env,
): boolean {
  const rawOrigin = h.get("origin")?.trim();
  if (!rawOrigin) return true;
  if (rawOrigin.toLowerCase() === "null") return false;
  let originHost: string;
  try {
    const parsed = new URL(rawOrigin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    originHost = parsed.host.toLowerCase();
  } catch {
    return false;
  }

  let expectedHost: string | null = null;
  if (isTrustedProxyContext(env)) {
    const xfh = h.get("x-forwarded-host")?.split(",")[0]?.trim();
    if (xfh) expectedHost = xfh.toLowerCase();
  }
  if (!expectedHost) {
    const hostHeader = h.get("host")?.trim();
    if (hostHeader) expectedHost = hostHeader.toLowerCase();
  }
  if (!expectedHost && requestUrl) {
    try {
      expectedHost = new URL(requestUrl).host.toLowerCase();
    } catch {
      expectedHost = null;
    }
  }
  if (!expectedHost) return false;
  return originHost === expectedHost;
}

export function assertSameOriginOrThrow(
  request: Request,
  env: EnvLike = process.env,
): void {
  if (!verifySameOrigin(request.headers, request.url, env)) {
    throw new ApiError("FORBIDDEN", "Cross-origin mutation is not permitted.");
  }
}
