// INTERACTIVE PROTOTYPE — checkout (mock). No backend submit; demo validation + error.
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { C, Field, NoticeBar, PrimaryButton, inputStyle } from "@/prototype/ui";
import { useProto } from "@/prototype/store";

export default function PrototypeCheckout() {
  const { cart, clearCart, pending, runMock, notice, setNotice } = useProto();
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [street, setStreet] = useState("");
  const [errors, setErrors] = useState<{ phone?: string; city?: string }>({});
  const [failNext, setFailNext] = useState(false);

  function validate(): boolean {
    const e: { phone?: string; city?: string } = {};
    if (phone.replace(/\D/g, "").length !== 11) e.phone = "رقم الهاتف يجب أن يكون 11 رقمًا (محاكاة للتحقق).";
    if (city.trim().length < 2) e.city = "المدينة مطلوبة (محاكاة).";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function submit() {
    if (cart.length === 0) {
      setNotice({ kind: "err", text: "السلة فارغة — لا يمكن المتابعة (محاكاة)." });
      return;
    }
    if (!validate()) return;
    if (failNext) {
      runMock(() => {
        setNotice({ kind: "err", text: "خطأ تجريبي غير متوقع — راجع المدخلات وحاول مجددًا (محاكاة). بياناتك محفوظة في الشاشة." });
        setFailNext(false);
      });
      return;
    }
    runMock(() => {
      clearCart();
      router.push("/prototype/confirmation/o-demo-1");
    });
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 800 }}>المراجعة (محاكاة — ضيف، بلا حساب)</h1>
      <p style={{ color: "#5B556E" }}>لا حاجة لإنشاء حساب. رسوم التوصيل 20.00 تجريبية. لا يُرسل شيء للخادم.</p>
      <div style={{ display: "grid", gap: 12, maxWidth: 480, marginTop: 12 }}>
        <Field label="رقم الهاتف" error={errors.phone}>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="01xxxxxxxxx" style={inputStyle} />
        </Field>
        <Field label="المدينة" error={errors.city}>
          <input value={city} onChange={(e) => setCity(e.target.value)} style={inputStyle} />
        </Field>
        <Field label="الشارع / العلامة">
          <input value={street} onChange={(e) => setStreet(e.target.value)} style={inputStyle} />
        </Field>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={failNext} onChange={(e) => setFailNext(e.target.checked)} style={{ width: 20, height: 20 }} />
          <span>محاكاة خطأ عند الإرسال (سيناريو 8)</span>
        </label>
        <PrimaryButton disabled={pending} onClick={submit}>
          {pending ? "جارٍ الإرسال (محاكاة)…" : "تأكيد الطلب (محاكاة)"}
        </PrimaryButton>
        <Link href="/prototype/cart" style={{ color: C.purple, fontWeight: 600 }}>
          العودة إلى السلة (المحتوى محفوظ في الجلسة التجريبية)
        </Link>
      </div>
      <NoticeBar notice={notice} />
    </div>
  );
}
