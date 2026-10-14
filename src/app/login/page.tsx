// FE-6 login page (server shell + island; session cookie HttpOnly, nothing stored).

import type { Metadata } from "next";
import Link from "next/link";
import { StoreShell } from "@/components/store/store-shell";
import { LoginForm } from "@/components/store/login-form";
import { PageTitle } from "@/components/ui/container";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "تسجيل الدخول",
  description: "سجّل الدخول إلى حسابك في هايبر المعتصم.",
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return (
    <StoreShell>
      <div className="mt-6">
        <PageTitle>تسجيل الدخول</PageTitle>
        <div className="mt-3">
          <LoginForm />
        </div>
        <p className="mt-3 text-sm">
          ليس لديك حساب؟{" "}
          <Link href="/register" className="font-semibold text-brand">
            أنشئ حسابًا
          </Link>
        </p>
      </div>
    </StoreShell>
  );
}
