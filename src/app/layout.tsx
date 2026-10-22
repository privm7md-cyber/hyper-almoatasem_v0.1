import type { Metadata, Viewport } from "next";
import { Cairo, Geist_Mono } from "next/font/google";
import { ToastProvider } from "@/components/ui/toast";
import "./globals.css";

// FE-1 foundation: Cairo (arabic+latin) primary per FP-10 D01/D02 (DECIDED-FOR-FRONTEND-V1);
// Geist Mono retained for code/IDs; system stack is the offline fallback (documented in FE-1 report).
const cairo = Cairo({
  variable: "--font-cairo",
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * The site origin for absolute URLs (canonical / Open Graph / sitemap).
 *
 * It is NEVER a guessed domain: the order is
 *   1. NEXT_PUBLIC_SITE_URL   — the owner's explicit setting, if present;
 *   2. VERCEL_PROJECT_PRODUCTION_URL — the platform's own production domain;
 *   3. VERCEL_URL             — the current deployment's domain;
 *   4. localhost              — the local fallback ONLY (a local build).
 * A local fallback never reaches a deployment that sets any of the first three.
 */
const siteOrigin = (() => {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit;
  const vercelProduction = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercelProduction) return `https://${vercelProduction}`;
  const vercelDeployment = process.env.VERCEL_URL?.trim();
  if (vercelDeployment) return `https://${vercelDeployment}`;
  return "http://localhost:3000";
})();

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin),
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
          {/* Skip link: the first focusable element on every page (Phase-12). */}
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:end-4 focus:top-4 focus:z-[80] focus:rounded-control focus:bg-brand focus:px-4 focus:py-2 focus:font-semibold focus:text-white"
          >
            تخطَّ إلى المحتوى
          </a>
          {children}
        </ToastProvider>
      </body>
    </html>
  );
}
