import { ImageResponse } from "next/og";

// Phase-12: the social share image, GENERATED from the project's own brand
// tokens (no external asset, no third-party image, nothing downloaded).
//
// The wordmark is rendered in its Latin form ("HYPER AL-MOATASEM") because the
// default image font has no Arabic glyphs; the Arabic brand name and the
// brand promise live in the page title and description, which carry the real
// text to every platform. The colours are the brand palette:
// purple #511D9C, orange #FF7100, ink #1B1530.

export const alt = "هايبر المعتصم — متجر محلي عصري";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#511D9C",
          padding: "72px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "18px" }}>
          <div style={{ width: "18px", height: "72px", background: "#FF7100", borderRadius: "6px" }} />
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              color: "#FFFFFF",
              fontSize: "64px",
              fontWeight: 800,
              letterSpacing: "-1px",
            }}
          >
            <span>HYPER AL-MOATASEM</span>
            <span style={{ fontSize: "30px", fontWeight: 500, color: "#EEE8F5" }}>
              Modern local hypermarket
            </span>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: "2px solid rgba(255,255,255,0.25)",
            paddingTop: "28px",
            color: "#FFF1E6",
            fontSize: "28px",
          }}
        >
          <span>Home essentials, clearly priced.</span>
          <span style={{ color: "#FF7100", fontWeight: 700 }}>RTL · AR</span>
        </div>
      </div>
    ),
    size,
  );
}
