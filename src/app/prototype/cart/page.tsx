// INTERACTIVE PROTOTYPE — cart (mock).
"use client";

import Link from "next/link";
import { getProduct } from "@/prototype/mock";
import { C, EmptyState, NoticeBar, inputStyle } from "@/prototype/ui";
import { useProto } from "@/prototype/store";

export default function PrototypeCart() {
  const { cart, setQty, removeLine, clearCart, notice, pending, runMock } = useProto();
  if (cart.length === 0) {
    return (
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 800 }}>السلة (محاكاة)</h1>
        <div style={{ marginTop: 12 }}>
          <EmptyState
            title="سلتك فاضية (محاكاة)"
            hint="ابدأ التسوق من الأقسام أو البحث."
            action={
              <Link href="/prototype" style={{ color: C.purple, fontWeight: 700 }}>
                إلى الرئيسية
              </Link>
            }
          />
        </div>
      </div>
    );
  }
  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 800 }}>السلة (محاكاة — {cart.length} سطور)</h1>
      <ul style={{ display: "grid", gap: 12, marginTop: 12 }}>
        {cart.map((l) => {
          const p = getProduct(l.productId);
          if (!p) return null;
          return (
            <li key={l.productId} style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: 12 }}>
              <p style={{ fontWeight: 700 }}>{p.name}</p>
              <p>
                <bdi>{p.price} ج.م {p.unit === "KG" ? "/ كجم (تقديري)" : "/ عبوة"} — المجموع تجريبي</bdi>
              </p>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                <input
                  aria-label={`الكمية لـ${p.name}`}
                  value={l.qtyText}
                  onChange={(e) => setQty(l.productId, e.target.value)}
                  style={{ ...inputStyle, maxWidth: 140 }}
                />
                <button
                  type="button"
                  onClick={() => runMock(() => removeLine(l.productId))}
                  style={{ border: `1px solid ${C.error}`, color: C.error, borderRadius: 8, padding: "10px 16px", minHeight: 44 }}
                >
                  إزالة
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <p style={{ marginTop: 12, fontSize: 13, color: "#5B556E" }}>
        الملخص أدناه تجريبي وليس إجمالي Backend. سطر تجريبي متأثر بسعر قديم سيُعاد تأكيده قبل المتابعة (محاكاة).
      </p>
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <Link
          href="/prototype/checkout"
          style={{ background: "#511D9C", color: "#fff", borderRadius: 8, padding: "12px 24px", minHeight: 44, display: "inline-block", fontWeight: 600 }}
        >
          إلى المراجعة (محاكاة)
        </Link>
        <button
          type="button"
          onClick={() => runMock(clearCart)}
          disabled={pending}
          style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 20px", minHeight: 44 }}
        >
          مسح السلة
        </button>
      </div>
      <NoticeBar notice={notice} />
    </div>
  );
}
