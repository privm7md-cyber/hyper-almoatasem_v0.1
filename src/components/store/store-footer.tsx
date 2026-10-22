// FE-2 store footer (server): approved content only — brand + real destinations.
// No address/phone/hours/social/legal links (all VERIFIED absent — nothing invented).
// FE-9 adds the published informational pages only; pages whose content is still
// blocked on owner input are deliberately absent (see the Phase 09 decision register).

import Link from "next/link";

const BROWSE_LINKS = [
  { href: "/", label: "الرئيسية" },
  { href: "/categories", label: "الأقسام" },
  { href: "/brands", label: "العلامات" },
  { href: "/search", label: "البحث في المنتجات" },
  { href: "/cart", label: "السلة" },
  { href: "/account", label: "حسابي" },
  { href: "/orders", label: "طلباتي" },
];

const INFO_LINKS = [
  { href: "/about", label: "من نحن" },
  { href: "/faq", label: "الأسئلة الشائعة" },
  { href: "/delivery", label: "سياسة التوصيل" },
  { href: "/cancellation", label: "سياسة الإلغاء" },
  { href: "/replacement", label: "سياسة الاستبدال" },
  { href: "/order-help", label: "مساعدة الطلب" },
];

export function StoreFooter() {
  return (
    <footer className="mt-10 bg-[color:var(--text-ink)] text-white/75">
      <div
        className="mx-auto grid w-full max-w-[1200px] gap-8 px-4 py-10 md:grid-cols-[auto_1fr_1fr] md:px-6"
        dir="rtl"
      >
        <div>
          <p className="text-lg font-extrabold text-white">
            هايبر <span className="text-[color:var(--brand-orange)]">المعتصم</span>
          </p>
          <p className="mt-1 max-w-[36ch] text-sm leading-relaxed">
            احتياجات بيتك بسهولة ووضوح، وثقة في كل خطوة.
          </p>
        </div>
        <nav aria-label="روابط المتجر" className="md:justify-self-end">
          <h2 className="mb-2 text-sm font-bold text-white">تصفّح</h2>
          <ul className="grid gap-2 text-sm font-semibold">
            {BROWSE_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="inline-flex min-h-[32px] items-center gap-1.5 transition-colors duration-200 hover:text-white"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="معلومات المتجر" className="md:justify-self-end">
          <h2 className="mb-2 text-sm font-bold text-white">معلومات</h2>
          <ul className="grid gap-2 text-sm">
            {INFO_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="inline-flex min-h-[32px] items-center gap-1.5 transition-colors duration-200 hover:text-white"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto w-full max-w-[1200px] px-4 py-4 text-xs text-white/70 md:px-6">
          عصري، نظيف وعملي — هايبر المعتصم
        </div>
      </div>
    </footer>
  );
}
