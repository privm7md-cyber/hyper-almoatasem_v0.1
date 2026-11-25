"use client";

// NAV-05 (mandatory fix; Phase-04): after an App Router SPA navigation the focus used
// to stay on the triggering control (menu item, header link…) or fall back to <body>,
// so keyboard and screen-reader users lost the page context. This island moves focus
// to the page's <main id="main" tabIndex="-1"> landmark after each route change —
// UNLESS a modal dialog is still open (NAV-01 islands own focus while open).

import { useEffect } from "react";
import { usePathname } from "next/navigation";

interface RouteFocusState {
  lastPathname: string | null;
  pendingPathname: string | null;
  awaitingSettledMain: boolean;
}

const documentStates = new WeakMap<Document, RouteFocusState>();

function getDocumentState(doc: Document): RouteFocusState {
  let state = documentStates.get(doc);
  if (!state) {
    state = {
      lastPathname: null,
      pendingPathname: null,
      awaitingSettledMain: false,
    };
    documentStates.set(doc, state);
  }
  return state;
}

function isRenderedMain(el: HTMLElement, doc: Document): boolean {
  if (el.hidden || el.closest("[hidden], [inert]")) return false;
  if (typeof window !== "undefined" && typeof window.getComputedStyle === "function") {
    let cur: HTMLElement | null = el;
    while (cur && cur !== doc.body) {
      if (window.getComputedStyle(cur).display === "none") return false;
      cur = cur.parentElement;
    }
  }
  return true;
}

function resolveActiveMain(doc: Document): HTMLElement | null {
  const candidates = Array.from(
    doc.querySelectorAll<HTMLElement>('#main, [data-route-loading-main="true"]'),
  );
  if (candidates.length === 0) return null;
  const visible = candidates.filter((el) => isRenderedMain(el, doc));
  const settledVisible = visible.find(
    (el) =>
      el.id === "main" &&
      !el.hasAttribute("data-route-loading-main") &&
      !el.querySelector('[data-route-loading="true"]'),
  );
  if (settledVisible) return settledVisible;
  return visible[visible.length - 1] ?? null;
}

/**
 * Clears per-document route-focus history so isolated unit tests start fresh.
 */
export function resetRouteFocusState(doc: Document = document): void {
  documentStates.delete(doc);
}

export function RouteFocus() {
  const pathname = usePathname();
  // Persist lastPathname/pendingPathname per Document so remounting StoreShell
  // across Next.js App Router pages preserves SPA navigation detection while
  // still skipping initial cold load so the skip link remains the first Tab stop.
  useEffect(() => {
    const state = getDocumentState(document);
    if (state.lastPathname === null) {
      state.lastPathname = pathname;
      return;
    }
    if (state.lastPathname === pathname && state.pendingPathname !== pathname) {
      return;
    }
    state.lastPathname = pathname;
    state.pendingPathname = pathname;

    const frame = requestAnimationFrame(() => {
      // A still-mounted modal dialog keeps its own focus (NAV-01 trap).
      const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
      if (dialog) {
        state.pendingPathname = null;
        state.awaitingSettledMain = false;
        return;
      }
      const target = resolveActiveMain(document);
      if (!target) {
        // Suspended #main is hidden (`display: none`) and settled #main hasn't mounted yet;
        // keep pendingPathname armed for the settled page mount!
        state.awaitingSettledMain = true;
        return;
      }

      const isLoadingBoundary =
        target.hasAttribute("data-route-loading-main") ||
        Boolean(target.querySelector('[data-route-loading="true"]'));
      const active = document.activeElement;
      const movedElsewhereDuringLoad =
        state.awaitingSettledMain &&
        active !== null &&
        active !== document.body &&
        active !== document.documentElement &&
        active !== target &&
        !target.contains(active) &&
        !(active instanceof HTMLElement && active.hasAttribute("data-route-loading-main"));

      if (!movedElsewhereDuringLoad) {
        target.focus();
      }

      if (isLoadingBoundary) {
        // loading.tsx renders a temporary loading <main>; keep pendingPathname
        // armed so focus lands on the settled page <main id="main"> once streaming finishes.
        state.awaitingSettledMain = true;
      } else {
        state.pendingPathname = null;
        state.awaitingSettledMain = false;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  return null;
}
