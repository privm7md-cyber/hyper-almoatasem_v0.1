// ADMIN CONTROLS — the interactive half of the admin design system.
//
// Client components: the button, the form fields, the radio cards, the
// drawer and the confirmation gate. Every control is styled by the admin
// tokens (--adm-*), so the panel looks like one product rather than a mix of
// the storefront's widgets and something else.
//
// Rules encoded here:
//   - Every control has a visible label (never placeholder-only).
//   - Errors are announced (role="alert") and linked with aria-describedby.
//   - Interactive targets are at least 44px tall.
//   - A busy control disables itself — no double submit.

"use client";

import React, { useCallback, useEffect, useId, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";

// The animation runtime is fetched on demand, so no admin page pays for it
// in its first load. See ui/motion-kit.tsx.
const MotionDrawer = dynamic(() => import("./motion-kit").then((mod) => mod.MotionDrawer), {
  ssr: false,
});
const MotionConfirm = dynamic(() => import("./motion-kit").then((mod) => mod.MotionConfirm), {
  ssr: false,
});

/* ---------------------------------------------------------------- button */

export type AdminButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export function AdminButton({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  type = "button",
  children,
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: AdminButtonVariant;
  size?: "md" | "sm";
  loading?: boolean;
}) {
  const busy = loading || rest["aria-busy"] === true;
  const cls = [
    "adm-btn",
    `adm-btn--${variant}`,
    size === "sm" ? "adm-btn--sm" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button type={type} disabled={disabled || loading} aria-busy={busy || undefined} className={cls} {...rest}>
      {loading ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

/** A link that looks like a button (navigation, not an action). */
export function AdminLinkButton({
  href,
  variant = "secondary",
  size = "md",
  children,
  className = "",
  ...rest
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  variant?: AdminButtonVariant;
  size?: "md" | "sm";
}) {
  const cls = [
    "adm-btn",
    `adm-btn--${variant}`,
    size === "sm" ? "adm-btn--sm" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <a href={href} className={cls} {...rest}>
      {children}
    </a>
  );
}

export function AdminRetryButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <AdminButton variant="secondary" loading={pending} onClick={() => startTransition(() => router.refresh())}>
      إعادة المحاولة
    </AdminButton>
  );
}

/* ----------------------------------------------------------------- field */

export interface AdminFieldProps {
  label: string;
  required?: boolean;
  /** "اختياري" marker — shows the field is not mandatory. */
  optional?: boolean;
  hint?: React.ReactNode;
  error?: string;
  children: (ids: { inputId: string; describedBy: string | undefined }) => React.ReactNode;
}

export function AdminField({ label, required, optional, hint, error, children }: AdminFieldProps) {
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="adm-field">
      <label htmlFor={inputId} className="adm-label">
        {label}
        {required ? (
          <span className="adm-required" aria-hidden="true">
            *
          </span>
        ) : null}
        {optional ? <span className="adm-label-opt">(اختياري)</span> : null}
      </label>
      {children({ inputId, describedBy })}
      {hint && !error ? (
        <p id={hintId} className="adm-hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="adm-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function AdminInput({
  inputId,
  describedBy,
  invalid,
  className = "",
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & {
  inputId: string;
  describedBy?: string;
  invalid?: boolean;
}) {
  return (
    <input
      id={inputId}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      className={`adm-input ${className}`.trim()}
      {...rest}
    />
  );
}

export function AdminTextarea({
  inputId,
  describedBy,
  invalid,
  className = "",
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  inputId: string;
  describedBy?: string;
  invalid?: boolean;
}) {
  return (
    <textarea
      id={inputId}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      className={`adm-textarea ${className}`.trim()}
      {...rest}
    />
  );
}

export function AdminSelect({
  inputId,
  describedBy,
  invalid,
  className = "",
  children,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  inputId: string;
  describedBy?: string;
  invalid?: boolean;
}) {
  return (
    <select
      id={inputId}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      className={`adm-select ${className}`.trim()}
      {...rest}
    >
      {children}
    </select>
  );
}

/**
 * Radio cards — the operator chooses by MEANING, not by reading a dropdown
 * of codes. The value stays the machine token; only the visible text changes.
 */
export function AdminChoices({
  name,
  value,
  onChange,
  options,
}: {
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; title: string; hint?: string }[];
}) {
  return (
    <div className="adm-choices" role="radiogroup">
      {options.map((option) => {
        const id = `${name}-${option.value}`;
        return (
          <label key={option.value} className="adm-choice" htmlFor={id}>
            <input
              id={id}
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="adm-sr-input"
            />
            <span className="adm-choice-title">{option.title}</span>
            {option.hint ? <span className="adm-choice-hint">{option.hint}</span> : null}
          </label>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------- drawer */

/**
 * Brings the animation runtime in once the browser is idle, so the first
 * drawer opens without a visible wait while the page's first load stays
 * free of the animation bundle.
 */
function useAnimationRuntime(): { ready: boolean; ensure: () => void } {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const enable = () => {
      if (!cancelled) setReady(true);
    };
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(enable, { timeout: 1500 });
      return () => {
        cancelled = true;
        window.cancelIdleCallback(handle);
      };
    }
    const timer = window.setTimeout(enable, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  const ensure = useCallback(() => {
    if (ready) return;
    void import("./motion-kit").then(() => setReady(true));
  }, [ready]);

  return { ready, ensure };
}

/**
 * A side drawer for forms that must not navigate away (variant editors,
 * price edits). Closes on Escape and on backdrop click, locks the page
 * scroll while open, and restores focus to the trigger.
 */
export function AdminDrawer({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const { ready, ensure } = useAnimationRuntime();
  useEffect(() => {
    if (open) ensure();
  }, [open, ensure]);
  if (!ready && !open) return null;
  return (
    <MotionDrawer open={open} title={title} onClose={onClose} footer={footer}>
      {children}
    </MotionDrawer>
  );
}

/* ------------------------------------------------------------- confirm */

/**
 * A confirmation gate for anything that changes the store's data. The action
 * button states exactly what will happen — the operator never presses a
 * button whose effect is a surprise.
 */
export function ConfirmButton({
  label,
  confirmLabel,
  question,
  onConfirm,
  variant = "danger",
  size = "md",
  disabled,
}: {
  label: string;
  confirmLabel: string;
  question: string;
  onConfirm: () => void;
  variant?: AdminButtonVariant;
  size?: "md" | "sm";
  disabled?: boolean;
}) {
  const { ready, ensure } = useAnimationRuntime();
  const [asking, setAsking] = useState(false);
  const [gateShown, setGateShown] = useState(false);

  const ask = () => {
    setAsking(true);
    setGateShown(true);
    ensure();
  };

  return (
    <span className="adm-confirm">
      {ready ? (
        <MotionConfirm
          open={asking}
          question={question}
          confirmLabel={confirmLabel}
          variant={variant}
          onConfirm={() => {
            setAsking(false);
            onConfirm();
          }}
          onCancel={() => setAsking(false)}
          onExitComplete={() => setGateShown(false)}
        />
      ) : null}
      {gateShown && ready ? null : (
        <AdminButton variant={variant} size={size} disabled={disabled} onClick={ask}>
          {label}
        </AdminButton>
      )}
    </span>
  );
}
