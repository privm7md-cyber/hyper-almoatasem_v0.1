// FE-1 shared loading/empty/error states ("use client" only where retry handlers attach;
// presentational parts stay serializable). Empty ≠ error, always.

"use client";

import React from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "./button";

export function Spinner({ label = "جارٍ التحميل" }: { label?: string }) {
  return (
    <span role="status" aria-label={label} className="inline-flex items-center gap-2">
      <LoaderCircle className="animate-spin" size={20} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

export function LoadingState({ label, skeleton }: { label?: string; skeleton?: React.ReactNode }) {
  return (
    <div aria-busy="true" className="grid gap-2">
      <Spinner label={label} />
      {skeleton}
    </div>
  );
}

export function SkeletonBlocks({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden="true" className="grid gap-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-14 rounded-card bg-purple-surface" />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-card border border-dashed border-line p-6 text-center">
      <p className="font-bold">{title}</p>
      {hint ? <p className="mt-1 text-secondary">{hint}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "تعذّر التحميل",
  text,
  onRetry,
}: {
  title?: string;
  text: string;
  onRetry?: () => void;
}) {
  return (
    <div role="alert" className="rounded-card border border-error p-6 text-center">
      <p className="font-bold">{title}</p>
      <p className="mt-1 text-secondary">{text}</p>
      {onRetry ? (
        <div className="mt-3">
          <Button variant="secondary" onClick={onRetry}>
            إعادة المحاولة
          </Button>
        </div>
      ) : null}
    </div>
  );
}
