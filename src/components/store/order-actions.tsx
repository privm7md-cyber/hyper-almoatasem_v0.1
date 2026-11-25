// FE-7 order actions island ("use client"): cancel + replacement decide via adapter actions.
// Server enforces ownership/credential/gates; the UI only renders confirmed outcomes.
// After every mutation the server snapshot is re-read (router.refresh): success, a
// confirmed rejection, and an ambiguous timeout all reconcile instead of leaving a
// stale status or a second clickable action behind.
//
// FOCUS (a11y): the action button REMOVES ITSELF once the action settles, so the
// focus would fall back to <body> and a keyboard user would lose their place. The
// result line is therefore a permanent live region (it exists in the DOM before
// the message arrives, so screen readers actually announce it) and it receives the
// focus when the button disappears. The message itself is only ever written from
// a CONFIRMED server result — an ambiguous transport failure never claims success.

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cancelOrderAction, decideReplacementAction } from "@/app/actions/orders";

export function CancelButton({ orderId, canCancel }: { orderId: string; canCancel: boolean }) {
  const router = useRouter();
  const { notify } = useToast();
  const [pending, setPending] = useState(false);
  const [settled, setSettled] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const resultRef = useRef<HTMLParagraphElement | null>(null);

  // The button is gone once the action settled; move the focus to the result
  // line so the keyboard user keeps a meaningful position (never <body>).
  useEffect(() => {
    if (!settled) return;
    resultRef.current?.focus();
  }, [settled, done]);

  if (!canCancel && !settled) return null;

  async function run() {
    if (pending || settled) return;
    setPending(true);
    const res = await cancelOrderAction(orderId);
    setPending(false);
    if (res.ok) {
      setSettled(true);
      setDone("تم إلغاء الطلب.");
      notify("success", "تم إلغاء الطلب.");
    } else if (res.ambiguous) {
      // Never a success or a failure claim: the outcome is still unknown.
      setSettled(true);
      setDone(res.message);
    } else {
      setDone(res.message);
    }
    router.refresh();
  }
  return (
    <div>
      {canCancel && !settled ? (
        <Button variant="secondary" disabled={pending} onClick={() => void run()}>
          {pending ? "جارٍ إرسال طلب الإلغاء…" : "إلغاء الطلب"}
        </Button>
      ) : null}
      <p
        ref={resultRef}
        role="status"
        aria-live="polite"
        tabIndex={-1}
        className="mt-2 text-sm text-secondary"
      >
        {done ?? ""}
      </p>
    </div>
  );
}

export function DecideButtons({
  orderId,
  replacementId,
  decided,
}: {
  orderId: string;
  replacementId: string;
  decided: boolean;
}) {
  const router = useRouter();
  const { notify } = useToast();
  const [pending, setPending] = useState(false);
  const [settled, setSettled] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const resultRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    if (!settled) return;
    resultRef.current?.focus();
  }, [settled, note]);

  if (decided && !settled) return null;

  async function run(decision: "approve" | "reject") {
    if (pending || settled) return;
    setPending(true);
    setNote(null);
    const res = await decideReplacementAction(orderId, replacementId, decision);
    setPending(false);
    if (res.ok) {
      setSettled(true);
      setNote(decision === "approve" ? "تم قبول البديل." : "تم رفض البديل.");
      notify("success", decision === "approve" ? "تم قبول البديل." : "تم رفض البديل.");
    } else if (res.ambiguous) {
      setSettled(true);
      setNote(res.message);
    } else {
      setNote(res.message);
    }
    router.refresh();
  }
  return (
    <div>
      {!decided && !settled ? (
        <div className="flex gap-2">
          <Button disabled={pending} onClick={() => void run("approve")}>
            {pending ? "جارٍ الإرسال…" : "قبول البديل"}
          </Button>
          <Button variant="secondary" disabled={pending} onClick={() => void run("reject")}>
            رفض البديل
          </Button>
        </div>
      ) : null}
      <p
        ref={resultRef}
        role="status"
        aria-live="polite"
        tabIndex={-1}
        className="mt-2 text-sm text-secondary"
      >
        {note ?? ""}
      </p>
    </div>
  );
}
