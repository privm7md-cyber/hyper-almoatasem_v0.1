import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-[560px] flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-2xl font-bold">الصفحة غير موجودة</h1>
      <p className="text-secondary">الرابط غير صحيح أو المحتوى غير متاح.</p>
      <Link href="/" className="font-semibold text-brand">
        العودة إلى الرئيسية
      </Link>
    </main>
  );
}
