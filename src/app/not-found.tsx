import Link from "next/link";

// Phase-11: the 404 page offered only "back to home". It now offers the real
// destinations a lost visitor needs (the catalogue, search, the account area).
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
        <Link href="/account" className="text-secondary hover:text-brand">
          حسابي
        </Link>
      </div>
    </main>
  );
}
