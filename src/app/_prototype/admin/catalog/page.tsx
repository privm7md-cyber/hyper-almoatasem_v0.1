// INTERACTIVE PROTOTYPE — admin catalog (mock; empty-state demo toggle).
"use client";

import { useState } from "react";
import Link from "next/link";
import { ADMIN_PRODUCTS } from "@/prototype/mock";
import { C, EmptyState } from "@/prototype/ui";
import { useProto } from "@/prototype/store";

export default function PrototypeAdminCatalog() {
  const { adminAuthed } = useProto();
  const [empty, setEmpty] = useState(false);
  if (!adminAuthed) {
    return <EmptyState title="غير مسجّل (محاكاة)" hint="سجّل الدخول أولًا." action={<Link href="/prototype/admin/login">الدخول</Link>} />;
  }
  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 800 }}>الكتالوج (محاكاة)</h1>
      <button type="button" onClick={() => setEmpty((v) => !v)} style={{ margin: "12px 0", border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 14px", minHeight: 44 }}>
        {empty ? "عرض المنتجات" : "عرض حالة الفارغ (سيناريو 15)"}
      </button>
      {empty ? (
        <EmptyState title="لا توجد منتجات (محاكاة)" hint="أضف منتجًا من النظام الحقيقي لاحقًا." />
      ) : (
        <ul style={{ display: "grid", gap: 8 }}>
          {ADMIN_PRODUCTS.map((p) => (
            <li key={p.id} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 8 }}>
              {p.name} — {p.unit} — {p.price} ج.م — {p.stock} (محاكاة)
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
