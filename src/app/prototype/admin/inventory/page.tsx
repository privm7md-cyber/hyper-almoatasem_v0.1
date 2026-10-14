// INTERACTIVE PROTOTYPE — admin inventory (mock adjustment demo; nothing persisted).
"use client";

import Link from "next/link";
import { useState } from "react";
import { ADMIN_PRODUCTS } from "@/prototype/mock";
import { C, EmptyState, NoticeBar, PrimaryButton, inputStyle } from "@/prototype/ui";
import { useProto } from "@/prototype/store";

export default function PrototypeAdminInventory() {
  const { adminAuthed, pending, runMock, notice, setNotice } = useProto();
  const [draft, setDraft] = useState("10");
  const [saved, setSaved] = useState<string | null>(null);
  if (!adminAuthed) {
    return <EmptyState title="غير مسجّل (محاكاة)" hint="سجّل الدخول أولًا." action={<Link href="/prototype/admin/login">الدخول</Link>} />;
  }
  function save() {
    const n = Number(draft);
    if (!Number.isFinite(n) || n < 0) {
      setNotice({ kind: "err", text: "قيمة غير صالحة — أدخل رقمًا ≥ صفر (محاكاة للتحقق)." });
      return;
    }
    runMock(() => setSaved(`${n} (محفوظة تجريبيًا — ليست في قاعدة بيانات)`));
  }
  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 800 }}>المخزون (محاكاة)</h1>
      <ul style={{ display: "grid", gap: 8, marginTop: 12 }}>
        {ADMIN_PRODUCTS.map((p) => (
          <li key={p.id} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 8 }}>
            {p.name} — {p.stock} (محاكاة)
          </li>
        ))}
      </ul>
      <h2 style={{ fontWeight: 800, marginTop: 12 }}>تعديل تجريبي (PIECE مقابل WEIGHT مميزان في العرض)</h2>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input aria-label="كمية تجريبية" value={draft} onChange={(e) => setDraft(e.target.value)} inputMode="decimal" style={{ ...inputStyle, maxWidth: 160 }} />
        <PrimaryButton disabled={pending} onClick={save}>
          {pending ? "جارٍ الحفظ (محاكاة)…" : "حفظ تجريبي"}
        </PrimaryButton>
        <button type="button" onClick={() => { setSaved(null); setDraft("10"); }} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 16px", minHeight: 44 }}>
          إعادة تعيين
        </button>
      </div>
      {saved ? <p style={{ marginTop: 8, fontWeight: 700 }}>النتيجة: {saved}</p> : null}
      <NoticeBar notice={notice} />
    </div>
  );
}
