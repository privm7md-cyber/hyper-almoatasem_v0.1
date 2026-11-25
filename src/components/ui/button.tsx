// FE-1 shared Button primitive ("use client": leaf interactive element).
// Variants per FP-10 §14. type="button" default (safe); opt-in submit. min 44px targets.

"use client";

import React from "react";
import { LoaderCircle } from "lucide-react";

export type ButtonVariant = "primary" | "secondary" | "text" | "danger" | "icon";
export type ButtonSize = "md" | "sm";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary:
    "bg-brand text-white shadow-xs hover:bg-[color:var(--state-brand-hover)] active:bg-[color:var(--state-brand-active)] active:translate-y-px disabled:hover:bg-brand disabled:active:translate-y-0",
  secondary:
    "bg-white border border-line-strong text-ink hover:border-brand hover:bg-purple-surface active:bg-[color:var(--state-secondary-active)] disabled:hover:border-line-strong disabled:hover:bg-white",
  text: "bg-transparent text-brand hover:bg-purple-surface active:bg-[color:var(--state-secondary-active)] disabled:hover:bg-transparent",
  danger:
    "bg-error text-white shadow-xs hover:bg-[color:var(--state-danger-hover)] active:bg-[color:var(--state-danger-active)] disabled:hover:bg-error",
  icon: "min-w-[44px] px-2.5 bg-transparent text-ink hover:bg-purple-surface active:bg-[color:var(--state-secondary-active)] disabled:hover:bg-transparent",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  type = "button",
  children,
  className: extraClass = "",
  ...rest
}: ButtonProps) {
  const busy = loading || rest["aria-busy"] === true;
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={busy || undefined}
      {...rest}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-control font-semibold transition-[background-color,border-color,color,box-shadow,transform] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
        size === "md" ? "min-h-[44px] px-6 text-base" : "min-h-[44px] px-4 text-sm",
        VARIANT_CLASS[variant],
        "disabled:cursor-not-allowed disabled:opacity-55",
        extraClass,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {loading ? <LoaderCircle size={16} className="shrink-0 animate-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
