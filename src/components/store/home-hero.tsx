// VXP homepage hero (server, presentational): brand-locked composition — deep purple
// band, Cairo headline, promise copy, real-destination CTAs, honest interface
// descriptors, decorative shelf art built from CSS + Lucide iconography (no imagery,
// no business claims). Entrance is pure CSS (hero-enter classes, staggered delays).

import Link from "next/link";
import { ArrowLeft, Carrot, Cookie, Milk, ShoppingBasket, CircleCheck, Package } from "lucide-react";

const ART_TILES = [
  { Icon: Carrot, className: "bg-white/10 text-white" },
  { Icon: Milk, className: "bg-orange-surface text-[color:var(--brand-orange)]" },
  { Icon: Cookie, className: "bg-white/10 text-white" },
  { Icon: Package, className: "bg-white/10 text-white" },
];

export function HomeHero() {
  return (
    <section
      aria-labelledby="home-hero"
      className="relative mt-6 overflow-hidden rounded-card bg-[color:var(--brand-purple)] px-5 py-9 text-white md:px-10 md:py-14"
    >
      {/* Decorative layer (aria-hidden, pointer-events-none) */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div
          className="hero-enter-fade absolute -left-28 -top-36 h-80 w-80 rounded-full bg-white/[0.07]"
          style={{ "--enter-delay": "60ms" } as React.CSSProperties}
        />
        <div
          className="hero-enter-fade absolute -bottom-40 left-1/3 h-96 w-96 rounded-full bg-white/[0.05]"
          style={{ "--enter-delay": "180ms" } as React.CSSProperties}
        />
        <div
          className="hero-enter-fade absolute -right-16 bottom-1/3 h-72 w-72 rounded-full bg-[color:var(--brand-orange)]/15 blur-2xl"
          style={{ "--enter-delay": "260ms" } as React.CSSProperties}
        />
        <svg
          className="hero-enter-fade absolute left-6 top-8 h-24 w-24 text-white/10"
          style={{ "--enter-delay": "320ms" } as React.CSSProperties}
          viewBox="0 0 24 24"
          fill="none"
        >
          <path
            d="M12 2c4 0 8 2 8 6 0 3-2 5-2 9H6c0-4-2-6-2-9 0-4 4-6 8-6Z"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinejoin="round"
          />
          <circle cx="12" cy="19" r="2.5" stroke="currentColor" strokeWidth="1" />
        </svg>
      </div>

      <div className="relative grid items-center gap-8 md:grid-cols-[1.12fr_0.88fr] md:gap-10">
        <div>
          <h1
            id="home-hero"
            className="hero-enter text-[26px] font-extrabold leading-[1.25] text-white md:text-4xl md:leading-[1.28]"
          >
            احتياجات بيتك بسهولة
            <span className="text-[color:var(--brand-orange)]"> ووضوح</span>
          </h1>
          <p
            className="hero-enter mt-3 max-w-[46ch] text-sm leading-relaxed text-white/80 md:mt-4 md:text-base"
            style={{ "--enter-delay": "120ms" } as React.CSSProperties}
          >
            وثقة في كل خطوة — متجر يومي منظّم: أقسام واضحة، أسعار معروضة، وحالة توفر صادقة.
          </p>

          <div
            className="hero-enter mt-6 flex flex-wrap items-center gap-3 md:mt-7"
            style={{ "--enter-delay": "240ms" } as React.CSSProperties}
          >
            <Link
              href="/categories"
              className="vxp-accent-btn inline-flex min-h-[46px] items-center gap-2 rounded-control bg-[color:var(--brand-orange)] px-6 text-base font-bold text-[color:var(--text-ink)]"
            >
              ابدأ التسوق
              <ArrowLeft size={18} aria-hidden="true" />
            </Link>
            <Link
              href="/brands"
              className="inline-flex min-h-[46px] items-center gap-2 rounded-control border border-white/30 px-6 text-base font-semibold text-white transition-colors duration-200 hover:border-white/60 hover:bg-white/10"
            >
              العلامات التجارية
            </Link>
          </div>

          <ul
            className="hero-enter mt-6 flex flex-wrap gap-x-5 gap-y-2 text-xs font-semibold text-white/75 md:mt-7 md:text-[13px]"
            style={{ "--enter-delay": "360ms" } as React.CSSProperties}
          >
            <li className="flex items-center gap-1.5">
              <CircleCheck size={15} aria-hidden="true" className="text-[color:var(--brand-orange)]" />
              أسعار معروضة بوضوح
            </li>
            <li className="flex items-center gap-1.5">
              <CircleCheck size={15} aria-hidden="true" className="text-[color:var(--brand-orange)]" />
              حالة توفر صادقة
            </li>
            <li className="flex items-center gap-1.5">
              <CircleCheck size={15} aria-hidden="true" className="text-[color:var(--brand-orange)]" />
              أقسام منظّمة
            </li>
          </ul>
        </div>

        {/* Decorative shelf composition — pure CSS/icon mosaic, no invented claims */}
        <div
          className="hero-enter-pop relative hidden items-end justify-center gap-3 md:flex"
          style={{ "--enter-delay": "300ms" } as React.CSSProperties}
          aria-hidden="true"
        >
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              {ART_TILES.map(({ Icon, className }, i) => (
                <span key={i} className={`flex h-20 w-20 items-center justify-center rounded-card ${className}`}>
                  <Icon size={34} strokeWidth={1.6} />
                </span>
              ))}
            </div>
          </div>
          <span className="mb-4 flex h-24 w-24 items-center justify-center rounded-card bg-[color:var(--brand-orange)] text-[color:var(--text-ink)]">
            <ShoppingBasket size={44} strokeWidth={1.7} />
          </span>
        </div>
      </div>
    </section>
  );
}
