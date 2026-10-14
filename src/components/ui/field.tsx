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
    <div className="grid gap-1">
      <label htmlFor={inputId} className="text-sm font-semibold">
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
        <p id={errorId} role="alert" className="text-[13px] text-error">
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

export function TextInput({ inputId, describedBy, invalid, ...rest }: TextInputProps) {
  return (
    <input
      id={inputId}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      className="min-h-[44px] w-full rounded-control border border-line bg-white px-3 text-base text-ink"
      {...rest}
    />
  );
}
