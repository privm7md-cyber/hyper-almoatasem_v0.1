import "server-only";
// Trusted client identity for rate limiting and the audit trail.
//
// A rate-limit bucket is only as strong as the identity that keys it: if the
// client can choose that identity, the limit can be bypassed by rotating a
// header. This module therefore NEVER trusts a value the client supplied
// unless the DEPLOYMENT has declared that a trusted proxy writes it.
//
// Hosting environment of this project: Vercel (`.vercel/project.json` —
// project `hyper-almoatasem-v0-1`; live deployments at `*.vercel.app`).
//
// What the platform guarantees (vercel.com/docs/headers/request-headers):
//   * "we currently overwrite the X-Forwarded-For header and do not forward
//      external IPs. This restriction is in place to prevent IP spoofing."
//   * `x-vercel-forwarded-for` is the platform-written copy; it is the one
//     that survives a proxy placed in FRONT of Vercel.
//   * `x-real-ip` is documented as IDENTICAL to `x-forwarded-for` — it is not
//     an independent source and is therefore not used on its own.
//   * `VERCEL=1` is set on every Vercel deployment, at build AND runtime
//     (vercel.com/docs/environment-variables/system-environment-variables).
//     The platform is detected from the ENVIRONMENT, never from a header, so
//     a client cannot impersonate the platform.
//
// Why the self-hosted path cannot trust the same header: Next.js fills
// `x-forwarded-for` with the socket peer address ONLY when the client omitted
// it — `req.headers['x-forwarded-for'] ??= originalRequest?.socket?.remoteAddress`
// (next/dist/server/base-server.js). A client-supplied value is kept VERBATIM,
// so on a self-hosted server the header is chosen by the client.
//
// Trust model:
//   1. Vercel runtime → the platform wrote the header; the client cannot
//      choose it. `x-vercel-forwarded-for` first, `x-forwarded-for` second.
//   2. Self-hosted with `TRUSTED_PROXY=1` → the operator declares that a
//      trusted proxy REPLACES `x-forwarded-for` with a single value (the
//      Vercel behaviour). Only a single-valued header is accepted; a chain is
//      ambiguous because the hop count is not known from evidence, so it is
//      rejected rather than guessed.
//   3. Otherwise → the identity is UNKNOWN. Callers then fall back to a
//      shared bucket, which is conservative and cannot be bypassed by
//      rotating a header.
import { isIP } from "node:net";

export interface HeaderReader {
  get(name: string): string | null;
}

export type ClientIpSource = "vercel-platform" | "declared-proxy" | "unknown";

export interface ClientIpIdentity {
  /** The trusted client IP, or null when it cannot be established. */
  ip: string | null;
  /** Which rule produced the result — auditable, never guessed. */
  source: ClientIpSource;
}

/** Bucket key used when no trusted identity exists (never client-derived). */
export const UNKNOWN_CLIENT_IP = "unknown";

export type EnvLike = Record<string, string | undefined>;

/**
 * Parse a header that must carry exactly ONE address. A comma-separated
 * chain is rejected: without evidence about the number of hops, "the first
 * value" is the one a client can forge.
 */
export function parseSingleIp(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (value === "" || value.includes(",")) return null;
  return isIP(value) !== 0 ? value : null;
}

/** True on a Vercel deployment (the platform sets VERCEL=1 at runtime). */
export function isVercelRuntime(env: EnvLike = process.env): boolean {
  return env.VERCEL === "1";
}

/**
 * True when the operator declares that a trusted reverse proxy writes the
 * forwarded header for this deployment.
 */
export function isDeclaredTrustedProxy(env: EnvLike = process.env): boolean {
  return env.TRUSTED_PROXY === "1";
}

/**
 * Resolve the trusted client IP for the current deployment.
 * Never returns a client-chosen value unless a platform/proxy that rewrites
 * the header is in front of the app.
 */
export function resolveClientIp(h: HeaderReader, env: EnvLike = process.env): ClientIpIdentity {
  if (isVercelRuntime(env)) {
    const platform = parseSingleIp(h.get("x-vercel-forwarded-for"));
    if (platform !== null) return { ip: platform, source: "vercel-platform" };
    // Vercel overwrites x-forwarded-for, so it is also platform-written
    // there; it is accepted only when it carries a single address.
    const forwarded = parseSingleIp(h.get("x-forwarded-for"));
    if (forwarded !== null) return { ip: forwarded, source: "vercel-platform" };
    return { ip: null, source: "unknown" };
  }
  if (isDeclaredTrustedProxy(env)) {
    const forwarded = parseSingleIp(h.get("x-forwarded-for"));
    if (forwarded !== null) return { ip: forwarded, source: "declared-proxy" };
    return { ip: null, source: "unknown" };
  }
  return { ip: null, source: "unknown" };
}

/**
 * The rate-limit bucket identity: the trusted IP, or the constant
 * UNKNOWN marker. The unknown bucket is shared by every request whose
 * identity could not be established, so a client that hides its address
 * gains nothing — it can only be limited more, never less.
 */
export function clientIpBucketKey(h: HeaderReader, env: EnvLike = process.env): string {
  return resolveClientIp(h, env).ip ?? UNKNOWN_CLIENT_IP;
}
