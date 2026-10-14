// INTERACTIVE PROTOTYPE — admin dashboard (mock indicators, labeled mock).
"use client";

import Link from "next/link";
import { C, EmptyState } from "@/prototype/ui";
import { useProto } from "@/prototype/store";

const LINKS = [
  { href: "/prototype/admin/catalog", label: "الكتالوج" },
  { href: "/prototype/admin/inventory", label: "المخزون" },
  { href: "/prototype/admin/orders", label: "الطلبات" },
];

export default function PrototypeAdminDashboard() {
  const { adminAuthed, adminLogout } = useProto();
  if (!adminAuthed) {
    return (
      <EmptyState
        title="غير مسجّل (محاكاة)"
        hint="سجّل الدخول التجريبي أولًا."
        action={
          <Link href="/prototype/admin/login" style={{ color: C.purple, fontWeight: 700 }}>
            إلى الدخول
          </Link>
        }
      />
    );
  }
  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 800 }}>لوحة الإدارة (محاكاة)</h1>
      <p style={{ color: "#5B556E" }}>مؤشرات تجريبية — ليست بيانات حقيقية: طلبات اليوم 12، قيد التجهيز 5، مخزون منخفض 3.</p>
      <ul style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        {LINKS.map((l) => (
          <li key={l.href} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 16px" }}>
            <Link href={l.href} style={{ color: C.purple, fontWeight: 700 }}>
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
      <button type="button" onClick={adminLogout} style={{ marginTop: 16, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 20px", minHeight: 44 }}>
        خروج تجريبي
      </button>
    </div>
  );
}
