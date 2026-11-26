import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: { root: process.cwd() },
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
  //
  // Final-Closure (2026-11-06): the open item is being closed in its SAFEST
  // possible form — a Content-Security-Policy-Report-Only (never enforcing).
  // Violations POST to /api/csp-report (console-logged only). The policy is
  // deliberately written WITHOUT any relaxation so reports reveal everything
  // that production enforcement would need to allow, including the App Router
  // inline bootstrap scripts. Nothing on the site changes behaviour: browsers
  // report, never block, on a Report-Only header. Enforcement remains blocked
  // on (a) a real production origin (OWNER-INPUT-REQUIRED) and (b) the
  // documented allowlist produced by these reports (see
  // D:/Hyper_Data_Review Final_Project_Closure reports).
  async headers() {
    const securityHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "same-origin" },
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
    ];
    // Dynamic nonce-based CSP (strict-dynamic + per-request nonce) is generated
    // in src/proxy.ts per official Next.js 16 App Router specification.
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
