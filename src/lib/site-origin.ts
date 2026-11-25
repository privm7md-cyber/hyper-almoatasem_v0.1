// Single source of the absolute site origin (Final-Closure 2026-11-06,
// hardened in the Final Release Closure run — E-5).
//
// Before this module the SAME resolution logic was copied in layout.tsx,
// sitemap.ts and robots.ts (three independent decisions that could drift).
// They now all ask this module — one decision, one place.
//
// It is NEVER a guessed hostname. Resolution order:
//   1. NEXT_PUBLIC_SITE_URL           — the owner's explicit setting (D-9);
//   2. VERCEL_PROJECT_PRODUCTION_URL  — the platform's own PRODUCTION domain;
//   3. VERCEL_URL                     — a per-deployment PREVIEW host: usable for
//                                       absolute-link resolution, but NEVER
//                                       advertised (canonical/sitemap/robots);
//   4. http://localhost:3000          — the LOCAL fallback ONLY.
//
// Validation (E-5): an explicit NEXT_PUBLIC_SITE_URL must be a bare origin —
// `https://host[:port]` with no credentials, path, query or hash. Plain `http`
// is accepted only for a loopback host (local verification). A value that
// fails validation is NOT used as an origin: the deployment falls back to the
// next source, records `invalidReason`, and the layout logs it loudly. A
// production build therefore can never publish a canonical under a malformed
// or loopback host.
//
// OWNER-INPUT-REQUIRED (D-9): the real production domain is still unknown to
// the project. Nothing here invents one.

export type SiteOriginSource =
  | "NEXT_PUBLIC_SITE_URL"
  | "VERCEL_PROJECT_PRODUCTION_URL"
  | "VERCEL_URL"
  | "LOCALHOST_FALLBACK";

export interface SiteOriginInfo {
  /** Absolute origin without a trailing slash (e.g. https://example.com). */
  origin: string;
  /** True when the origin came from an owner/platform PRODUCTION setting (1–2). */
  explicit: boolean;
  /** True when the origin is only the localhost fallback (item 4). */
  fallbackLocalhost: boolean;
  /** True when the origin is a per-deployment preview host (item 3). */
  previewHost: boolean;
  /** Which source produced `origin`. */
  source: SiteOriginSource;
  /** Why NEXT_PUBLIC_SITE_URL was rejected, when it was set but invalid. */
  invalidReason: string | null;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Validate an explicit origin value. Returns the normalized origin, or an
 * error string. Exported for tests and for the build-time notice.
 */
export function validateExplicitOrigin(
  raw: string,
): { ok: true; origin: string } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "not an absolute URL" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: `unsupported protocol ${url.protocol}` };
  }
  if (url.username || url.password) return { ok: false, reason: "credentials are not allowed" };
  if (url.search || url.hash) return { ok: false, reason: "query string / hash are not allowed" };
  if (url.pathname !== "/" && url.pathname !== "") {
    return { ok: false, reason: "a path is not allowed (origin only)" };
  }
  const loopback = LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
  if (url.protocol === "http:" && !loopback) {
    return { ok: false, reason: "plain http is only allowed for a loopback host" };
  }
  if (loopback && process.env.NODE_ENV === "production") {
    return { ok: false, reason: "a loopback host cannot be a production origin" };
  }
  return { ok: true, origin: url.origin };
}

function platformHost(raw: string | undefined): string | null {
  const host = raw?.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!host || /[\s/?#@]/.test(host)) return null;
  return host;
}

export function resolveSiteOrigin(): SiteOriginInfo {
  let invalidReason: string | null = null;
  const explicitRaw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicitRaw) {
    const checked = validateExplicitOrigin(explicitRaw);
    if (checked.ok) {
      return {
        origin: checked.origin,
        explicit: true,
        fallbackLocalhost: false,
        previewHost: false,
        source: "NEXT_PUBLIC_SITE_URL",
        invalidReason: null,
      };
    }
    invalidReason = checked.reason;
  }
  const vercelProduction = platformHost(process.env.VERCEL_PROJECT_PRODUCTION_URL);
  if (vercelProduction) {
    return {
      origin: `https://${vercelProduction}`,
      explicit: true,
      fallbackLocalhost: false,
      previewHost: false,
      source: "VERCEL_PROJECT_PRODUCTION_URL",
      invalidReason,
    };
  }
  const vercelDeployment = platformHost(process.env.VERCEL_URL);
  if (vercelDeployment) {
    return {
      origin: `https://${vercelDeployment}`,
      explicit: false,
      fallbackLocalhost: false,
      previewHost: true,
      source: "VERCEL_URL",
      invalidReason,
    };
  }
  return {
    origin: "http://localhost:3000",
    explicit: false,
    fallbackLocalhost: true,
    previewHost: false,
    source: "LOCALHOST_FALLBACK",
    invalidReason,
  };
}

export const SITE_ORIGIN_INFO = resolveSiteOrigin();

/** The origin string for relative-URL resolution / absolute link building. */
export const SITE_ORIGIN = SITE_ORIGIN_INFO.origin;

/**
 * May THIS deployment advertise its origin (sitemap entries, robots.txt
 * `Sitemap:` line, canonical / Open Graph absolute URLs)?
 *
 * Rule (the "no fabricated origin" contract):
 *  - a validated EXPLICIT production origin is always advertised;
 *  - a per-deployment PREVIEW host is never advertised;
 *  - the localhost fallback is advertised in development (local scratch /
 *    e2e contract) but NEVER in a production build — a production deploy
 *    without a valid origin stays silent instead of emitting wrong URLs.
 */
export function mayAdvertiseOrigin(info: SiteOriginInfo = SITE_ORIGIN_INFO): boolean {
  if (info.explicit) return true;
  if (info.previewHost) return false;
  if (info.fallbackLocalhost) {
    // `NODE_ENV` distinguishes a real deployment build (`next start`,
    // NODE_ENV=production) from the local dev/scratch server.
    return process.env.NODE_ENV !== "production";
  }
  return false;
}
