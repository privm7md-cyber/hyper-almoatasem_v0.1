// A positive sellable balance proves availability; a negative needs full coverage.
export interface ProductStockCoverage {
  productId: string;
  sellableVariants: number;
  knownSellableBalances: number;
  inStockVariants: number;
  isInStock: boolean;
}

export function productStockState(stock: ProductStockCoverage | null | undefined): "in" | "oos" | "unknown" {
  if (!stock) return "unknown";
  if (stock.inStockVariants > 0) return "in";
  return stock.sellableVariants > 0 && stock.knownSellableBalances === stock.sellableVariants &&
    stock.inStockVariants === 0 ? "oos" : "unknown";
}
