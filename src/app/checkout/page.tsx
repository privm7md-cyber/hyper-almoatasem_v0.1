// FE-7 checkout page (server shell + client flow island).

import type { Metadata } from "next";
import { StoreShell } from "@/components/store/store-shell";
import { CheckoutFlow } from "@/components/store/checkout-flow";
import { PageTitle } from "@/components/ui/container";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "إتمام الطلب",
  description: "راجع طلبك وأتممه في هايبر المعتصم.",
  robots: { index: false, follow: false },
};

export default function CheckoutPage() {
  return (
    <StoreShell>
      <div className="mt-6">
        <PageTitle>إتمام الطلب</PageTitle>
      </div>
      <CheckoutFlow />
    </StoreShell>
  );
}
