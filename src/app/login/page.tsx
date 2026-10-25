// FE-6 login page (server shell + island; session cookie HttpOnly, nothing stored).

import type { Metadata } from "next";
import Link from "next/link";
import { StoreShell } from "@/components/store/store-shell";
import { LoginForm } from "@/components/store/login-form";
import { PageTitle } from "@/components/ui/container";
import { returnToQuery } from "@/lib/frontend/return-to";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "تسجيل الدخول",
  description: "سجّل الدخول إلى حسابك في هايبر المعتصم.",
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  // NAV-02: keep the safe internal destination across the login↔register cross-link.
  const registerHref = `/register${returnToQuery(typeof params.next === "string" ? params.next : null)}`;
  return (
    <StoreShell>
      <div className="mt-6">
        <PageTitle>تسجيل الدخول</PageTitle>
        <div className="mt-3">
          <LoginForm />
        </div>
        <p className="mt-3 text-sm">
          ليس لديك حساب؟{" "}
          <Link href={registerHref} className="font-semibold text-brand">
            أنشئ حسابًا
          </Link>
        </p>
      </div>
    </StoreShell>
  );
}
