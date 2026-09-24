import { redirect } from "next/navigation";
import { getCurrentAdmin } from "@/lib/auth/rbac";
import { LoginForm } from "./LoginForm";

export const metadata = {
  title: "تسجيل الدخول — هايبر المعتصم",
};

export default async function AdminLoginPage() {
  const admin = await getCurrentAdmin();
  if (admin) redirect("/admin");
  return (
    <div dir="rtl" className="flex min-h-screen items-center justify-center bg-zinc-50">
      <main className="w-full max-w-sm rounded-2xl bg-white p-8 shadow">
        <h1 className="text-xl font-semibold">تسجيل دخول الإدارة</h1>
        <p className="mt-1 text-sm text-zinc-600">هايبر المعتصم — لوحة الإدارة</p>
        <LoginForm />
      </main>
    </div>
  );
}
