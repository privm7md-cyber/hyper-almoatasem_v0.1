// Copy-slug micro island ("use client") — the machine identifier stays
// secondary and is copyable on demand only (never a primary label).

"use client";

import { useState } from "react";

export function CopySlugButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="adm-btn adm-btn--secondary adm-btn--sm"
      aria-label={`نسخ معرّف المنتج: ${value}`}
    >
      {copied ? "تم النسخ" : "انسخ المعرّف"}
    </button>
  );
}
