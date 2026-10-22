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
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
};

export default nextConfig;
