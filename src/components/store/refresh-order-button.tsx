// FE-8 manual refresh island ("use client"): re-reads authoritative order state.
// No polling (no realtime infra — FP-04 refresh contract: fetch on open/action + manual).

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RefreshOrderButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        setPending(true);
        router.refresh();
        window.setTimeout(() => setPending(false), 800);
      }}
      className="min-h-[44px] rounded-control border border-line-strong bg-white px-4 text-sm font-semibold disabled:opacity-55"
    >
      {pending ? "جارٍ التحديث…" : "تحديث الحالة"}
    </button>
  );
}
