// INTERACTIVE PROTOTYPE shell — isolated under /prototype. Mock only.
import Link from "next/link";
import { ProtoProvider } from "@/prototype/store";
import { SCENARIOS } from "@/prototype/mock";

export const metadata = { title: "نموذج تفاعلي — هايبر المعتصم (محاكاة)" };

const NAV: { href: string; label: string }[] = [
  { href: "/prototype", label: "الرئيسية" },
  { href: "/prototype/category/c-dairy", label: "الأقسام" },
  { href: "/prototype/cart", label: "السلة" },
  { href: "/prototype/orders/o-demo-1", label: "طلباتي" },
  { href: "/prototype/admin/login", label: "الإدارة" },
];

export default function PrototypeLayout({ children }: { children: React.ReactNode }) {
  return (
    <div dir="rtl" lang="ar" style={{ background: "#fff", color: "#1B1530", minHeight: "100vh" }}>
      <div
        role="note"
        className="proto-banner"
        style={{ background: "#1B1530", color: "#fff", textAlign: "center", padding: "8px 12px", fontWeight: 700, overflowWrap: "break-word" }}
      >
        INTERACTIVE PROTOTYPE — MOCK DATA — NO REAL OPERATIONS — نموذج تفاعلي ببيانات تجريبية، لا عمليات حقيقية
      </div>
      <header
        style={{
          display: "flex",
          gap: 16,
          alignItems: "center",
          padding: "12px 16px",
          borderBottom: "1px solid #E4E1EC",
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontWeight: 800, color: "#511D9C" }}>هايبر المعتصم <span style={{ color: "#C2410C" }}>(تجريبي)</span></span>
        <nav aria-label="تنقل النموذج" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} style={{ color: "#511D9C", fontWeight: 600 }}>
              {n.label}
            </Link>
          ))}
        </nav>
      </header>
      <style>{`.proto-cols{display:flex;gap:24px;padding:16px;flex-wrap:wrap}
.proto-main{flex:1 1 480px;min-width:0;max-width:860px}
.proto-aside{flex:0 1 260px;min-width:0}
@media (max-width:720px){.proto-cols{flex-direction:column}.proto-main,.proto-aside{flex:1 1 100%!important;min-width:0!important;max-width:100%!important}.proto-banner{font-size:12px}}
.proto-main a{display:inline-block;padding:6px 4px}`}</style>
      <div className="proto-cols">
        <main className="proto-main">
          <ProtoProvider>{children}</ProtoProvider>
        </main>
        <aside aria-label="مبدّل السيناريوهات" className="proto-aside" style={{ border: "1px solid #E4E1EC", borderRadius: 12, padding: 12, alignSelf: "flex-start" }}>
          <h2 style={{ fontWeight: 800, marginBottom: 8 }}>السيناريوهات (16)</h2>
          <ol style={{ display: "grid", gap: 6, fontSize: 14 }}>
            {SCENARIOS.map((s) => (
              <li key={s.label}>
                <Link href={s.href} style={{ color: "#511D9C" }}>
                  {s.label}
                </Link>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </div>
  );
}
