"use client";

// ADM-11 — the two inbox write actions.
//
// Reads stay on the server. The only hydrated code here is the mark-read
// buttons, and both endpoints scope the write to the signed-in account on the
// server (the id in the URL is never trusted as ownership). On success the
// router refreshes the server-rendered page, so the badge and the row state
// come from the same SQL the page uses.

import { useState } from "react";
import { useRouter } from "next/navigation";

async function post(url: string): Promise<void> {
  const response = await fetch(url, { method: "POST", headers: { accept: "application/json" } });
  if (!response.ok) throw new Error("notification update failed");
}

export function MarkNotificationRead({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <span className="adm-btn-row adm-btn-row--tight">
      <button
        type="button"
        className="adm-btn adm-btn--secondary adm-btn--sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setFailed(false);
          try {
            await post(`/api/admin/notifications/${encodeURIComponent(id)}/read`);
            router.refresh();
          } catch {
            setFailed(true);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "بيتحفظ…" : "علّم كمقروء"}
      </button>
      {failed ? <span role="alert" className="adm-cell-sub">مش قادر أحدّث الإشعار. جرّب تاني.</span> : null}
    </span>
  );
}

export function MarkAllNotificationsRead() {  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <span className="adm-btn-row adm-btn-row--tight">
      <button
        type="button"
        className="adm-btn adm-btn--secondary adm-btn--sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setFailed(false);
          try {
            await post("/api/admin/notifications/read-all");
            router.refresh();
          } catch {
            setFailed(true);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "بيتحفظ…" : "علّم الكل كمقروء"}
      </button>
      {failed ? <span role="alert" className="adm-cell-sub">مش قادر أحدّث الصندوق. جرّب تاني.</span> : null}
    </span>
  );
}

/**
 * ADM-11 (final round) — publish the store's real alerts.
 *
 * The sweep reads the inventory, promotions and coupons rows the admin
 * screens already read and writes one notification per NEW alert; a repeated
 * run never repeats a notice. The button reports only what the server
 * confirmed — no alert is announced before the server answered.
 */
export function SweepStoreAlerts() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  return (
    <span className="adm-btn-row adm-btn-row--tight">
      <button
        type="button"
        className="adm-btn adm-btn--secondary adm-btn--sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setFailed(false);
          setResult(null);
          try {
            const response = await fetch("/api/admin/notifications/sweep", {
              method: "POST",
              headers: { accept: "application/json" },
            });
            if (!response.ok) throw new Error("sweep failed");
            const payload = (await response.json()) as { data?: { alerts?: number; created?: number } };
            const alerts = payload.data?.alerts ?? 0;
            const created = payload.data?.created ?? 0;
            setResult(
              created > 0
                ? `اتسجلت ${created} إشعار جديد من ${alerts} تنبيه.`
                : alerts > 0
                  ? `فيه ${alerts} تنبيه، وكلهم متسجلين قبل كده.`
                  : "مفيش تنبيهات على المتجر دلوقتي.",
            );
            router.refresh();
          } catch {
            setFailed(true);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "بيتحقق…" : "تحديث تنبيهات المتجر"}
      </button>
      {result ? <span className="adm-cell-sub">{result}</span> : null}
      {failed ? (
        <span role="alert" className="adm-cell-sub">مش قادر أحدّث التنبيهات. جرّب تاني.</span>
      ) : null}
    </span>
  );
}
