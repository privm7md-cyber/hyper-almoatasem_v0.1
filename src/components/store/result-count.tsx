// Phase 07 (D06): the number of products ACTUALLY SHOWN — never an invented
// catalog total. The count starts at the server-rendered page size and grows
// as the client appends more results ("تحميل المزيد"), so the number on screen
// always matches the cards on screen.
"use client";

import { useEffect, useState } from "react";

/** Event the results island dispatches after appending a page. */
export const RESULTS_APPENDED_EVENT = "catalog:results-appended";

export function ResultCount({ initialCount }: { initialCount: number }) {
  const [count, setCount] = useState(initialCount);

  useEffect(() => {
    function onAppended(event: Event) {
      const detail = (event as CustomEvent<{ added?: number }>).detail;
      const added = typeof detail?.added === "number" ? detail.added : 0;
      if (added > 0) setCount((c) => c + added);
    }
    window.addEventListener(RESULTS_APPENDED_EVENT, onAppended);
    return () => window.removeEventListener(RESULTS_APPENDED_EVENT, onAppended);
  }, []);

  return <span>تم عرض {count} منتج</span>;
}
