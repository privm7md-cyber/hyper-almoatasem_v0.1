"use client";

// NAV-05 (mandatory fix; Phase-04): after an App Router SPA navigation the focus used
// to stay on the triggering control (menu item, header link…) or fall back to <body>,
// so keyboard and screen-reader users lost the page context. This island moves focus
// to the page's <main id="main" tabIndex="-1"> landmark after each route change —
// UNLESS a modal dialog is still open (NAV-01 islands own focus while open).

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

export function RouteFocus() {
  const pathname = usePathname();
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const frame = requestAnimationFrame(() => {
      // A still-mounted modal dialog keeps its own focus (NAV-01 trap).
      const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
      if (dialog) return;
      const target = document.getElementById("main");
      if (!target) return;
      target.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  return null;
}
