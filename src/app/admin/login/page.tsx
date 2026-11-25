// ADMIN LOGIN — the only screen an operator sees before the session exists.
//
// It uses the same identity as the panel it opens (graphite + bone + jade),
// and it explains itself: what this screen is, what it is for, and what to
// do if the sign-in fails.

import { redirect } from "next/navigation";
import { getCurrentAdmin } from "@/lib/auth/rbac";
import { LoginForm } from "./LoginForm";

export const metadata = {
  title: "تسجيل دخول الإدارة",
  robots: { index: false, follow: false },
};

export default async function AdminLoginPage() {
  const admin = await getCurrentAdmin();
  if (admin) redirect("/admin");

  return (
    <div className="adm-login">
      <section className="adm-login-card" aria-labelledby="admin-login-title">
        <span className="adm-login-mark" aria-hidden="true">
          ها
        </span>
        <div className="adm-login-copy">
          <h1 id="admin-login-title" className="adm-login-title">تسجيل دخول الإدارة</h1>
          <p className="adm-login-sub">
            بوابة التشغيل المركزية لفريق هايبر المعتصم لإدارة الطلبات، المنتجات، المخزون، والعروض.
          </p>
        </div>
        <LoginForm />
        <p className="adm-login-foot">
          يتم إنشاء حسابات الفريق عبر مالك المتجر ولا يمكن التسجيل الذاتي من هذه الشاشة. عند نسيان البيانات، راجع مسؤول النظام.
        </p>
      </section>
    </div>
  );
}
