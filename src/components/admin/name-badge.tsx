// Catalog name trust badge (server-safe presentational).
//
// Phase-14.1 rule: the panel must not HIDE damaged names, must not rewrite
// them, and must not invent replacements. It LABELS them, so the operator can
// see the catalog as it truly is and decide separately whether the data needs
// a restore.
//
// A clean name carries no badge at all — the badge appears exactly when there
// is something to act on, which is the whole point of the signal.

import React from "react";
import { classifyCatalogName } from "@/lib/catalog/name-integrity";
import { NAME_TRUST_LABELS } from "@/lib/admin/terminology";

export function NameBadge({ name }: { name: string }) {
  const trust = classifyCatalogName(name);
  if (trust === "trusted-arabic" || trust === "trusted-latin") return null;
  const label = NAME_TRUST_LABELS[trust] ?? "الاسم محتاج مراجعة";
  const tone = trust === "test-data" ? "adm-pill adm-pill--info" : "adm-pill adm-pill--warn";
  const meaning =
    trust === "test-data"
      ? "الاسم ده جاي من بيانات اختبار مش من بيانات المتجر الحقيقية."
      : "الاسم ده مكتوب بشكل تالف في قاعدة البيانات ومحتاج مراجعة من صاحب المتجر.";
  return (
    <span className={tone} title={meaning}>
      <span className="adm-dot" aria-hidden="true" />
      {label}
    </span>
  );
}
