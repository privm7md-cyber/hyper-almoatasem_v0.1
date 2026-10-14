// INTERACTIVE PROTOTYPE — orders list (mock: one demo order; guest link demo).
"use client";

import Link from "next/link";
import { C } from "@/prototype/ui";

export default function PrototypeOrders() {
  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 800 }}>طلباتي (محاكاة)</h1>
      <ul style={{ display: "grid", gap: 12, marginTop: 12 }}>
        <li style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: 12 }}>
          <p style={{ fontWeight: 700 }}>HM-000123 — جاري تجهيز طلبك (محاكاة)</p>
          <Link href="/prototype/orders/o-demo-1" style={{ color: C.purple, fontWeight: 700 }}>
            فتح التفاصيل
          </Link>
        </li>
      </ul>
      <p style={{ marginTop: 12, fontSize: 13, color: "#5B556E" }}>
        طلبات الضيف تفتح برابط مباشر + اعتماد محفوظ في السيناريو (محاكاة — بلا Tokens حقيقية).
      </p>
    </div>
  );
}
