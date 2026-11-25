// VXP shared scroll-reveal ("use client"): one IntersectionObserver per wrapper,
// unobserved after reveal. Progressive enhancement — SSR HTML is fully visible;
// the "pending" (hidden) state is applied ONLY after JS is alive, so content is
// never hidden when JS fails. globals.css also forces full visibility under
// prefers-reduced-motion.

"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { MOTION_DURATIONS_MS } from "@/lib/motion-tokens";

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
    // Elements within the initial viewport or the immediate lookahead band reveal right away.
    const rect = el.getBoundingClientRect();
    if (rect.bottom > 0 && rect.top < window.innerHeight + 160) {
      el.dataset.reveal = "in";
      return;
    }
    el.dataset.reveal = "pending";
    let settled = false;
    let fallbackTimer = 0;
    const settle = (observer?: IntersectionObserver) => {
      if (settled) return;
      settled = true;
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
      el.dataset.reveal = "in";
      observer?.unobserve(el);
      observer?.disconnect();
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            settle(io);
            break;
          }
        }
      },
      { rootMargin: "0px 0px 160px 0px", threshold: 0.01 },
    );
    io.observe(el);
    // Bounded safety fallback: content must never remain trapped at opacity: 0
    // if IntersectionObserver does not fire (e.g., long sections or full-page captures).
    fallbackTimer = window.setTimeout(() => {
      if (el.dataset.reveal === "pending") {
        settle(io);
      }
    }, MOTION_DURATIONS_MS.fast);
    return () => {
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
      io.disconnect();
    };
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
