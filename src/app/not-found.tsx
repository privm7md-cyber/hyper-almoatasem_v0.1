import Link from "next/link";

// FE-9: the not-found page keeps the honest 404 semantics and offers real
// recovery destinations (the store, the catalogue, search, order help).
export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-[560px] flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-2xl font-bold">الصفحة غير موجودة</h1>
      <p className="text-secondary">الرابط غير صحيح أو المحتوى غير متاح.</p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-3 text-sm">
        <Link href="/" className="font-semibold text-brand">
          العودة إلى الرئيسية
        </Link>
        <Link href="/categories" className="text-secondary hover:text-brand">
          تصفّح الأقسام
        </Link>
        <Link href="/search" className="text-secondary hover:text-brand">
          البحث في المنتجات
        </Link>
        <Link href="/order-help" className="text-secondary hover:text-brand">
          مساعدة الطلب
        </Link>
      </div>
    </main>
  );
}
