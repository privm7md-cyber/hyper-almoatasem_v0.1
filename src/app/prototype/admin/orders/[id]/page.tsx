// INTERACTIVE PROTOTYPE — admin order detail incl. forbidden-action demo (mock).
"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { C, EmptyState, NoticeBar } from "@/prototype/ui";
import { useProto } from "@/prototype/store";

export default function PrototypeAdminOrderDetail() {
  const params = useParams<{ id: string }>();
  const { adminAuthed, order, pending, runMock, notice, setNotice } = useProto();
  const [forbiddenDemo, setForbiddenDemo] = useState(false);
  if (!adminAuthed) {
    return <EmptyState title="غير مسجّل (محاكاة)" hint="سجّل الدخول أولًا." action={<Link href="/prototype/admin/login">الدخول</Link>} />;
  }
  if (params.id !== order.id) return <EmptyState title="الطلب غير موجود (محاكاة)" hint="ارجع إلى القائمة." />;
  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 800 }}>
        {order.number} — تفاصيل التجهيز (محاكاة)
      </h1>
      <ul style={{ display: "grid", gap: 8, marginTop: 12 }}>
        {order.lines.map((l) => (
          <li key={l.name} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 8 }}>
            {l.name} — {l.qty} — {l.price} ج.م (محاكاة)
          </li>
        ))}
      </ul>
      <h2 style={{ fontWeight: 800, marginTop: 12 }}>إجراءات مسموحة في العقد (محاكاة ناجحة)</h2>
      <button
        type="button"
        disabled={pending}
        onClick={() => runMock(() => setNotice({ kind: "ok", text: "تم تسجيل بدء التجهيز (محاكاة)." }))}
        style={{ background: C.purple, color: "#fff", borderRadius: 8, padding: "10px 20px", minHeight: 44 }}
      >
        بدء التجهيز
      </button>
      <h2 style={{ fontWeight: 800, marginTop: 12 }}>إجراء غير مسموح (سيناريو 16)</h2>
      <button
        type="button"
        onClick={() => setForbiddenDemo(true)}
        style={{ border: `1px solid ${C.error}`, color: C.error, borderRadius: 8, padding: "10px 20px", minHeight: 44 }}
      >
        محاولة إجراء محظور (محاكاة 403)
      </button>
      {forbiddenDemo ? (
        <p role="alert" style={{ color: C.error, marginTop: 8, fontWeight: 700 }}>
          مرفوض: صلاحية غير كافية (محاكاة 403) — لم يُنفَّذ شيء.
        </p>
      ) : null}
      <NoticeBar notice={notice} />
    </div>
  );
}
