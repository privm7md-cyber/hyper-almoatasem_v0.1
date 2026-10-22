import Link from "next/link";

// Phase-11: the forbidden page had NO way back at all (a dead end). It now
// offers the same real destinations the 404 page offers.
export default function Forbidden() {
  return (
    <div dir="rtl" className="flex min-h-screen items-center justify-center bg-zinc-50">
      <main className="max-w-[560px] rounded-2xl bg-white p-8 shadow">
        <h1 className="text-xl font-semibold">403 — غير مصرح</h1>
        <p className="mt-2 text-sm text-zinc-600">
          ليست لديك صلاحية الوصول إلى هذه الصفحة. الحساب المطلوب غير كافٍ — أو انتهت جلستك.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <Link href="/" className="font-semibold text-brand">
            العودة إلى الرئيسية
          </Link>
          <Link href="/categories" className="text-zinc-600 hover:text-brand">
            تصفّح الأقسام
          </Link>
          <Link href="/search" className="text-zinc-600 hover:text-brand">
            البحث في المنتجات
          </Link>
          <Link href="/login" className="text-zinc-600 hover:text-brand">
            تسجيل الدخول
          </Link>
        </div>
      </main>
    </div>
  );
}
