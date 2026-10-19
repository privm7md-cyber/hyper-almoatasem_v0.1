// VXP shared scroll-reveal ("use client"): one IntersectionObserver per wrapper,
// unobserved after reveal. Progressive enhancement — SSR HTML is fully visible;
// the "pending" (hidden) state is applied ONLY after JS is alive, so content is
// never hidden when JS fails. globals.css also forces full visibility under
// prefers-reduced-motion.

"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function Reveal({
  children,
  className = "",
  delayMs = 0,
}: {
  children: ReactNode;
  className?: string;
  /** Small stagger for sibling groups (kept modest; groups share one observer). */
  delayMs?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      // jsdom / legacy engines: keep content visible, opt out entirely.
      el.removeAttribute("data-reveal");
      return;
    }
    el.dataset.reveal = "pending";
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            (entry.target as HTMLElement).dataset.reveal = "in";
            io.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.1 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      data-reveal=""
      style={delayMs ? ({ "--reveal-delay": `${delayMs}ms` } as React.CSSProperties) : undefined}
      className={className}
    >
      {children}
    </div>
  );
}
