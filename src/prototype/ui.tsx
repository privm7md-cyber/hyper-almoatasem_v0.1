// INTERACTIVE PROTOTYPE shared UI atoms (client-safe, presentational only).
// Colors are the locked palette values (inline, mirrors FP-10 — prototype-scoped).

"use client";

import React from "react";

export const C = {
  purple: "#511D9C",
  orange: "#FF7100",
  textOrange: "#C2410C",
  ink: "#1B1530",
  purpleSurface: "#EEE8F5",
  orangeSurface: "#FFF1E6",
  success: "#15803D",
  error: "#C62828",
  border: "#E4E1EC",
};

export function NoticeBar({ notice }: { notice: { kind: "ok" | "err"; text: string } | null }) {
  if (!notice) return null;
  const ok = notice.kind === "ok";
  return (
    <div
      role={ok ? "status" : "alert"}
      style={{
        border: `1px solid ${ok ? C.success : C.error}`,
        background: ok ? "#E7F4EC" : "#FBE9E9",
        color: C.ink,
        borderRadius: 8,
        padding: "8px 12px",
        margin: "12px 0",
      }}
    >
      {notice.text}
    </div>
  );
}

export function Skeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-label={label} style={{ display: "grid", gap: 8 }}>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{ height: 56, borderRadius: 8, background: C.purpleSurface }} />
      ))}
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint: string; action?: React.ReactNode }) {
  return (
    <div style={{ border: `1px dashed ${C.border}`, borderRadius: 12, padding: 24, textAlign: "center" }}>
      <p style={{ fontWeight: 700 }}>{title}</p>
      <p style={{ color: "#5B556E", marginTop: 4 }}>{hint}</p>
      {action ? <div style={{ marginTop: 12 }}>{action}</div> : null}
    </div>
  );
}

export function ErrorState({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div role="alert" style={{ border: `1px solid ${C.error}`, borderRadius: 12, padding: 24, textAlign: "center" }}>
      <p style={{ fontWeight: 700 }}>تعذّر التحميل (محاكاة)</p>
      <p style={{ color: "#5B556E", marginTop: 4 }}>{text}</p>
      <button
        type="button"
        onClick={onRetry}
        style={{ marginTop: 12, background: C.purple, color: "#fff", borderRadius: 8, padding: "10px 20px", minHeight: 44 }}
      >
        إعادة المحاولة
      </button>
    </div>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        background: disabled ? "#A8A3B8" : C.purple,
        color: "#fff",
        borderRadius: 8,
        padding: "12px 24px",
        minHeight: 44,
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  children,
  error,
}: {
  label: string;
  children: React.ReactNode;
  error?: string;
}) {
  return (
    <label style={{ display: "grid", gap: 4 }}>
      <span style={{ fontWeight: 600, fontSize: 14 }}>{label}</span>
      {children}
      {error ? (
        <span role="alert" style={{ color: C.error, fontSize: 13 }}>
          {error}
        </span>
      ) : null}
    </label>
  );
}

export const inputStyle: React.CSSProperties = {
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  padding: "12px",
  minHeight: 44,
  fontSize: 16,
  background: "#fff",
  color: C.ink,
};
