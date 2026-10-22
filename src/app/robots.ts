import type { MetadataRoute } from "next";

// Public crawl policy (Phase-12).
//
// `robots.txt` is NOT a protection mechanism: the admin area, the session
// pages and the account pages are protected by the server-side authorization
// and are ALSO marked `noindex` in their own metadata. This file only tells
// crawlers which pages are worth indexing.
export default function robots(): MetadataRoute.Robots {
  const origin = (
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.trim()}`
      : process.env.VERCEL_URL?.trim()
        ? `https://${process.env.VERCEL_URL.trim()}`
        : "http://localhost:3000")
  ).replace(/\/$/, "");

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
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
