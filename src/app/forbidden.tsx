export default function Forbidden() {
  return (
    <div dir="rtl" className="flex min-h-screen items-center justify-center bg-zinc-50">
      <main className="rounded-2xl bg-white p-8 shadow">
        <h1 className="text-xl font-semibold">403 — غير مصرح</h1>
        <p className="mt-2 text-sm text-zinc-600">
          ليست لديك صلاحية الوصول إلى هذه الصفحة.
        </p>
      </main>
    </div>
  );
}
