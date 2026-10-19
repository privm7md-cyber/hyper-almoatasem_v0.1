// FE-2 store footer (server): approved content only — brand + real destinations.
// No address/phone/hours/social/legal links (all VERIFIED absent — nothing invented).

import Link from "next/link";

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
            احتياجات بيتك بسهولة ووضوح، وثقة في كل خطوة.
          </p>
        </div>
        <nav aria-label="روابط المتجر" className="md:justify-self-end">
          <ul className="grid gap-2 text-sm font-semibold">
            <li>
              <Link href="/" className="inline-flex items-center gap-1.5 transition-colors duration-200 hover:text-white">
                الرئيسية
                <span aria-hidden="true" className="text-[color:var(--brand-orange)]">
                  ‹
                </span>
              </Link>
            </li>
            <li>
              <Link
                href="/search"
                className="inline-flex items-center gap-1.5 transition-colors duration-200 hover:text-white"
              >
                البحث في المنتجات
                <span aria-hidden="true" className="text-[color:var(--brand-orange)]">
                  ‹
                </span>
              </Link>
            </li>
          </ul>
        </nav>
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto w-full max-w-[1200px] px-4 py-4 text-xs text-white/50 md:px-6">
          عصري، نظيف وعملي — هايبر المعتصم
        </div>
      </div>
    </footer>
  );
}
