// FE-7 order actions island ("use client"): cancel + replacement decide via adapter actions.
// Server enforces ownership/credential/gates; the UI only renders confirmed outcomes.
// Replacement decide is in-scope here (contract endpoint + FE-7 journeys); staff propose paths stay out.

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cancelOrderAction, decideReplacementAction } from "@/app/actions/orders";

export function CancelButton({ orderId, canCancel }: { orderId: string; canCancel: boolean }) {
  const { notify } = useToast();
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  if (!canCancel) return null;
  async function run() {
    if (pending) return;
    setPending(true);
    const res = await cancelOrderAction(orderId);
    setPending(false);
    if (res.ok) {
      setDone("تم إلغاء الطلب.");
      notify("success", "تم إلغاء الطلب.");
    } else {
      setDone(res.message);
    }
  }
  return (
    <div>
      <Button variant="secondary" disabled={pending} onClick={() => void run()}>
        إلغاء الطلب
      </Button>
      {done ? (
        <p role="status" className="mt-2 text-sm text-secondary">
          {done}
        </p>
      ) : null}
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
  const { notify } = useToast();
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  if (decided) return null;
  async function run(decision: "approve" | "reject") {
    if (pending) return;
    setPending(true);
    setNote(null);
    const res = await decideReplacementAction(orderId, replacementId, decision);
    setPending(false);
    if (res.ok) {
      setNote(decision === "approve" ? "تم قبول البديل." : "تم رفض البديل.");
      notify("success", decision === "approve" ? "تم قبول البديل." : "تم رفض البديل.");
    } else {
      setNote(res.message);
    }
  }
  return (
    <div>
      <div className="flex gap-2">
        <Button disabled={pending} onClick={() => void run("approve")}>
          قبول البديل
        </Button>
        <Button variant="secondary" disabled={pending} onClick={() => void run("reject")}>
          رفض البديل
        </Button>
      </div>
      {note ? (
        <p role="status" className="mt-2 text-sm text-secondary">
          {note}
        </p>
      ) : null}
    </div>
  );
}
