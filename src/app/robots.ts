import type { MetadataRoute } from "next";
import { SITE_ORIGIN, mayAdvertiseOrigin } from "@/lib/site-origin";

// Public crawl policy (Phase-12).
//
// `robots.txt` is NOT a protection mechanism: the admin area, the session
// pages and the account pages are protected by the server-side authorization
// and are ALSO marked `noindex` in their own metadata. This file only tells
// crawlers which pages are worth indexing.
export default function robots(): MetadataRoute.Robots {
  // Final-Closure: the origin decision is centralised. The `Sitemap:` line is
  // emitted only when the origin may be advertised (explicit env var, or the
  // localhost fallback in a NON-production environment). A production build
  // that was never told its own domain stays silent instead of advertising a
  // guessed host.
  const advertise = mayAdvertiseOrigin();

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Private / transactional surfaces: never worth a crawl, and the
        // server refuses them anyway.
        disallow: [
          "/admin",
          "/api/",
          "/cart",
          "/checkout",
          "/account",
          "/orders",
          "/order-confirmation",
          "/login",
          "/register",
          "/search",
        ],
      },
    ],
    ...(advertise ? { sitemap: `${SITE_ORIGIN}/sitemap.xml` } : {}),
    ...(advertise ? { host: SITE_ORIGIN } : {}),
  };
}
