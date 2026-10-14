// FE-5 cart page (server shell + client island; reads need client identity).

import type { Metadata } from "next";
import { StoreShell } from "@/components/store/store-shell";
import { CartView } from "@/components/store/cart-view";
import { PageTitle } from "@/components/ui/container";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "السلة",
  description: "راجع سلة التسوق في هايبر المعتصم.",
  robots: { index: false, follow: false },
};

export default function CartPage() {
  return (
    <StoreShell>
      <div className="mt-6">
        <PageTitle>السلة</PageTitle>
      </div>
      <CartView />
    </StoreShell>
  );
}
