// INTERACTIVE PROTOTYPE — category (mock).
"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { PRODUCTS, getCategory } from "@/prototype/mock";
import { C, EmptyState } from "@/prototype/ui";

export default function PrototypeCategory() {
  const params = useParams<{ id: string }>();
  const cat = getCategory(params.id);
  if (!cat) {
    return <EmptyState title="القسم غير موجود (محاكاة)" hint="ارجع إلى الرئيسية." action={<Link href="/prototype">الرئيسية</Link>} />;
  }
  const items = PRODUCTS.filter((p) => p.categoryId === cat.id);
  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 800 }}>{cat.name} (محاكاة)</h1>
      {items.length === 0 ? (
        <div style={{ marginTop: 12 }}>
          <EmptyState title="لا توجد منتجات في هذا القسم (محاكاة)" hint="جرّب قسمًا آخر أو البحث." />
        </div>
      ) : (
        <ul style={{ display: "grid", gap: 12, marginTop: 12 }}>
          {items.map((p) => (
            <li key={p.id} style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: 12 }}>
              <p style={{ fontWeight: 700 }}>{p.name}</p>
              <p>
                {p.price} ج.م {p.unit === "KG" ? "/ كجم (تقديري، محاكاة)" : ""}
              </p>
              <p style={{ fontSize: 13, color: p.stock === "in" ? "#15803D" : "#C62828" }}>
                {p.stock === "in" ? "متوفر" : "غير متوفر — ظاهر ومُعطّل (محاكاة)"}
              </p>
              <Link href={`/prototype/product/${p.id}`} style={{ color: C.purple, fontWeight: 700 }}>
                فتح التفاصيل
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
