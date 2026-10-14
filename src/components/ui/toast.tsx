// FE-1 internal toast foundation ("use client"). No external library (contract decision).
// aria-live polite for info/success, assertive for errors; icon + text (never color-only); manual
// dismiss; transient auto-dismiss except errors (persist until dismissed); secrets must never be passed
// as message content (callers own that rule; this module renders strings verbatim).

"use client";

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";

export type ToastKind = "success" | "error" | "info" | "warning";

export interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  body?: string;
}

interface ToastApi {
  notify: (kind: ToastKind, title: string, body?: string) => void;
  dismiss: (id: number) => void;
}

const ToastCtx = createContext<ToastApi | null>(null);

const KIND_META: Record<ToastKind, { Icon: typeof Info; ring: string; live: "polite" | "assertive" }> = {
  success: { Icon: CircleCheck, ring: "border-success", live: "polite" },
  error: { Icon: CircleAlert, ring: "border-error", live: "assertive" },
  info: { Icon: Info, ring: "border-line-strong", live: "polite" },
  warning: { Icon: TriangleAlert, ring: "border-warning-fg", live: "polite" },
};

const AUTO_DISMISS_MS = 6000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const notify = useCallback(
    (kind: ToastKind, title: string, body?: string) => {
      seq.current += 1;
      const id = seq.current;
      setItems((prev) => [...prev.slice(-3), { id, kind, title, body }]);
      if (kind !== "error") {
        timers.current.set(id, setTimeout(() => dismiss(id), AUTO_DISMISS_MS));
      }
    },
    [dismiss],
  );

  const api = useMemo(() => ({ notify, dismiss }), [notify, dismiss]);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div
        role="region"
        aria-label="التنبيهات"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-toast flex flex-col items-center gap-2 p-4"
      >
        {items.map((item) => {
          const meta = KIND_META[item.kind];
          return (
            <div
              key={item.id}
              role={item.kind === "error" ? "alert" : "status"}
              aria-live={meta.live}
              className={`pointer-events-auto flex w-full max-w-md items-start gap-2 rounded-card border bg-white p-3 shadow-elevated ${meta.ring}`}
            >
              <meta.Icon size={20} aria-hidden="true" className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{item.title}</p>
                {item.body ? <p className="text-sm text-secondary">{item.body}</p> : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                aria-label="إغلاق التنبيه"
                className="min-h-[44px] min-w-[44px] shrink-0 rounded-control"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastCtx);
  if (!api) throw new Error("useToast outside ToastProvider (foundation wiring)");
  return api;
}
