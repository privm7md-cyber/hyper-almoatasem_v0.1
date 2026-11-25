// FE-1 shared form field foundation ("use client": labeled interactive controls).
// Label always rendered (never placeholder-only); errors via aria-describedby + aria-invalid.

"use client";

import React, { useId } from "react";

export interface FieldProps {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: (ids: { inputId: string; describedBy: string | undefined }) => React.ReactNode;
}

export function Field({ label, required, hint, error, children }: FieldProps) {
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="grid gap-1.5">
      <label htmlFor={inputId} className="text-sm font-semibold text-ink">
        {label}
        {required ? (
          <span aria-hidden="true" className="text-error"> *</span>
        ) : null}
      </label>
      {children({ inputId, describedBy })}
      {hint && !error ? (
        <p id={hintId} className="text-[13px] text-secondary">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-[13px] font-medium text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface TextInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  inputId: string;
  describedBy?: string;
  invalid?: boolean;
}

export function TextInput({ inputId, describedBy, invalid, className = "", ...rest }: TextInputProps) {
  return (
    <input
      id={inputId}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      className={[
        "min-h-[44px] w-full rounded-control border px-3.5 text-base text-ink transition-[border-color,box-shadow,background-color] duration-150 placeholder:text-secondary focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:text-secondary disabled:opacity-65",
        invalid
          ? "border-error bg-white focus:border-error focus-visible:outline-error"
          : "border-line bg-white hover:border-line-strong focus:border-brand focus-visible:outline-focus",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    />
  );
}
