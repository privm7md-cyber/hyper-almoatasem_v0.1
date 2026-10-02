// BA-5 cart serialization (boundary shapes).
//
// Decimals as exact strings (Prisma Decimal toString — numerically exact;
// clients parse as decimal). Money totals as informational piastres +
// display strings (authoritative money is BA-6 checkout's job). Ownership
// exposes customerId or guest:true — never the session hash, never the raw
// token except once at creation (see route).
import type { Cart, CartItem, Product, ProductVariant } from "@prisma/client";
import { dec, iso } from "@/lib/api/serialize";
import { cartSubtotalPiastres, formatPiastres, lineTotalPiastres } from "./totals";

export interface CartLineShape {
  productVariantId: string;
  variantName: string;
  productId: string;
  productName: string;
  productType: string;
  quantity: string;
  unitSnapshot: string;
  unitPriceSnapshot: string | null;
  lineTotal: string | null;
  priceCheckedAt: string | null;
}

type LineRow = CartItem & {
  variant: ProductVariant & { product: Pick<Product, "id" | "name" | "productType"> };
};

export function toCartLine(l: LineRow): CartLineShape {
  const price = dec(l.unitPriceSnapshot);
  const total = lineTotalPiastres(l.quantity.toString(), price);
  return {
    productVariantId: l.productVariantId,
    variantName: l.variant.name,
    productId: l.variant.product.id,
    productName: l.variant.product.name,
    productType: l.variant.product.productType,
    quantity: l.quantity.toString(),
    unitSnapshot: l.unitSnapshot,
    unitPriceSnapshot: price,
    lineTotal: total === null ? null : formatPiastres(total),
    priceCheckedAt: iso(l.priceCheckedAt),
  };
}

export interface CartShape {
  id: string;
  status: string;
  customerId: string | null;
  guest: boolean;
  expiresAt: string | null;
  lines: CartLineShape[];
  /** Informational subtotal over priced lines (see totals.ts). */
  subtotal: string;
  updatedAt: string;
}

type CartRow = Cart & { items: LineRow[] };

export function toCart(c: CartRow): CartShape {
  const lines = c.items.map(toCartLine);
  return {
    id: c.id,
    status: c.status,
    customerId: c.customerId,
    guest: c.customerId === null,
    expiresAt: iso(c.expiresAt),
    lines,
    subtotal: formatPiastres(
      cartSubtotalPiastres(lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPriceSnapshot }))),
    ),
    updatedAt: c.updatedAt.toISOString(),
  };
}
