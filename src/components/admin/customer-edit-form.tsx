// CUSTOMER EDIT ISLAND ("use client").
//
// Contract: PATCH /api/admin/customers/[id] with the strict customer patch
// shape { firstName?, lastName?, email?, autoAcceptReplacements?, isActive? }.
// The phone number is not editable: the patch contract does not accept it and
// the storefront identifies the customer by phone.
//
// The island only talks to the API — every check that matters (policy,
// audit, uniqueness) stays on the server.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/frontend/api-client";
import { adminErrorMessage } from "@/lib/admin/errors";
import { AdminButton, AdminChoices, AdminField, AdminInput } from "@/components/admin/ui/controls";

export function CustomerEditForm({
  customerId,
  firstName,
  lastName,
  email,
  autoAcceptReplacements,
  isActive,
}: {
  customerId: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  autoAcceptReplacements: boolean;
  isActive: boolean;
}) {
  const router = useRouter();
  const [nextFirstName, setNextFirstName] = useState(firstName);
  const [nextLastName, setNextLastName] = useState(lastName ?? "");
  const [nextEmail, setNextEmail] = useState(email ?? "");
  const [nextAutoAccept, setNextAutoAccept] = useState(autoAcceptReplacements);
  const [nextActive, setNextActive] = useState(isActive);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setSaved(false);

    const trimmedFirst = nextFirstName.trim();
    const trimmedLast = nextLastName.trim();
    const trimmedEmail = nextEmail.trim();
    if (trimmedFirst === "") {
      setError("الاسم الأول مطلوب.");
      return;
    }
    if (trimmedEmail !== "" && !trimmedEmail.includes("@")) {
      setError("البريد الإلكتروني شكله مش مظبوط.");
      return;
    }

    setPending(true);
    try {
      await apiRequest(`/api/admin/customers/${customerId}`, {
        method: "PATCH",
        body: {
          firstName: trimmedFirst,
          lastName: trimmedLast === "" ? null : trimmedLast,
          email: trimmedEmail === "" ? null : trimmedEmail,
          autoAcceptReplacements: nextAutoAccept,
          isActive: nextActive,
        },
      });
      setSaved(true);
      router.refresh();
    } catch (failure) {
      setError(
        (failure as { code?: string } | null)?.code === "CONFLICT"
          ? "البريد الإلكتروني ده مستخدم في حساب تاني. جرّب بريد تاني."
          : adminErrorMessage(failure, "تعذّر حفظ بيانات العميل. جرّب تاني."),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="adm-form" noValidate onSubmit={(event) => void submit(event)}>
      <div className="adm-form-grid">
        <AdminField label="الاسم الأول" required>
          {({ inputId, describedBy }) => (
            <AdminInput
              inputId={inputId}
              describedBy={describedBy}
              value={nextFirstName}
              onChange={(event) => setNextFirstName(event.target.value)}
              maxLength={80}
              autoComplete="off"
            />
          )}
        </AdminField>
        <AdminField label="الاسم الأخير" optional>
          {({ inputId, describedBy }) => (
            <AdminInput
              inputId={inputId}
              describedBy={describedBy}
              value={nextLastName}
              onChange={(event) => setNextLastName(event.target.value)}
              maxLength={80}
              autoComplete="off"
            />
          )}
        </AdminField>
      </div>

      <AdminField
        label="البريد الإلكتروني"
        optional
        hint="لو العميل مش مسجل ببريد، سيبه فاضي. التليفون مش بيتغير من هنا."
      >
        {({ inputId, describedBy }) => (
          <AdminInput
            inputId={inputId}
            describedBy={describedBy}
            value={nextEmail}
            onChange={(event) => setNextEmail(event.target.value)}
            maxLength={160}
            dir="ltr"
            autoComplete="off"
          />
        )}
      </AdminField>

      <div className="adm-field">
        <span className="adm-label">حالة حساب العميل</span>
        <AdminChoices
          name="customer-active"
          value={nextActive ? "yes" : "no"}
          onChange={(value) => setNextActive(value === "yes")}
          options={[
            { value: "yes", title: "مفعّل", hint: "العميل يقدر يدخل على المتجر." },
            {
              value: "no",
              title: "موقوف",
              hint: "العميل مش هيقدر يدخل، وطلباته القديمة بتفضل محفوظة.",
            },
          ]}
        />
      </div>

      <div className="adm-field">
        <span className="adm-label">قبول البدائل تلقائيًا</span>
        <AdminChoices
          name="customer-auto-accept"
          value={nextAutoAccept ? "yes" : "no"}
          onChange={(value) => setNextAutoAccept(value === "yes")}
          options={[
            {
              value: "yes",
              title: "يقبل",
              hint: "لو الصنف مش متاح، المتجر بيقبل البديل من غير ما يستأذن العميل.",
            },
            {
              value: "no",
              title: "لا يقبل",
              hint: "العميل لازم يوافق على أي بديل قبل ما الطلب يتحضّر.",
            },
          ]}
        />
      </div>

      {error ? (
        <p className="adm-error" role="alert">
          {error}
        </p>
      ) : null}
      {saved && !error ? (
        <p className="adm-note adm-note--accent">بيانات العميل اتحفظت.</p>
      ) : null}

      <div className="adm-btn-row">
        <AdminButton type="submit" loading={pending}>
          حفظ بيانات العميل
        </AdminButton>
      </div>
    </form>
  );
}
