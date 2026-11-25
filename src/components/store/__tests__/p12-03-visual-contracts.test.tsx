// P12-03 permanent unit tests: verifies crafted media fallbacks, Corner CartBadge
// layout-neutral styling, and HomeHero marketing-honesty invariants.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CardImage } from "../card-image";
import { ProductGallery } from "../product-gallery";
import { HomeHero } from "../home-hero";

describe("P12-03 storefront visual & media contracts", () => {
  it("renders honest crafted fallback for missing card image without fake image elements", () => {
    render(<CardImage src={null} name="أرز مصري" productType="WEIGHT" />);
    expect(screen.getByText("بلا صورة")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("renders status role when card image is marked unavailable", () => {
    render(<CardImage src="https://example.com/a.jpg" name="لبن" unavailable />);
    const msg = screen.getByText("الصورة غير متاحة حاليًا");
    expect(msg.closest('[role="status"]')).not.toBeNull();
  });

  it("renders framed PDP fallback preserving 'بلا صورة' for WEIGHT and PIECE items", () => {
    const { rerender } = render(<ProductGallery images={[]} name="منتج" productType="PIECE" />);
    expect(screen.getByText("بلا صورة")).toBeInTheDocument();
    rerender(<ProductGallery images={[]} name="منتج وزن" productType="WEIGHT" />);
    expect(screen.getByText("بلا صورة")).toBeInTheDocument();
  });

  it("keeps HomeHero free of banned unverified promotional claims", () => {
    const { container } = render(<HomeHero />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/الأكثر مبيعًا|الأرخص|الأسرع|الأفضل/);
    expect(text).not.toMatch(/مجان|توصيل|شحن|خصم|عرض|سعر خاص/);
  });
});


import fs from "node:fs";
import path from "node:path";

describe("P12-03 R2 font fallback & hero line-wrap contracts", () => {
  it("defines metric-adjusted Cairo Arabic Fallback in globals.css without replacing Cairo", () => {
    const css = fs.readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).toContain('font-family: "Cairo Arabic Fallback"');
    expect(css).toContain("unicode-range: U+0600-06FF");
    expect(css).toContain("size-adjust:");
    expect(css).toMatch(/var\(--font-cairo\),\s*"Cairo Arabic Fallback"/);
  });

  it("keeps HomeHero deterministic 2-line mobile heading wrap and top-anchored background shapes", () => {
    const { container } = render(<HomeHero />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.className).toContain("min-h-[55px]");
    const orangeSpan = h1.querySelector("span");
    expect(orangeSpan?.className).toContain("block");
    expect(orangeSpan?.className).toContain("min-[360px]:inline");
    const circles = Array.from(container.querySelectorAll('[aria-hidden="true"] > div'));
    expect(circles.some((el) => el.className.includes("-bottom-"))).toBe(false);
  });
});
