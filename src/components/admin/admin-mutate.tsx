// FE-10 admin mutation island ("use client"): confirm + single-flight + toast + refresh.
// Server re-verifies permission + contract on every call (this UI is convenience only).

"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest, displayFailure, type RequestOptions } from "@/lib/frontend/api-client";
import { adminErrorMessage } from "@/lib/admin/errors";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/** DS forms use inline feedback: no toast host or optimistic success required. */
export function useAdminMutation() {
  const router = useRouter();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function mutate<T>(path: string, options: RequestOptions, success: string | ((data: T) => string)) {
    if (busy.current) return undefined;
    busy.current = true;
    setPending(true);
    setNote(null);
    try {
      const { data } = await apiRequest<T>(path, options);
      setNote({ ok: true, text: typeof success === "string" ? success : success(data) });
      router.refresh();
      return data;
    } catch (error) {
      setNote({ ok: false, text: adminErrorMessage(error, "تعذّرت العملية. أعد تحميل البيانات قبل المحاولة مرة تانية.") });
      return undefined;
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return { pending, note, mutate };
}

export function AdminMutationNote({ note }: { note: { ok: boolean; text: string } | null }) {
  return note ? <div role={note.ok ? "status" : "alert"} className={`adm-note adm-note--${note.ok ? "accent" : "danger"}`}><div>{note.text}</div></div> : null;
}

export function AdminAction({
  label,
  path,
  method = "POST",
  body,
  confirmText,
  variant = "secondary",
}: {
  label: string;
  path: string;
  method?: "POST" | "PATCH" | "PUT" | "DELETE";
  body?: Record<string, unknown>;
  confirmText?: string;
  variant?: "primary" | "secondary" | "danger";
}) {
  const router = useRouter();
  const { notify } = useToast();
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await apiRequest(path, { method, body });
      notify("success", "تم تنفيذ العملية.");
      router.refresh();
    } catch (err) {
      setError(displayFailure(err, "تعذّرت العملية."));
    } finally {
      setPending(false);
      setConfirming(false);
    }
  }

  if (confirmText && !confirming) {
    return (
      <Button variant={variant} disabled={pending} onClick={() => setConfirming(true)}>
        {label}
      </Button>
    );
  }

  return (
    <span
      className="inline-flex flex-col gap-1"
      onKeyDown={(e) => {
        if (confirmText && confirming && !pending && e.key === "Escape") {
          e.stopPropagation();
          setConfirming(false);
        }
      }}
    >
      <span className="inline-flex gap-2">
        {confirmText ? <span className="self-center text-sm text-secondary">{confirmText}</span> : null}
        <Button variant={variant} loading={pending} onClick={() => void run()}>
          {confirmText ? "تأكيد" : label}
        </Button>
        {confirmText ? (
          <Button variant="secondary" disabled={pending} onClick={() => setConfirming(false)}>
            تراجع
          </Button>
        ) : null}
      </span>
      {error ? (
        <span role="alert" className="text-xs text-error">
          {error}
        </span>
      ) : null}
    </span>
  );
}
