// INTERACTIVE PROTOTYPE — admin orders list (mock).
"use client";

import Link from "next/link";
import { C, EmptyState } from "@/prototype/ui";
import { useProto } from "@/prototype/store";

export default function PrototypeAdminOrders() {
  const { adminAuthed, order } = useProto();
  if (!adminAuthed) {
    return <EmptyState title="غير مسجّل (محاكاة)" hint="سجّل الدخول أولًا." action={<Link href="/prototype/admin/login">الدخول</Link>} />;
  }
  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 800 }}>الطلبات (محاكاة)</h1>
      <ul style={{ display: "grid", gap: 8, marginTop: 12 }}>
        <li style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 8 }}>
          {order.number} — جاري تجهيز طلبك (محاكاة) — مطلوب: 1250 جم / فعلي: 1180 جم{" "}
          <Link href="/prototype/admin/orders/o-demo-1" style={{ color: C.purple, fontWeight: 700 }}>
            فتح التفاصيل
          </Link>
        </li>
      </ul>
    </div>
  );
}
