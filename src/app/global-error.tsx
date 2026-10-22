"use client";

import Link from "next/link";

// Phase-12: the root-layout failure surface.
//
// `global-error.tsx` REPLACES the root layout, so it must render its own
// <html>/<body> — but it must still be recognisable as the store and still
// offer a way back. Without this file a failure inside the root layout (the
// font fetch, the toast provider) rendered Next's built-in 500 document: no
// styles, no fonts, no link home.

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ar" dir="rtl">
      <body
        style={{
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: 0,
          background: "#f7f5fb",
          color: "#1B1530",
          fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
        }}
      >
        <main style={{ maxWidth: "32rem", padding: "1.5rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.35rem", margin: "0 0 0.5rem" }}>حدث خطأ غير متوقع</h1>
          <p style={{ margin: "0 0 1rem", color: "#4b4458" }}>
            تعذّر عرض هذه الصفحة. يمكنك إعادة المحاولة أو العودة إلى المتجر.
          </p>
          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center" }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                minHeight: "44px",
                padding: "0 1.25rem",
                borderRadius: "0.5rem",
                border: "1px solid #511D9C",
                background: "#511D9C",
                color: "#fff",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              إعادة المحاولة
            </button>
            <Link
              href="/"
              style={{
                minHeight: "44px",
                display: "inline-flex",
                alignItems: "center",
                padding: "0 1.25rem",
                borderRadius: "0.5rem",
                border: "1px solid #c9c2d6",
                color: "#1B1530",
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              العودة إلى المتجر
            </Link>
          </div>
        </main>
      </body>
    </html>
  );
}
