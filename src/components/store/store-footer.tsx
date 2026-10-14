// FE-2 store footer (server): approved content only — brand + real destinations.
// No address/phone/hours/social/legal links (all VERIFIED absent — nothing invented).

import Link from "next/link";

export function StoreFooter() {
  return (
    <footer className="mt-8 border-t border-line bg-white">
      <div className="mx-auto grid w-full max-w-[1200px] gap-6 px-4 py-8 md:grid-cols-2 md:px-6">
        <div>
          <p className="text-lg font-extrabold text-brand">
            هايبر <span className="text-accent">المعتصم</span>
          </p>
          <p className="mt-1 text-sm text-secondary">احتياجات بيتك بسهولة ووضوح، وثقة في كل خطوة.</p>
        </div>
        <nav aria-label="روابط المتجر">
          <ul className="grid gap-2 text-sm font-semibold">
            <li>
              <Link href="/" className="text-brand">
                الرئيسية
              </Link>
            </li>
            <li>
              <Link href="/search" className="text-brand">
                البحث في المنتجات
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
