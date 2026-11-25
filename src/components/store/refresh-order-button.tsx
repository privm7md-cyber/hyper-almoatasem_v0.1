// FE-8 manual refresh island ("use client"): re-reads authoritative order state.
// No polling (no realtime infra — FP-04 refresh contract: fetch on open/action + manual).
// `useTransition` keeps the pending state tied to the server re-render actually
// finishing, instead of a decorative timer that implies success.

"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function RefreshOrderButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
      className="min-h-[44px] rounded-control border border-line-strong bg-white px-4 text-sm font-semibold disabled:opacity-55"
    >
      {pending ? "جارٍ التحديث…" : "تحديث الحالة"}
    </button>
  );
}
