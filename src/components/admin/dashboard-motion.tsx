// ADMIN HOME — GSAP choreography (the only gsap import in the app).
//
// Motion ownership split (deliberate, one library per surface):
//   • GSAP          → home hero only: staged entrance, depth push, light sweep.
//   • Motion (React)→ in-place state transitions (drawer, confirm gate).
//   • R3F / three   → the single 3D viewport (lazy, dashboard only).
//   • CSS           → everything else (entrances, hovers, page-level rhythm).
// No element is ever driven by two libraries.
//
// Scope is narrow on purpose: this island lives in src/app/admin/page.tsx and
// is never imported from the root layout or any shared store component, so
// Next.js keeps gsap inside the /admin route chunk. gsap itself is imported
// DYNAMICALLY inside the effect — it is only fetched on the client, only on
// the dashboard, and only when the user has not asked for reduced motion.
//
// Safety contract:
// - gsap "from" tweens (content never pre-hidden by CSS): without JS or before
//   hydration the page is fully readable.
// - One gsap.context() scoped to the hero root; ctx.revert() on unmount — no
//   tween ever survives navigation (no leaks).
// - prefers-reduced-motion: the island returns before importing gsap; the CSS
//   layer additionally settles any residual state.
// - Micro-interactions are appearance-only: nothing here gates an action, and
//   success states still come only from real API responses elsewhere.
//
// Pointer parallax: pointer position writes x/y transforms via gsap.quickTo
// (±6px, capped) — only on (hover: hover) and (pointer: fine); touch devices
// get the static composition only.

"use client";

import { useLayoutEffect, useRef } from "react";

const PARALLAX_MAX = 6; // px; must match --adm-hero-parallax contract in admin.css

export function DashboardMotion() {
  // The host span is always rendered (hidden, aria-hidden) — it exists only to
  // scope the GSAP context to the hero root. No mount state, no
  // setState-in-effect (React Compiler lint), zero visual difference.
  const rootHostRef = useRef<HTMLSpanElement | null>(null);

  useLayoutEffect(() => {
    const root = rootHostRef.current?.closest<HTMLElement>(".adm-viewport") ?? null;
    if (!root || typeof window === "undefined") return;

    let reduce = false;
    let fine = false;
    try {
      reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    } catch {
      // Unknown media-query support: treat as reduced motion (do nothing).
      return;
    }
    if (reduce) return;

    let cancelled = false;
    let dispose: () => void = () => {};

    void (async () => {
      const gsap = (await import("gsap")).default;
      if (cancelled || !root.isConnected) return;

      const ctx = gsap.context(() => {
        // 1. Subtle depth settle — brisk executive motion without blocking content.
        gsap.from(".adm-viewport-canvas", {
          scale: 1.025,
          transformOrigin: "50% 45%",
          duration: 0.34,
          ease: "power2.out",
          clearProps: "transform",
        });

        // 2. Crisp surface sheen — restrained sweep on load.
        gsap.from(".adm-viewport-scrim", {
          backgroundPosition: "115% 0%",
          duration: 0.36,
          ease: "power2.out",
          clearProps: "backgroundPosition",
        });

        // 3. Staged read — stays readable at >=0.7 opacity, short 6px settle.
        gsap.from(".adm-viewport-content > *", {
          opacity: 0.72,
          y: 6,
          duration: 0.28,
          ease: "power2.out",
          stagger: 0.04,
          clearProps: "opacity,transform",
        });
      }, root);

      const cleanups: Array<() => void> = [];
      if (fine) {
        const content = root.querySelector<HTMLElement>(".adm-viewport-content");
        if (content) {
          // gsap typings type quickTo's value as number (DOM props); the
          // runtime accepts strings — cast keeps the runtime exact.
          type QuickToVar = (value: string) => void;
          const toX = gsap.quickTo(content, "x", { duration: 0.4, ease: "power2.out" }) as unknown as QuickToVar;
          const toY = gsap.quickTo(content, "y", { duration: 0.4, ease: "power2.out" }) as unknown as QuickToVar;
          const onMove = (event: PointerEvent) => {
            const rect = root.getBoundingClientRect();
            const nx = (event.clientX - rect.left) / rect.width - 0.5;
            const ny = (event.clientY - rect.top) / rect.height - 0.5;
            toX((nx * PARALLAX_MAX).toFixed(2));
            toY((ny * PARALLAX_MAX).toFixed(2));
          };
          const onLeave = () => {
            toX("0");
            toY("0");
          };
          root.addEventListener("pointermove", onMove);
          root.addEventListener("pointerleave", onLeave);
          cleanups.push(() => {
            root.removeEventListener("pointermove", onMove);
            root.removeEventListener("pointerleave", onLeave);
            content.style.removeProperty("transform");
          });
        }
      }

      dispose = () => {
        cleanups.forEach((fn) => fn());
        ctx.revert();
      };
    })();

    return () => {
      cancelled = true;
      dispose();
    };
  }, []);

  return <span ref={rootHostRef} hidden aria-hidden="true" />;
}
