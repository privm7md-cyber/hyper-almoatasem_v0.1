// FE-2 store footer (server): approved content only — brand + real destinations.
// No address/phone/hours/social/legal links (all VERIFIED absent — nothing invented).
// Phase-11 adds the "تصفّح" column: the real catalogue, cart, account and
// orders destinations that existed as routes but were unreachable from the UI.

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

export function StoreFooter() {
  return (
    <footer className="mt-10 bg-[color:var(--text-ink)] text-white/75">
      <div
        className="mx-auto grid w-full max-w-[1200px] gap-8 px-4 py-10 md:grid-cols-[auto_1fr] md:px-6"
        dir="rtl"
      >
        <div>
          <p className="text-lg font-extrabold text-white">
            هايبر <span className="text-[color:var(--brand-orange)]">المعتصم</span>
          </p>
          <p className="mt-1 max-w-[36ch] text-sm leading-relaxed">
            احتياجات بيتك اليومية منظّمة — منتجات مخزّنة بعناية، أسعار واضحة وتسليم موثوق.
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
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto w-full max-w-[1200px] px-4 py-4 text-xs text-white/70 md:px-6">
          عصري، نظيف وعملي — هايبر المعتصم
        </div>
      </div>
    </footer>
  );
}
