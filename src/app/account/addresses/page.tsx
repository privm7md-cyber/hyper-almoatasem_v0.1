// FE-6 addresses page (server viewer gate + client book island).

import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { StoreShell } from "@/components/store/store-shell";
import { AddressBook } from "@/components/store/address-book";
import { PageTitle } from "@/components/ui/container";
import { getViewer } from "@/lib/frontend/account-reads";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "العناوين",
  description: "إدارة عناوين التوصيل.",
  robots: { index: false, follow: false },
};

export default async function AddressesPage() {
  const viewer = await getViewer().catch(() => null);
  if (!viewer) redirect("/login");
  return (
    <StoreShell>
      <div className="mt-6">
        <PageTitle>عناويني</PageTitle>
        <div className="mt-3">
          <AddressBook initial={viewer.addresses} />
        </div>
      </div>
    </StoreShell>
  );
}
