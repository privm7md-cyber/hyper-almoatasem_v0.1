// FE-6 account page (server): session viewer or honest guest state (never fake data).

import type { Metadata } from "next";
import Link from "next/link";
import { StoreShell } from "@/components/store/store-shell";
import { LogoutButton } from "@/components/store/logout-button";
import { PageTitle } from "@/components/ui/container";
import { getViewer } from "@/lib/frontend/account-reads";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "الحساب",
  description: "حسابك في هايبر المعتصم.",
  robots: { index: false, follow: false },
};

export default async function AccountPage() {
  const viewer = await getViewer().catch(() => null);
  if (!viewer) {
    return (
      <StoreShell>
        <div className="mt-6">
          <PageTitle>الحساب</PageTitle>
          <p className="mt-3 text-secondary">أنت تتصفح كضيف — سجّل الدخول لعرض حسابك وعناوينك وطلباتك.</p>
          <div className="mt-3 flex gap-3">
            <Link href="/login" className="font-semibold text-brand">
              تسجيل الدخول
            </Link>
            <Link href="/register" className="font-semibold text-brand">
              إنشاء حساب
            </Link>
          </div>
        </div>
      </StoreShell>
    );
  }
  const def = viewer.addresses.find((a) => a.isDefault) ?? null;
  return (
    <StoreShell>
      <div className="mt-6 grid gap-4">
        <PageTitle>أهلًا {viewer.firstName}</PageTitle>
        <p className="text-sm text-secondary">
          <bdi>{viewer.phone}</bdi>
        </p>
        <p className="text-sm">
          العنوان الافتراضي: {def ? `${def.label ?? def.city} — ${def.city}` : "غير محدد"}
          {" · "}
          <Link href="/account/addresses" className="font-semibold text-brand">
            إدارة العناوين ({viewer.addresses.length})
          </Link>
        </p>
        <p className="text-sm">
          <Link href="/orders" className="font-semibold text-brand">
            طلباتي
          </Link>
        </p>
        <div>
          <LogoutButton />
        </div>
      </div>
    </StoreShell>
  );
}
