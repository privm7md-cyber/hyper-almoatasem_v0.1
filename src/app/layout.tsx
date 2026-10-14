import type { Metadata } from "next";
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

export const metadata: Metadata = {
  title: {
    default: "هايبر المعتصم",
    template: "%s — هايبر المعتصم",
  },
  description: "احتياجات بيتك بسهولة ووضوح، وثقة في كل خطوة.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="ar"
      dir="rtl"
      className={`${cairo.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
