// FE-1 shared Button primitive ("use client": leaf interactive element).
// Variants per FP-10 §14. type="button" default (safe); opt-in submit. min 44px targets.

"use client";

import React from "react";

export type ButtonVariant = "primary" | "secondary" | "text" | "danger" | "icon";
export type ButtonSize = "md" | "sm";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "bg-brand text-white",
  secondary: "bg-transparent border border-line-strong text-ink",
  text: "bg-transparent text-brand",
  danger: "bg-error text-white",
  icon: "bg-transparent text-ink",
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
        "inline-flex items-center justify-center gap-2 rounded-control font-semibold",
        size === "md" ? "min-h-[44px] px-6 text-base" : "min-h-[40px] px-4 text-sm",
        VARIANT_CLASS[variant],
        "disabled:cursor-not-allowed disabled:opacity-55",
        extraClass,
      ].join(" ")}
    >
      {children}
    </button>
  );
}
