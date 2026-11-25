// Canonical URL policy (E-5 closure).
//
// ONE source of truth for the absolute origin: `src/lib/site-origin.ts`
// (NEXT_PUBLIC_SITE_URL → VERCEL_PROJECT_PRODUCTION_URL → VERCEL_URL →
// localhost fallback). Nothing here invents a host.
//
// The publication rule is the same "no fabricated origin" contract the sitemap
// and robots already use (`mayAdvertiseOrigin()`):
//   • an EXPLICIT origin is always advertised;
//   • the localhost fallback is advertised in a NON-production build (local
//     verification), and NEVER in a production build;
//   • a production build without an explicit origin publishes NO canonical at
//     all — a guessed host inside a production document is worse than a
//     missing canonical, because it actively tells crawlers which duplicate
//     to keep.
//
// The same rule is what makes the "0/17 canonical" gap closable: the code
// gap was that no page published a canonical at all; the remaining owner
// decision (D-9) is only the VALUE of the production origin.

import { SITE_ORIGIN, mayAdvertiseOrigin } from "@/lib/site-origin";

/**
 * Normalize a site path into the canonical form used by every public URL:
 * a single leading slash, no duplicate slashes, no query string, no hash and
 * no trailing slash (except for the root itself).
 */
export function canonicalPath(path: string): string {
  const withoutQuery = path.split(/[?#]/, 1)[0] ?? "";
  const collapsed = `/${withoutQuery}`.replace(/\/{2,}/g, "/");
  if (collapsed === "/") return "/";
  return collapsed.replace(/\/+$/, "") || "/";
}

/**
 * The absolute canonical URL for a path, or `null` when this deployment may
 * not advertise its origin (production build without an explicit origin).
 */
export function canonicalUrl(path: string): string | null {
  if (!mayAdvertiseOrigin()) return null;
  return `${SITE_ORIGIN}${canonicalPath(path)}`;
}

/**
 * The metadata fragment a page spreads into its `metadata` export. It is empty
 * when no canonical may be published, so no page ever emits a misleading link.
 */
export function canonicalMetadata(path: string): { alternates?: { canonical: string } } {
  const url = canonicalUrl(path);
  return url ? { alternates: { canonical: url } } : {};
}

/**
 * True when this deployment may publish absolute URLs (canonical / Open Graph
 * / sitemap). Exposed so the build can LOG the missing configuration instead
 * of leaving a generic framework warning.
 */
export function originIsAdvertisable(): boolean {
  return mayAdvertiseOrigin();
}
