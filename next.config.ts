import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for forbidden() (403 surfaces) in Next 16.
  experimental: {
    authInterrupts: true,
  },
  // The build output directory. `NEXT_DIST_DIR` lets a SECOND dev server run
  // beside an existing one without sharing the `.next` lock (Phase-10
  // remediation workflow). The default is unchanged (`.next`).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // BA-H5: minimal hardening headers. Deliberately conservative — no CSP
  // (would need frontend coordination once it exists) and no HSTS (no
  // production TLS yet; enabling it prematurely is worse than absent).
  // These three are safe for pure-JSON API responses and future same-origin
  // frontend: MIME-sniffing off, referrer same-origin, framing same-origin.
  //
  // Phase-12: the same protections now also cover the HTML pages (the API
  // header block used to match `/api/:path*` only). A Content-Security-Policy
  // is deliberately NOT added: the App Router needs inline bootstrap scripts,
  // and a policy that has to allow 'unsafe-inline' is theatre — it is recorded
  // as an open item instead.
  async headers() {
    const securityHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "same-origin" },
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
    ];
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
