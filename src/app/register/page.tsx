// FE-6 registration page (server shell + island). No OTP/verification (contract).

import type { Metadata } from "next";
import Link from "next/link";
import { StoreShell } from "@/components/store/store-shell";
import { RegisterForm } from "@/components/store/register-form";
import { PageTitle } from "@/components/ui/container";
import { returnToQuery } from "@/lib/frontend/return-to";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "إنشاء حساب",
  description: "أنشئ حسابك في هايبر المعتصم.",
  robots: { index: false, follow: false },
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  // NAV-02: keep the safe internal destination across the register↔login cross-link.
  const loginHref = `/login${returnToQuery(typeof params.next === "string" ? params.next : null)}`;
  return (
    <StoreShell>
      <div className="mt-6">
        <PageTitle>إنشاء حساب</PageTitle>
        <div className="mt-3">
          <RegisterForm />
        </div>
        <p className="mt-3 text-sm">
          لديك حساب؟{" "}
          <Link href={loginHref} className="font-semibold text-brand">
            سجّل الدخول
          </Link>
        </p>
      </div>
    </StoreShell>
  );
}
