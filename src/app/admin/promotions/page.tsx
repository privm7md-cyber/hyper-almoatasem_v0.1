// ADMIN PROMOTIONS LIST — the offers the store runs, read by meaning.
//
// Every column answers a question the operator actually asks: what the offer
// is called, what kind of discount it is, what the discount is calculated on
// (the base of the offer), whether it runs, when it runs and which offer wins
// first when two of them meet on the same order.

import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/rbac";
import { listPromotions, listPromotionStates } from "@/lib/promotions/queries";
import {
  PROMOTION_EFFECTIVE_STATUS_LABELS,
  PROMOTION_STATUS_LABELS,
  formatDate,
  promotionEffectiveStatus,
  promotionEffectiveStatusLabel,
  promotionScopeLabel,
  promotionScopeMeaning,
  promotionStatusLabel,
  promotionTypeLabel,
} from "@/lib/admin/terminology";
import {
  DataTable,
  EmptyState,
  ErrorState,
  Note,
  PageHead,
  Panel,
  Pager,
  Pill,
} from "@/components/admin/ui/surfaces";
import { PermissionGate } from "@/components/admin/permission-gate";
import { PromotionCreateForm } from "@/components/admin/promotion-forms";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "العروض — لوحة إدارة هايبر المعتصم",
  robots: { index: false, follow: false },
};

const LIMIT = 20;

/** The pill tone of each state, so the eye finds the running offers first. */
const STATUS_TONE: Record<string, "accent" | "info" | "warn" | "neutral"> = {
  ACTIVE: "accent",
  DRAFT: "info",
  DISABLED: "warn",
};

/** The tone of the EFFECTIVE state (a finished offer is not "running"). */
const EFFECTIVE_TONE: Record<string, "accent" | "info" | "warn" | "neutral"> = {
  LIVE: "accent",
  SCHEDULED: "info",
  DRAFT: "info",
  EXPIRED: "neutral",
  DISABLED: "warn",
};

const EFFECTIVE_STATES = Object.keys(PROMOTION_EFFECTIVE_STATUS_LABELS);

export default async function AdminPromotionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; state?: string; search?: string; cursor?: string }>;
}) {
  const admin = await requirePermission("promotions.view");
  const sp = await searchParams;
  const status =
    typeof sp.status === "string" && Object.keys(PROMOTION_STATUS_LABELS).includes(sp.status)
      ? sp.status
      : null;
  const state =
    typeof sp.state === "string" && EFFECTIVE_STATES.includes(sp.state) ? sp.state : null;
  const search =
    typeof sp.search === "string" && sp.search.trim() !== "" ? sp.search.trim().slice(0, 160) : null;
  const cursor = typeof sp.cursor === "string" && sp.cursor !== "" ? sp.cursor : null;

  // One reference instant for the whole page: the counts, the filter and the
  // status pills can never disagree about what is running right now.
  const now = new Date();

  let rows: Awaited<ReturnType<typeof listPromotions>> | null = null;
  let nextCursor: string | null = null;
  try {
    const found = await listPromotions({ limit: LIMIT, cursor, status, type: null, scope: null, search, state, now });
    // The cursor is the last row this page shows, so the next page starts exactly here.
    const page = found.length > LIMIT ? found.slice(0, LIMIT) : found;
    nextCursor = found.length > LIMIT ? page[page.length - 1].id : null;
    rows = page;
  } catch {
    rows = null;
  }

  // The counts come from the same helper the filter uses.
  const counts: Record<string, number> = { LIVE: 0, SCHEDULED: 0, EXPIRED: 0, DRAFT: 0, DISABLED: 0 };
  try {
    const states = await listPromotionStates();
    for (const row of states) {
      const key = promotionEffectiveStatus(row.status, row.startAt, row.endAt, now);
      counts[key] = (counts[key] ?? 0) + 1;
    }
  } catch {
    // A missing count never blocks the list.
  }

  return (
    <>
      <PageHead
        eyebrow="العروض"
        title="العروض"
        intro="من هنا بتعمل خصم وتربطه بمنتجات معيّنة أو بإجمالي الطلب كله. العرض اللي في حالة مسودة مش بيعمل حاجة على أي طلب لحد ما تفعّله."
      />

      <form method="get" action="/admin/promotions" className="adm-filters">
        <div className="adm-filters-grid">
          <div className="adm-field">
            <label className="adm-label" htmlFor="promotion-state">
              حالة العرض
            </label>
            <select
              id="promotion-state"
              name="state"
              defaultValue={state ?? ""}
              className="adm-select"
            >
              <option value="">كل الحالات</option>
              {EFFECTIVE_STATES.map((value) => (
                <option key={value} value={value}>
                  {PROMOTION_EFFECTIVE_STATUS_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          <div className="adm-field adm-filter-search">
            <label className="adm-label" htmlFor="promotion-search">
              بحث باسم العرض
            </label>
            <input
              id="promotion-search"
              name="search"
              type="search"
              defaultValue={search ?? ""}
              maxLength={160}
              placeholder="اكتب اسم العرض…"
              className="adm-input"
            />
          </div>
          <div className="adm-field">
            <button type="submit" className="adm-btn adm-btn--secondary">
              بحث
            </button>
          </div>
        </div>
      </form>

      <Panel title="العروض حسب حالتها" sub="العدّاد بيتحسب مباشرةً من قاعدة البيانات">
        <ul className="adm-cards">
          {EFFECTIVE_STATES.map((value) => (
            <li className="adm-card" key={value}>
              <span className="adm-cell-title">
                <Pill tone={EFFECTIVE_TONE[value] ?? "neutral"}>
                  {PROMOTION_EFFECTIVE_STATUS_LABELS[value]}
                </Pill>
              </span>
              <span className="adm-cell-sub">{counts[value] ?? 0} عرض</span>
              <Link
                href={`/admin/promotions?state=${value}`}
                className="adm-btn adm-btn--secondary adm-btn--sm"
              >
                اعرضهم
              </Link>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel
        title="كل العروض"
        sub="الأحدث اللي اتعمل في المتجر"
        actions={
          <Link href="/admin/coupons" className="adm-btn adm-btn--secondary adm-btn--sm">
            أكواد الخصم <span aria-hidden="true">←</span>
          </Link>
        }
        flush
      >
        {rows === null ? (
          <ErrorState
            title="مش قادرين نحمّل العروض دلوقتي"
            hint="في مشكلة في قاعدة البيانات. جرّب تاني بعد شوية."
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title="مفيش عروض مطابقة"
            hint="غيّر الفلتر أو البحث، أو اعمل عرض من تحت."
          />
        ) : (
          <DataTable
            caption="عروض المتجر مع نوع الخصم وحالتها وتواريخها"
            columns={[
              { header: "اسم العرض" },
              { header: "نوع الخصم" },
              { header: "على إيه بيتحسب" },
              { header: "الحالة" },
              { header: "تاريخ البداية والنهاية" },
              { header: "الأولوية", numeric: true },
            ]}
            rows={rows.map((row) => {
              const effective = promotionEffectiveStatus(row.status, row.startAt, row.endAt, now);
              return [
                <span key={`${row.id}-name`} className="adm-cell-main">
                  <Link href={`/admin/promotions/${row.id}`} className="adm-cell-title">
                    {row.name}
                  </Link>
                  {row.description ? <span className="adm-cell-sub">{row.description}</span> : null}
                </span>,
                promotionTypeLabel(row.type),
                <span key={`${row.id}-scope`} className="adm-cell-main">
                  <span className="adm-cell-title">{promotionScopeLabel(row.scope)}</span>
                  <span className="adm-cell-sub">{promotionScopeMeaning(row.scope)}</span>
                </span>,
                <span key={`${row.id}-status`} className="adm-cell-main">
                  <span className="adm-cell-title">
                    <Pill tone={EFFECTIVE_TONE[effective] ?? "neutral"}>
                      {promotionEffectiveStatusLabel(row.status, row.startAt, row.endAt, now)}
                    </Pill>
                  </span>
                  <span className="adm-cell-sub">
                    <Pill tone={STATUS_TONE[row.status] ?? "neutral"}>
                      {promotionStatusLabel(row.status)}
                    </Pill>
                  </span>
                </span>,
                row.startAt || row.endAt
                  ? `${formatDate(row.startAt)} — ${formatDate(row.endAt)}`
                  : "من غير تاريخ محدد",
                row.priority,
              ];
            })}
            emptyLabel="مفيش عروض مطابقة."
          />
        )}
      </Panel>

      <Pager
        basePath="/admin/promotions"
        params={{ state: state ?? undefined, search: search ?? undefined }}
        nextCursor={nextCursor}
        label="عرض"
      />

      <Panel
        title="عرض جديد"
        sub="العرض بيتعمل مسودة، وبيشتغل بعد ما تختارله المنتجات ويتفعّل"
      >
        <PermissionGate
          permissions={admin.permissions}
          required="promotions.create"
          action="إنشاء عرض"
        >
          <PromotionCreateForm />
        </PermissionGate>
      </Panel>

      <Note tone="info">
        أنواع الخصم: خصم بنسبة مئوية، خصم بمبلغ ثابت، سعر ثابت للمنتج، واشترِ كذا واحصل على كذا. كل نوع بيتحسب
        على حاجة مختلفة: على المنتجات اللي اخترتها للعرض، أو على إجمالي الطلب كله. العرض في حالة مسودة مش
        بيتطبّق على أي طلب لحد ما يتفعّل.
      </Note>
    </>
  );
}
