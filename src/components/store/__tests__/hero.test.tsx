// Hero (Phase 05 P05-T02): the hero is a shopping entry point — CTAs must reach
// existing, functioning destinations, and the copy may only contain claims the
// interface can actually prove. No DB needed (presentational component).
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { HomeHero } from "../home-hero";

describe("HomeHero (shopping entry, brand-locked)", () => {
  it("headline carries the approved brand promise wording", () => {
    render(<HomeHero />);
    expect(screen.getByRole("heading", { level: 1, name: /احتياجات بيتك/ })).toBeInTheDocument();
    expect(screen.getByText(/وثقة في كل خطوة/)).toBeInTheDocument();
  });

  it("primary CTA reaches the real /categories destination", () => {
    render(<HomeHero />);
    const cta = screen.getByRole("link", { name: /ابدأ التسوق/ });
    expect(cta).toHaveAttribute("href", "/categories");
  });

  it("secondary CTA reaches the real /brands destination", () => {
    render(<HomeHero />);
    const secondary = screen.getByRole("link", { name: /العلامات التجارية/ });
    expect(secondary).toHaveAttribute("href", "/brands");
  });

  it("interface fact bullets only — no merchandising, delivery, or price claims", () => {
    const { container } = render(<HomeHero />);
    const text = container.textContent ?? "";
    // Claims that require data this store does not have (brands=0, no delivery feed):
    expect(text).not.toMatch(/الأكثر مبيعًا|الأرخص|الأسرع|الأفضل/);
    expect(text).not.toMatch(/مجان|توصيل|شحن|خصم|عرض|سعر خاص/);
    // Facts the interface itself can prove:
    expect(text).toContain("أسعار معروضة بوضوح");
    expect(text).toContain("حالة توفر صادقة");
    expect(text).toContain("أقسام منظّمة");
  });
});
