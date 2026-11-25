// FE-7 checkout page (server shell + client flow island).

import type { Metadata } from "next";
import { cookies } from "next/headers";
import { StoreShell } from "@/components/store/store-shell";
import { CheckoutFlow } from "@/components/store/checkout-flow";
import { PageTitle } from "@/components/ui/container";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "إتمام الطلب",
  description: "راجع طلبك وأتممه في هايبر المعتصم.",
  robots: { index: false, follow: false },
};

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ coupon?: string }>;
}) {
  const sp = await searchParams;
  // The cart hands its coupon code over so the customer does not retype it.
  const coupon = typeof sp.coupon === "string" ? sp.coupon.trim().slice(0, 64) : "";

  const cookieStore = await cookies();
  const hasCustomer =
    cookieStore.has("__Host-customer-session") ||
    cookieStore.has("hyper-customer-session-dev");
  const hasGuestCart = cookieStore.has("hyper_guest_cart");
  const initialEmpty = !hasCustomer && !hasGuestCart;

  return (
    <StoreShell>
      <div className="mt-6">
        <PageTitle>إتمام الطلب</PageTitle>
      </div>
      <CheckoutFlow initialCoupon={coupon} initialEmpty={initialEmpty} />
    </StoreShell>
  );
}
