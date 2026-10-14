// INTERACTIVE PROTOTYPE — admin login (mock; NOT real auth).
"use client";

import { useState } from "react";
import { Field, NoticeBar, PrimaryButton, inputStyle } from "@/prototype/ui";
import { useProto } from "@/prototype/store";

export default function PrototypeAdminLogin() {
  const { adminLogin, notice, pending, runMock } = useProto();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  return (
    <div style={{ maxWidth: 380 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800 }}>دخول الإدارة (محاكاة — بلا مصادقة حقيقية)</h1>
      <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
        <Field label="البريد">
          <input value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
        </Field>
        <Field label="كلمة المرور">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} />
        </Field>
        <PrimaryButton disabled={pending} onClick={() => runMock(() => adminLogin(email.trim().length > 0 && password.length > 0))}>
          {pending ? "جارٍ الدخول (محاكاة)…" : "دخول"}
        </PrimaryButton>
        <p style={{ fontSize: 13, color: "#5B556E" }}>أدخل أي بريد + كلمة مرور للنجاح التجريبي؛ اتركهما فارغين للفشل التجريبي.</p>
      </div>
      <NoticeBar notice={notice} />
    </div>
  );
}
