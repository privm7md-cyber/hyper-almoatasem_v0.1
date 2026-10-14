// INTERACTIVE PROTOTYPE — home (mock). "use client" for demo-state toggles.
"use client";

import Link from "next/link";
import { useState } from "react";
import { CATEGORIES, PRODUCTS } from "@/prototype/mock";
import { C, EmptyState, ErrorState, Skeleton } from "@/prototype/ui";
import { useProto } from "@/prototype/store";

type Demo = "content" | "loading" | "error" | "empty";

export default function PrototypeHome() {
  const [demo, setDemo] = useState<Demo>("content");
  const { resetAll } = useProto();
  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 800 }}>احتياجات بيتك بسهولة ووضوح (محاكاة)</h1>
      <p style={{ color: "#5B556E" }}>بحث بارز + أقسام + بطاقات ببيانات تجريبية. الأسعار هنا خيالية وليست حقيقية.</p>
      <div style={{ display: "flex", gap: 8, margin: "12px 0", flexWrap: "wrap" }}>
        {(["content", "loading", "error", "empty"] as Demo[]).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDemo(d)}
            aria-pressed={demo === d}
            style={{
              border: `1px solid ${C.purple}`,
              borderRadius: 8,
              padding: "8px 14px",
              minHeight: 44,
              background: demo === d ? C.purpleSurface : "#fff",
              fontWeight: 600,
            }}
          >
            {d === "content" ? "المحتوى" : d === "loading" ? "معاينة التحميل" : d === "error" ? "معاينة الخطأ" : "معاينة الفارغ"}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            resetAll();
            setDemo("content");
          }}
          style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 14px", minHeight: 44 }}
        >
          إعادة تعيين السيناريو
        </button>
      </div>
      {demo === "loading" ? <Skeleton label="جارٍ تحميل الرئيسية" /> : null}
      {demo === "error" ? <ErrorState text="تعذّر جلب الأقسام (محاكاة)." onRetry={() => setDemo("content")} /> : null}
      {demo === "empty" ? <EmptyState title="لا توجد أقسام (محاكاة)" hint="عُد لاحقًا أو تصفح البحث." /> : null}
      {demo === "content" ? (
        <>
          <h2 style={{ fontWeight: 800, margin: "16px 0 8px" }}>الأقسام</h2>
          <ul style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {CATEGORIES.map((c) => (
              <li key={c.id} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 16px" }}>
                <Link href={`/prototype/category/${c.id}`} style={{ color: C.purple, fontWeight: 700 }}>
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
          <h2 style={{ fontWeight: 800, margin: "16px 0 8px" }}>منتجات مميزة (تجريبية)</h2>
          <ul style={{ display: "grid", gap: 12 }}>
            {PRODUCTS.filter((p) => p.stock !== "inactive").map((p) => (
              <li key={p.id} style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <div>
                    <p style={{ fontWeight: 700 }}>{p.name}</p>
                    <p>
                      <bdi><span style={{ fontWeight: 800 }}>{p.price} ج.م</span></bdi>
                      {p.compareAt ? (
                        <bdi><span style={{ textDecoration: "line-through", color: "#5B556E", marginInlineStart: 8 }}>
                          {p.compareAt} ج.م
                        </span></bdi>
                      ) : null}
                    </p>
                    <p style={{ fontSize: 13, color: p.stock === "in" ? C.success : C.error }}>
                      {p.stock === "in" ? "متوفر (محاكاة)" : "غير متوفر (محاكاة)"}
                    </p>
                    {p.promoBadge ? (
                      <p style={{ display: "inline-block", background: C.orangeSurface, color: C.ink, borderRadius: 6, padding: "2px 8px", fontSize: 13 }}>
                        {p.promoBadge}
                      </p>
                    ) : null}
                  </div>
                  <Link
                    href={`/prototype/product/${p.id}`}
                    style={{ alignSelf: "center", background: "#511D9C", color: "#fff", borderRadius: 8, padding: "12px 24px", minHeight: 44, display: "inline-block", fontWeight: 600 }}
                  >
                    التفاصيل
                  </Link>
                </div>
              </li>
            ))}
          </ul>
          <p style={{ marginTop: 12, fontSize: 13, color: "#5B556E" }}>
            ملاحظة: الشارات والأسعار أعلاه بيانات سيناريو، وليست عروضًا حقيقية متصلة بمصدر بيانات.
          </p>
        </>
      ) : null}
    </div>
  );
}
