// INTERACTIVE PROTOTYPE — product detail (mock), PIECE vs WEIGHT separated.
"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { getProduct } from "@/prototype/mock";
import { C, EmptyState, NoticeBar, PrimaryButton, inputStyle } from "@/prototype/ui";
import { useProto } from "@/prototype/store";

export default function PrototypeProduct() {
  const params = useParams<{ id: string }>();
  const p = getProduct(params.id);
  const { addToCart, notice, pending, runMock } = useProto();
  const [grams, setGrams] = useState("500");
  const [packs, setPacks] = useState("1");
  const [localError, setLocalError] = useState<string | null>(null);

  if (!p) return <EmptyState title="المنتج غير موجود (محاكاة)" hint="ارجع إلى القسم." />;

  const isWeight = p.unit !== "PIECE";
  const oos = p.stock !== "in";
  const pid = p.id;
  const stepGrams = p.saleStepGrams ?? 1;

  function submitAdd() {
    setLocalError(null);
    if (isWeight) {
      const g = Number(grams);
      const step = stepGrams;
      if (!Number.isFinite(g) || g <= 0 || g % step !== 0) {
        setLocalError(`الوزن يجب أن يكون من مضاعفات ${step} جم (محاكاة لقاعدة الخطوة).`);
        return;
      }
      runMock(() => addToCart(pid, `${g} جم`));
    } else {
      runMock(() => addToCart(pid, `${packs} عبوة`));
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 800 }}>{p.name}</h1>
      <p style={{ color: "#5B556E" }}>الوحدة: {p.unit === "PIECE" ? "بالقطعة/العبوة" : "بالوزن (كجم)"} — محاكاة</p>
      <p style={{ marginTop: 8 }}>
        <bdi><span style={{ fontWeight: 800, fontSize: 20 }}>{p.price} ج.م</span></bdi>
        {p.compareAt ? (
          <bdi><span style={{ textDecoration: "line-through", color: "#5B556E", marginInlineStart: 8 }}>
            {p.compareAt} ج.م (مرجع تجريبي، ليس إثبات عرض)
          </span></bdi>
        ) : null}
      </p>
      {p.promoBadge ? (
        <p style={{ display: "inline-block", background: C.orangeSurface, borderRadius: 6, padding: "2px 8px" }}>
          {p.promoBadge} — شارة سيناريو فقط
        </p>
      ) : null}
      <p style={{ marginTop: 8, fontWeight: 700, color: oos ? C.error : C.success }}>
        {oos ? "غير متوفر (محاكاة) — الزر معطّل" : "متوفر (محاكاة)"}
      </p>
      {isWeight ? (
        <div style={{ marginTop: 12, display: "grid", gap: 8, maxWidth: 320 }}>
          <p>اختر الوزن (مضاعفات {p.saleStepGrams} جم — محاكاة):</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(p.presetsGrams ?? []).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGrams(String(g))}
                aria-pressed={grams === String(g)}
                style={{
                  border: `1px solid ${C.purple}`,
                  borderRadius: 8,
                  padding: "8px 14px",
                  minHeight: 44,
                  background: grams === String(g) ? C.purpleSurface : "#fff",
                  fontWeight: 600,
                }}
              >
                {g >= 1000 ? `${g / 1000} كجم` : `${g} جم`}
              </button>
            ))}
          </div>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 14 }}>وزن مخصص بالجرام</span>
            <input value={grams} onChange={(e) => setGrams(e.target.value)} inputMode="numeric" style={inputStyle} />
          </label>
          <p style={{ fontSize: 13, color: "#5B556E" }}>تقدير تجريبي غير نهائي — النهائي عند التجهيز في النظام الحقيقي.</p>
        </div>
      ) : (
        <label style={{ display: "grid", gap: 4, maxWidth: 200, marginTop: 12 }}>
          <span style={{ fontSize: 14 }}>الكمية (عبوات صحيحة)</span>
          <input value={packs} onChange={(e) => setPacks(e.target.value)} inputMode="numeric" style={inputStyle} />
        </label>
      )}
      {localError ? (
        <p role="alert" style={{ color: C.error, marginTop: 8 }}>
          {localError}
        </p>
      ) : null}
      <div style={{ marginTop: 12 }}>
        <PrimaryButton disabled={oos || pending} onClick={submitAdd}>
          {pending ? "جارٍ الإضافة (محاكاة)…" : oos ? "غير متوفر" : "أضف إلى السلة (محاكاة)"}
        </PrimaryButton>
      </div>
      <NoticeBar notice={notice} />
    </div>
  );
}
