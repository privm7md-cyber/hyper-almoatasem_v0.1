// FE-6 registration page (server shell + island). No OTP/verification (contract).

import type { Metadata } from "next";
import Link from "next/link";
import { StoreShell } from "@/components/store/store-shell";
import { RegisterForm } from "@/components/store/register-form";
import { PageTitle } from "@/components/ui/container";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "إنشاء حساب",
  description: "أنشئ حسابك في هايبر المعتصم.",
  robots: { index: false, follow: false },
};

export default function RegisterPage() {
  return (
    <StoreShell>
      <div className="mt-6">
        <PageTitle>إنشاء حساب</PageTitle>
        <div className="mt-3">
          <RegisterForm />
        </div>
        <p className="mt-3 text-sm">
          لديك حساب؟{" "}
          <Link href="/login" className="font-semibold text-brand">
            سجّل الدخول
          </Link>
        </p>
      </div>
    </StoreShell>
  );
}
