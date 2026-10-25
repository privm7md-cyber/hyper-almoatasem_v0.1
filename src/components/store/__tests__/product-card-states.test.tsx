// ProductCard state matrix (Phase 05): every honest state on the homepage shelf —
// price basis rules (D01), availability chips (DS-02/D25-era semantics), no-image
// fallback, and the FE-11.2 card-buy island gating rules (AC-P3). CardBuy is mocked
// so the gating contract is isolated; no DB involved.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/store/card-buy", () => ({
  CardBuy: ({ productId }: { productId: string }) => (
    <button type="button" data-testid="card-buy-island" data-product={productId}>
      أضف للسلة
    </button>
  ),
}));

import { ProductCard } from "../product-card";
import type { HomeProductCard } from "@/lib/frontend/storefront-reads";

const BASE: HomeProductCard = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "منتج تجريبي للاختبار",
  slug: "slug-plain",
  unit: "PIECE",
  productType: "PIECE",
  saleStepGrams: null,
  sizeValue: null,
  sizeUnit: null,
  price: "15.5",
  compareAt: null,
  stock: "unknown",
  image: null,
  brandName: null,
};

describe("ProductCard (homepage shelf card states)", () => {
  it("PIECE + priced + unknown availability: chip unknown, island stays clickable (AC-P3)", () => {
    render(<ProductCard product={BASE} />);
    expect(screen.getByText("التوفر غير محدد حاليًا")).toBeInTheDocument();
    expect(screen.getByTestId("card-buy-island")).toBeInTheDocument();
    expect(screen.getByText("15.5 ج.م")).toBeInTheDocument();
  });

  it("in-stock: distinct متوفر chip, island present", () => {
    render(<ProductCard product={{ ...BASE, stock: "in" }} />);
    expect(screen.getByText("متوفر")).toBeInTheDocument();
    expect(screen.getByTestId("card-buy-island")).toBeInTheDocument();
  });

  it("OOS: chip غير متوفر and the add island is hidden (PDP owns the disabled add)", () => {
    render(<ProductCard product={{ ...BASE, stock: "oos" }} />);
    expect(screen.getByText("غير متوفر")).toBeInTheDocument();
    expect(screen.queryByTestId("card-buy-island")).not.toBeInTheDocument();
  });

  it("WEIGHT never carries a card island, and KG variants price per kilogram (D01)", () => {
    render(
      <ProductCard
        product={{ ...BASE, productType: "WEIGHT", sizeUnit: "KG", sizeValue: "1" }}
      />,
    );
    expect(screen.queryByTestId("card-buy-island")).not.toBeInTheDocument();
    expect(screen.getByText(/15\.5 ج\.م \/ كجم/)).toBeInTheDocument();
    expect(screen.getByText("سعر الكيلوجرام")).toBeInTheDocument();
  });

  it("no price (no sellable variant shown): honest السعر عند الاختيار, no island, no currency", () => {
    render(<ProductCard product={{ ...BASE, price: null, sizeValue: null }} />);
    expect(screen.getByText("السعر عند الاختيار")).toBeInTheDocument();
    expect(screen.queryByText(/ج\.م/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("card-buy-island")).not.toBeInTheDocument();
  });

  it("reference price is labeled as a reference, never dressed as a discount", () => {
    render(<ProductCard product={{ ...BASE, compareAt: "18" }} />);
    expect(screen.getByText(/السعر المرجعي/)).toBeInTheDocument();
    expect(screen.getByText(/\(ليس عرضًا\)/)).toBeInTheDocument();
  });

  it("missing image does not crash the card: بلا صورة fallback keeps name + price + chip", () => {
    render(<ProductCard product={{ ...BASE, image: null }} />);
    expect(screen.getByText("بلا صورة")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /تفاصيل منتج تجريبي للاختبار/ })).toBeInTheDocument();
    expect(screen.getByText("15.5 ج.م")).toBeInTheDocument();
  });

  it("image present: real <img> with the product name as alt, no fallback text", () => {
    render(<ProductCard product={{ ...BASE, image: "/shop/x.jpg" }} />);
    const img = screen.getByAltText("منتج تجريبي للاختبار");
    expect(img).toHaveAttribute("src", "/shop/x.jpg");
    expect(screen.queryByText("بلا صورة")).not.toBeInTheDocument();
  });

  it("PDP link follows the real route shape with an encoded slug", () => {
    render(<ProductCard product={{ ...BASE, slug: "slug price v2" }} />);
    const link = screen.getByRole("link", { name: /تفاصيل منتج تجريبي للاختبار/ });
    expect(link).toHaveAttribute("href", "/p/11111111-1111-1111-1111-111111111111/slug%20price%20v2");
  });
});
