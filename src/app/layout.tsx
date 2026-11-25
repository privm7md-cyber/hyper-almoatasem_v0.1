import type { Metadata, Viewport } from "next";
import { Cairo, Geist_Mono } from "next/font/google";
import { ToastProvider } from "@/components/ui/toast";
import { SkipToMain } from "@/components/store/skip-to-main";
import { SITE_ORIGIN, SITE_ORIGIN_INFO, mayAdvertiseOrigin } from "@/lib/site-origin";
import "./globals.css";

// FE-1 foundation: Cairo primary per FP-10 D01/D02 (DECIDED-FOR-FRONTEND-V1);
// Preloading arabic and latin subsets together ensures simultaneous font swap and prevents layout shift (CLS).
// Disable next/font's un-ranged `"Cairo Fallback"` (`Arial` @ 94.66%): it intercepts U+0600-06FF ahead of
// `"Cairo Arabic Fallback"` in `globals.css`, shrinking Arabic fallback advance widths by ~25%.
// Geist Mono retained for code/IDs; calibrated fallback stack lives in `globals.css`.
const cairo = Cairo({
  variable: "--font-cairo",
  subsets: ["arabic", "latin"],
  weight: ["400", "600", "700", "800"],
  display: "swap",
  adjustFontFallback: false,
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  // Third-Agent perf: Geist Mono is for code/IDs only, never the LCP text
  // (Cairo). Preloading it competes with the hero text on first paint.
  // Loaded on demand when an element actually uses the mono stack.
  preload: false,
});

/**
 * The site origin for absolute URLs (canonical / Open Graph / sitemap).
 * Resolved ONCE in `src/lib/site-origin.ts` — layout, sitemap and robots share
 * the same decision (Final-Closure: a single central env var; the logic used
 * to be copied in three files and could drift).
 *
 * When the origin is only the localhost fallback (no explicit env var), this
 * branch deliberately does NOT publish `metadataBase`: Next metadata then
 * resolves relative URLs against the actual deployment host, so a misconfigured
 * production deploy can never emit canonical/OG URLs under a guessed host.
 */
const siteOrigin = SITE_ORIGIN;
const originIsExplicitlyConfigured = SITE_ORIGIN_INFO.explicit;
// E-5 closure: the same "may advertise" rule the sitemap/robots already use.
// A non-production build may advertise the localhost fallback (that is how
// the canonical contract is verified locally); a production build may not.
const originMayBeAdvertised = mayAdvertiseOrigin();

if (SITE_ORIGIN_INFO.invalidReason) {
  // E-5: a malformed / loopback NEXT_PUBLIC_SITE_URL is never used as the
  // canonical origin. Say so explicitly instead of silently falling back.
  console.warn(
    `[site-origin] NEXT_PUBLIC_SITE_URL was REJECTED (${SITE_ORIGIN_INFO.invalidReason}); ` +
      `falling back to ${SITE_ORIGIN_INFO.source}. Set a bare https origin, e.g. https://example.com.`,
  );
}

if (process.env.NODE_ENV === "production" && !originIsExplicitlyConfigured) {
  // Explicit, actionable configuration notice — the generic framework warning
  // about `metadataBase` does not say WHAT to set.
  console.warn(
    "[site-origin] NEXT_PUBLIC_SITE_URL is not set: this production build publishes NO canonical URL, " +
      "NO Open Graph absolute URL and an EMPTY sitemap until the owner approves the production origin (D-9).",
  );
}

export const metadata: Metadata = {
  // metadataBase anchors relative canonical / OG URLs. Published ONLY when the
  // origin may be advertised — a guessed localhost must never be emitted into
  // a production document (see src/lib/site-origin.ts).
  ...(originMayBeAdvertised ? { metadataBase: new URL(siteOrigin) } : {}),
  title: {
    default: "هايبر المعتصم",
    template: "%s — هايبر المعتصم",
  },
  description: "احتياجات بيتك بسهولة ووضوح، وثقة في كل خطوة.",
  applicationName: "هايبر المعتصم",
  openGraph: {
    type: "website",
    locale: "ar_EG",
    siteName: "هايبر المعتصم",
    title: "هايبر المعتصم",
    description: "احتياجات بيتك بسهولة ووضوح، وثقة في كل خطوة.",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "هايبر المعتصم",
    description: "احتياجات بيتك بسهولة ووضوح، وثقة في كل خطوة.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
};

/**
 * The mobile bottom navigation is a fixed bar, so the viewport must allow the
 * safe-area inset to be used and the theme colour must match the brand.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#511D9C",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="ar"
      dir="rtl"
      className={`${cairo.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ToastProvider>
          {/* Skip link: primary landmark bypass outside authenticated Admin routes
              (AdminShell provides its own `.adm-skip-link`). */}
          <SkipToMain />
          {children}
        </ToastProvider>
      </body>
    </html>
  );
}
