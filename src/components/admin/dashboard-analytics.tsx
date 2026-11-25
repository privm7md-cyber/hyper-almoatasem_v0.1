import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, ArrowLeft, LockKeyhole } from "lucide-react";
import {
  KPI_CONTRACTS, metricHref,
  type DashboardData, type DashboardMetric, type MetricState, type ReadResult,
} from "@/lib/admin/dashboard-contract";
import { calendarDayAt, RANGE_LABELS, type DashboardRange } from "@/lib/admin/date-range";
import {
  formatDate, formatDateTime, formatMoney, formatQuantity,
  orderStatusLabel, permissionLabel,
} from "@/lib/admin/terminology";
import styles from "./dashboard-analytics.module.css";

type SearchParams = Record<string, string | string[] | undefined>;
const count = (value: number) => value.toLocaleString("en-US");
const percent = (value: number) => `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
const STATE_LABELS: Record<Exclude<MetricState, "ready">, string> = {
  denied: "غير مسموح", error: "تعذّر تحميل البيانات", unavailable: "غير متاح من المصدر",
};
const COLORS: Record<string, string> = {
  NEW: "var(--adm-accent)", CONFIRMED: "#6d35c4", PREPARING: "#8f5ce6",
  READY_FOR_DELIVERY: "var(--adm-brand-orange-ink)", OUT_FOR_DELIVERY: "#ff7100",
  DELIVERED: "var(--adm-success)", CANCELLED: "var(--adm-danger)",
};

export function DashboardRangeSelector({ range, params, error }: {
  range: DashboardRange; params: SearchParams; error: string | null;
}) {
  const from = range.preset === "custom" && typeof params.from === "string" ? params.from : range.fromDay;
  const to = range.preset === "custom" && typeof params.to === "string" ? params.to : range.toDay;
  // Native uncontrolled fields must reset after navigation, including back/forward.
  const formKey = JSON.stringify([params.range, params.from, params.to, range.fromDay, range.toDay]);
  return (
    <section className={styles.rangePanel} aria-labelledby="dashboard-range-heading">
      <div className={styles.sectionHead}>
        <div><p className={styles.eyebrow}>نافذة القراءة</p><h2 id="dashboard-range-heading">الفترة الزمنية</h2></div>
        {!error && <p className={styles.dateSpan}><bdi>{formatDate(range.fromDay)}</bdi><span aria-hidden="true"> — </span><bdi>{formatDate(range.toDay)}</bdi></p>}
      </div>
      <form key={formKey} action="/admin" method="get" className={styles.rangeForm} aria-label="اختيار فترة لوحة التشغيل" aria-describedby="dashboard-range-hint">
        <div className={styles.field}>
          <label htmlFor="dashboard-range">الفترة</label>
          <select id="dashboard-range" name="range" defaultValue={range.preset}>
            {Object.entries(RANGE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor="dashboard-from">من تاريخ (للنطاق المخصص)</label>
          <input id="dashboard-from" type="date" name="from" defaultValue={from} aria-invalid={error ? true : undefined} aria-describedby={error ? "dashboard-range-error" : undefined} />
        </div>
        <div className={styles.field}>
          <label htmlFor="dashboard-to">إلى تاريخ (للنطاق المخصص)</label>
          <input id="dashboard-to" type="date" name="to" defaultValue={to} aria-invalid={error ? true : undefined} aria-describedby={error ? "dashboard-range-error" : undefined} />
        </div>
        <button type="submit" className={styles.submit}>تطبيق الفترة <ArrowLeft size={16} aria-hidden="true" /></button>
      </form>
      <p id="dashboard-range-hint" className={styles.muted}>بتوقيت القاهرة؛ يوم النهاية مشمول. التاريخان يُستخدمان مع «نطاق مخصص» فقط، حتى 366 يومًا. الفترة تُطبّق على الطلبات ورسومها وآخر الطلبات، وليس الكتالوج والمخزون الحالي.</p>
      {error && <p id="dashboard-range-error" className={styles.rangeError} role="alert">{error} لم تُجرَ قراءة التحليلات. صحّح الفترة ثم اضغط تطبيق.</p>}
    </section>
  );
}

function SourceState({ state, note, retryHref, label }: {
  state: Exclude<MetricState, "ready">; note: string | null; retryHref: string; label: string;
}) {
  return (
    <div className={styles.sourceState} data-state={state} role={state === "error" ? "alert" : undefined}>
      <p className={styles.stateLabel}>{state === "denied" ? <LockKeyhole size={15} aria-hidden="true" /> : <AlertTriangle size={15} aria-hidden="true" />}{STATE_LABELS[state]}</p>
      <p className={styles.muted}>{note || (state === "denied" ? "اطلب الصلاحية من مالك المتجر؛ لا يُعرض عدد أو رابط تفاصيل." : "لم يصل رقم مكتمل من المصدر؛ لا يُعامل كصفر.")}</p>
      {state === "error" && <a className={styles.textLink} href={retryHref} aria-label={`إعادة المحاولة: ${label}`}>إعادة المحاولة</a>}
    </div>
  );
}

function Comparison({ metric }: { metric: DashboardMetric }) {
  if (metric.previous === null || metric.previous === "") return <p className={styles.muted}>المقارنة السابقة غير متاحة.</p>;
  const previous = Number(metric.previous);
  const current = Number(metric.value);
  if (!Number.isFinite(previous) || !Number.isFinite(current)) return <p className={styles.muted}>المقارنة السابقة غير متاحة.</p>;
  const change = metric.changePercent;
  return (
    <p className={styles.comparison}>
      <span>السابق: <bdi>{formatQuantity(metric.previous)}</bdi></span>
      <span>{previous === 0
        ? current === 0 ? "لا تغيير؛ الفترتان صفر" : "لا تُحسب نسبة التغيّر؛ الأساس السابق صفر"
        : change === null || !Number.isFinite(change) ? "نسبة التغيّر غير متاحة" : <bdi>{change > 0 ? "+" : ""}{percent(change)}</bdi>}</span>
    </p>
  );
}

function MetricCard({ contract, metric, range, retryHref }: {
  contract: typeof KPI_CONTRACTS[number]; metric: DashboardMetric; range: DashboardRange; retryHref: string;
}) {
  const href = metric.state === "ready" ? metricHref(contract.id, range) : null;
  return (
    <article className={styles.metric} data-kpi={contract.id} data-state={metric.state} aria-labelledby={`kpi-${contract.id}`}>
      <div className={styles.metricHead}><h3 id={`kpi-${contract.id}`}>{contract.label}</h3><span className={styles.period}>{contract.period === "current" ? "الآن" : "الفترة"}</span></div>
      {metric.state === "ready" ? <>
        <p className={styles.value} data-metric-value><bdi>{contract.unit === "EGP" ? formatMoney(metric.value) : formatQuantity(metric.value)}</bdi>{contract.unit !== "EGP" && <span>{contract.unit === "order" ? "طلب" : "منتج"}</span>}</p>
        {contract.period === "selected" && <Comparison metric={metric} />}
        {metric.note && <p className={styles.muted}>{metric.note}</p>}
        {href && <Link href={href} prefetch={false} className={styles.textLink} aria-label={`عرض التفاصيل: ${contract.label}`}>عرض التفاصيل <ArrowLeft size={14} aria-hidden="true" /></Link>}
      </> : <SourceState state={metric.state} note={metric.note} retryHref={retryHref} label={contract.label} />}
      <details className={styles.definition}>
        <summary>تعريف ومصدر: {contract.label}</summary>
        <p>{contract.definition}</p>
        <p>{contract.period === "current" ? "لقطة حالية لا تعتمد على الفترة المختارة؛ لا يوجد سجل تاريخي للمقارنة." : "بحسب تاريخ إنشاء الطلب وحالته الحالية، داخل الفترة المختارة."}</p>
        <p>الصلاحيات: {contract.permissions.map(permissionLabel).join("، ")}</p>
        <p>المصدر: <bdi className={styles.sourceCode}>{contract.source}</bdi></p>
      </details>
    </article>
  );
}

interface Segment { key: string; label: string; value: number; color: string; href: string }
function Donut({ title, total, segments, unit, id }: {
  title: string; total: number; segments: Segment[]; unit: string; id: string;
}) {
  let offset = 0;
  return (
    <div className={styles.donutLayout}>
      <div className={styles.donut}>
        <svg viewBox="0 0 120 120" aria-hidden="true" focusable="false" className={styles.draw} data-chart={id}>
          <title>{title}</title><desc>{`النسب الدقيقة من إجمالي ${count(total)}؛ تفاصيل كل حالة في الجدول المجاور.`}</desc>
          <circle cx="60" cy="60" r="46" fill="none" stroke="var(--adm-surface-2)" strokeWidth="13" />
          {total > 0 && segments.filter((segment) => segment.value > 0).map((segment) => {
            const share = segment.value / total * 100;
            const start = offset;
            offset += share;
            return <circle key={segment.key} data-segment={segment.key} cx="60" cy="60" r="46" pathLength="100" fill="none" stroke={segment.color} strokeWidth="13" strokeLinecap="butt" strokeDasharray={`${share} ${100 - share}`} strokeDashoffset={-start} transform="rotate(-90 60 60)"><title>{`${segment.label}: ${count(segment.value)} (${percent(share)})`}</title></circle>;
          })}
        </svg>
        <div className={styles.donutCenter}><strong><bdi>{count(total)}</bdi></strong><span>{unit}</span></div>
      </div>
      <div className={styles.legendWrap}>
        {total === 0 && <p className={styles.muted}>لا توجد بيانات في هذه المجموعة؛ الرسم فارغ ولا توجد نسب.</p>}
        <table className={styles.legend}>
          <caption className={styles.srOnly}>{title} — الأعداد والنسب وروابط التصفية</caption>
          <thead><tr><th scope="col">الحالة</th><th scope="col">العدد</th><th scope="col">النسبة</th></tr></thead>
          <tbody>{segments.map((segment, index) => <tr key={segment.key} className={styles.legendRow}>
            <th scope="row"><Link href={segment.href} prefetch={false} className={styles.legendLink} aria-label={segment.label} aria-describedby={`${id}-tip-${index}`}>
              <svg className={styles.swatch} width={8} height={8} viewBox="0 0 8 8" aria-hidden="true"><rect width="8" height="8" rx="2" fill={segment.color} /></svg>{segment.label}
              <span id={`${id}-tip-${index}`} role="tooltip" className={styles.tooltip}>افتح {count(segment.value)} {unit} بهذه الحالة{total > 0 ? `؛ ${percent(segment.value / total * 100)} من المجموعة` : "؛ لا توجد نسبة"}.</span>
            </Link></th>
            <td><bdi>{count(segment.value)}</bdi></td><td><bdi>{total > 0 ? percent(segment.value / total * 100) : "غير معرّفة"}</bdi></td>
          </tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

function Radial({ label, numerator, denominator, color, href, id }: {
  label: string; numerator: number; denominator: number; color: string; href: string; id: string;
}) {
  const share = denominator > 0 ? numerator / denominator * 100 : null;
  return (
    <div className={styles.radial} data-radial={id}>
      <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false" className={styles.draw}>
        <title>{label}</title><desc>{`${count(numerator)} من ${count(denominator)} طلب؛ ${share === null ? "النسبة غير معرّفة" : percent(share)}.`}</desc>
        <circle cx="50" cy="50" r="40" stroke="var(--adm-surface-2)" strokeWidth="8" fill="none" />
        {share !== null && share > 0 && <circle data-radial-value cx="50" cy="50" r="40" pathLength="100" stroke={color} strokeWidth="8" fill="none" strokeLinecap="butt" strokeDasharray={`${share} ${100 - share}`} transform="rotate(-90 50 50)" />}
      </svg>
      <div><Link href={href} prefetch={false} className={styles.textLink}>{label}</Link><strong><bdi>{share === null ? "غير معرّفة" : percent(share)}</bdi></strong><p className={styles.muted}><bdi>{count(numerator)}</bdi> من <bdi>{count(denominator)}</bdi> طلب في نفس الفترة</p></div>
    </div>
  );
}

function Card({ title, sub, id, children }: { title: string; sub: string; id: string; children: ReactNode }) {
  return <section className={styles.panel} aria-labelledby={id}><div className={styles.sectionHead}><div><h2 id={id}>{title}</h2><p className={styles.muted}>{sub}</p></div></div>{children}</section>;
}

function gated<T>(result: ReadResult<T>, allowed: boolean): ReadResult<T> {
  return allowed ? result : { state: "denied", data: null, note: "لا تتوفر الصلاحيات المطلوبة؛ البيانات لا تُعرض ولا يُفترض أنها صفر." };
}

export function DashboardAnalytics({ data, permissions }: { data: DashboardData; permissions: readonly string[] }) {
  const { range } = data;
  const can = (...keys: string[]) => keys.every((key) => permissions.includes(key));
  const retryHref = `/admin?${new URLSearchParams({ range: range.preset, from: range.fromDay, to: range.toDay })}`;
  const metrics = KPI_CONTRACTS.map((contract): DashboardMetric => {
    if (!can(...contract.permissions)) return { id: contract.id, state: "denied", value: null, previous: null, changePercent: null, note: `الصلاحيات المطلوبة: ${contract.permissions.map(permissionLabel).join("، ")}.` };
    const metric = data.metrics.find((entry) => entry.id === contract.id);
    if (!metric || (metric.state === "ready" && (metric.value === null || metric.value === "" || !Number.isFinite(Number(metric.value))))) return { id: contract.id, state: "unavailable", value: null, previous: null, changePercent: null, note: "لم يصل رقم مكتمل من المصدر؛ لا يُعامل كصفر." };
    return metric;
  });
  const orders = gated(data.orders, can("orders.view"));
  const inventory = gated(data.inventory, can("products.view", "inventory.view"));
  const promotions = gated(data.promotions, can("promotions.view"));
  const sales = metrics.find((metric) => metric.id === "sales-total")!;
  const newOrders = metrics.find((metric) => metric.id === "orders-new")!;
  const low = metrics.find((metric) => metric.id === "stock-low")!;
  const out = metrics.find((metric) => metric.id === "stock-out")!;
  const dailyMax = orders.state === "ready" ? orders.data.daily.reduce((max, day) => Math.max(max, day.count), 0) : 0;
  const operationalAlerts = [
    { metric: newOrders, title: "طلبات تنتظر التأكيد", hint: "من طلبات الفترة؛ نفس حالة الطلبات الجديدة." },
    { metric: low, title: "منتجات تحتاج مراجعة المخزون", hint: "منتجات منخفضة المخزون الآن." },
    { metric: out, title: "منتجات غير متوفرة", hint: "منتجات نافدة الآن بأرصدة مكتملة." },
  ];
  const openDay = calendarDayAt(new Date(data.capturedAt));
  const includesOpenDay = range.fromDay <= openDay && range.toDay >= openDay;
  const orderHref = (status: string) => {
    const params = new URLSearchParams({ dateFrom: range.fromDay, dateTo: range.toDay, status });
    return `/admin/orders?${params}`;
  };
  const stockHref = (status: string) => status === "low" || status === "out"
    ? metricHref(status === "low" ? "stock-low" : "stock-out", range)!
    : `/admin/inventory/product-status?status=${status}`;
  const hasSuccessfulRead = metrics.some((metric) => metric.state === "ready") || orders.state === "ready" || inventory.state === "ready" || promotions.state === "ready";
  return <>
    <section aria-labelledby="dashboard-kpis" className={styles.kpiSection}>
      <div className={styles.sectionHead}><div><p className={styles.eyebrow}>قراءة المتجر</p><h2 id="dashboard-kpis">المؤشرات الرئيسية</h2></div><p className={styles.muted}>{hasSuccessfulRead ? "آخر قراءة ناجحة للمصادر المتاحة" : "وقت محاولة القراءة"}: <bdi>{formatDateTime(data.capturedAt)}</bdi> — القاهرة</p></div>
      <p className={styles.muted}>حالات الطلبات الحالية لطلبات الفترة. «تنتظر التأكيد» هي نفس «الطلبات الجديدة»، وليست عددًا إضافيًا. الكتالوج والمخزون لقطة الآن، لا تعتمد على الفترة ولا يتوفر لها تاريخ سابق.</p>
      {includesOpenDay && can("orders.view") && <p className={styles.openDay}><AlertTriangle size={15} aria-hidden="true" />الفترة تشمل اليوم الذي لم ينتهِ بعد بتوقيت القاهرة. المقارنة بنفس الزمن المنقضي، وليست تكافؤًا بين أيام تقويمية مكتملة؛ الأعداد والحالات قد تتغير.</p>}
      <div className={styles.kpiGrid}>{KPI_CONTRACTS.map((contract, index) => <MetricCard key={contract.id} contract={contract} metric={metrics[index]} range={range} retryHref={retryHref} />)}</div>
    </section>

    <div className={styles.chartGrid}>
      <Card title="توزيع حالات الطلبات" sub="كل حالات المجموعة، بما فيها غير المعروفة. افتح الحالة من مفتاح الرسم لتصفية نفس الفترة." id="dashboard-order-states">
        {orders.state === "ready" ? <>
          <Donut title="توزيع حالات طلبات الفترة" id="orders" total={orders.data.total} unit="طلب" segments={orders.data.byStatus.map((row) => ({ key: row.status, label: orderStatusLabel(row.status), value: row.count, color: COLORS[row.status] || "var(--adm-ink-3)", href: orderHref(row.status) }))} />
          <div className={styles.radials}>
            <Radial id="completion" label="نسبة اكتمال الطلبات" numerator={orders.data.byStatus.find((row) => row.status === "DELIVERED")?.count ?? 0} denominator={orders.data.total} color="var(--adm-success)" href={metricHref("orders-completed", range)!} />
            <Radial id="cancellation" label="نسبة إلغاء الطلبات" numerator={orders.data.byStatus.find((row) => row.status === "CANCELLED")?.count ?? 0} denominator={orders.data.total} color="var(--adm-danger)" href={metricHref("orders-cancelled", range)!} />
          </div>
          <p className={styles.muted}>المقام هو كل الطلبات المنشأة في الفترة، وليس الطلبات المغلقة فقط. اكتمال الطلب لا يثبت تحصيل المبلغ.</p>
          <div className={styles.comparisonPanel}><h3>مقارنة عدد الطلبات</h3><p>الفترة المختارة: <bdi>{count(orders.data.total)}</bdi> طلب · السابقة بنفس الزمن المنقضي: <bdi>{count(orders.data.previousTotal)}</bdi> طلب.</p>
            <Comparison metric={{ id: "orders-total", state: "ready", value: orders.data.total, previous: orders.data.previousTotal, changePercent: orders.data.previousTotal > 0 ? (orders.data.total - orders.data.previousTotal) / orders.data.previousTotal * 100 : null, note: null }} />
          </div>
        </> : <SourceState state={orders.state} note={orders.note} retryHref={retryHref} label="توزيع الطلبات" />}
      </Card>
      <Card title="صحة المخزون الحالي" sub="تصنيف منفصل للمنتجات المعروضة، لا لأشكال البيع. لا يتغير باختيار الفترة ولا توجد مقارنة تاريخية." id="dashboard-inventory">
        {inventory.state === "ready" ? <>
          <Donut title="توزيع المنتجات المعروضة حسب المخزون الحالي" id="inventory" total={inventory.data.total} unit="منتج" segments={[
            { key: "available", label: "متوفر", value: inventory.data.available, color: "var(--adm-success)", href: stockHref("available") },
            { key: "low", label: "منخفض المخزون", value: inventory.data.low, color: "var(--adm-warn)", href: stockHref("low") },
            { key: "out", label: "غير متوفر", value: inventory.data.out, color: "var(--adm-danger)", href: stockHref("out") },
            { key: "unknown", label: "مخزون غير معروف", value: inventory.data.unknown, color: "var(--adm-ink-3)", href: stockHref("unknown") },
          ]} />
          <p className={styles.inventoryNote}>الرصيد المفقود ليس صفرًا ولا يثبت النفاد. رصيد موجب معروف يثبت التوفر، أما انخفاض المخزون فيتطلب أرصدة مكتملة وحدود تنبيه لكل شكل موجب؛ إن تعذر إثبات التوفر أو النفاد فالحالة «مخزون غير معروف».</p>
        </> : <SourceState state={inventory.state} note={inventory.note} retryHref={retryHref} label="صحة المخزون" />}
      </Card>
    </div>

    <Card title="المبيعات والتحصيل" sub="عدد الطلبات ليس مبيعات؛ لا توجد سلسلة تحصيل يمكن رسمها من المصدر الحالي." id="dashboard-sales">
      {sales.state === "denied" || sales.state === "error" ? <SourceState state={sales.state} note={sales.note} retryHref={retryHref} label="المبيعات والتحصيل" /> : <div className={styles.ledgerNotice}><AlertTriangle size={20} aria-hidden="true" /><div><h3>غير متاح: لا يوجد سجل تحصيل واستردادات</h3><p>لا يمكن عرض مبيعات محصّلة أو اتجاه مبيعات أو صافي بعد الاستردادات. متوسط قيمة الطلب المكتمل، إن توفر، هو متوسط الإجمالي النهائي وليس المبلغ المحصّل.</p>{sales.note && <p>{sales.note}</p>}</div></div>}
      <div className={styles.dailyPanel}><h3>عدد الطلبات اليومية — ليس مبيعات</h3><p className={styles.muted}>عدد الطلبات المنشأة في كل يوم بتوقيت القاهرة، ضمن الفترة المختارة. الرسم لا يمثل مبالغ أو مدفوعات.</p>
        {orders.state === "ready" ? orders.data.daily.length ? <>
          <svg viewBox="0 0 720 180" preserveAspectRatio="none" aria-hidden="true" focusable="false" className={`${styles.dailyChart} ${styles.draw}`} data-chart="daily-orders">
            <title>عدد الطلبات اليومية، وليس المبيعات</title><desc>القيم اليومية الدقيقة في جدول البيانات القابل للفتح أسفل الرسم؛ ارتفاع الأعمدة يبدأ من صفر.</desc>
            <line x1="0" y1="164" x2="720" y2="164" stroke="var(--adm-line)" />
            {orders.data.daily.map((row, index, rows) => {
              const slot = 720 / rows.length;
              const height = dailyMax > 0 ? row.count / dailyMax * 150 : 0;
              return <rect key={row.day} data-day={row.day} x={index * slot + slot * 0.15} y={164 - height} width={slot * 0.7} height={height} fill="var(--adm-accent)"><title>{`${formatDate(row.day)}: ${count(row.count)} طلب`}</title></rect>;
            })}
          </svg>
          <div className={styles.axisLabels}><bdi>{formatDate(orders.data.daily[0].day)}</bdi><span>مقياس الارتفاع: <bdi>0–{count(dailyMax)}</bdi> طلب</span><bdi>{formatDate(orders.data.daily[orders.data.daily.length - 1].day)}</bdi></div>
          {orders.data.total === 0 && <p className={styles.muted}>لا توجد طلبات في الفترة؛ جميع الأعمدة صفر.</p>}
          <details className={styles.dailyDetails}><summary>عرض بيانات الطلبات اليومية</summary><table className={styles.dataTable}><caption>عدد الطلبات حسب يوم الإنشاء — بتوقيت القاهرة</caption><thead><tr><th scope="col">اليوم</th><th scope="col">عدد الطلبات</th></tr></thead><tbody>{orders.data.daily.map((row) => <tr key={row.day}><th scope="row"><bdi>{formatDate(row.day)}</bdi></th><td><bdi>{count(row.count)}</bdi></td></tr>)}</tbody></table></details>
        </> : <p className={styles.muted}>لا توجد نقاط يومية متاحة في المصدر؛ لا يُرسم اتجاه تقديري.</p> : <SourceState state={orders.state} note={orders.note} retryHref={retryHref} label="الطلبات اليومية" />}
      </div>
    </Card>

    <div className={styles.chartGrid}>
      <Card title="تنبيهات التشغيل" sub="طلبات جديدة من الفترة، مخزون حالي، وعروض نشطة تقترب من نهايتها. ليست فحصًا شاملًا لكل المتجر." id="dashboard-alerts">
        <ul className={styles.alertList}>
          {operationalAlerts.map(({ metric, title, hint }) => {
            const value = Number(metric.value);
            return <li key={metric.id} className={styles.alertItem} data-attention={metric.state === "ready" && value > 0 ? "needed" : "unknown-or-empty"}><h3>{title}</h3>{metric.state === "ready" ? <><p><strong><bdi>{formatQuantity(metric.value)}</bdi></strong> · {hint}</p><Link href={metricHref(metric.id, range)!} prefetch={false} className={styles.textLink}>{value > 0 ? "متابعة الحالات" : "عرض المجموعة"}</Link>{value === 0 && <p className={styles.muted}>لا توجد حالات مطابقة لهذا التنبيه فقط.</p>}</> : <SourceState state={metric.state} note={metric.note} retryHref={retryHref} label={title} />}</li>;
          })}
          <li className={styles.alertItem}><h3>عروض نشطة تنتهي خلال 7 أيام</h3>
            {promotions.state === "ready" ? promotions.data.length ? <ul className={styles.promotionList}>{promotions.data.map((promotion) => <li key={promotion.id}><Link href={`/admin/promotions/${promotion.id}`} prefetch={false} className={styles.textLink}>{promotion.name}</Link><span>النهاية: <bdi>{formatDateTime(promotion.endAt)}</bdi> — القاهرة</span></li>)}</ul> : <p className={styles.muted}>لا توجد عروض نشطة مطابقة لنافذة الانتهاء هذه في وقت القراءة.</p> : <SourceState state={promotions.state} note={promotions.note} retryHref={retryHref} label="العروض القريبة من الانتهاء" />}
          </li>
        </ul>
      </Card>
      <Card title="آخر الطلبات في الفترة" sub="أحدث الطلبات المنشأة داخل نفس النطاق؛ لا تُعرض طلبات خارجه ولا مبالغ تقديرية." id="dashboard-recent">
        {orders.state === "ready" ? <>
          <Link href={metricHref("orders-total", range)!} prefetch={false} className={styles.textLink}>كل طلبات الفترة <ArrowLeft size={14} aria-hidden="true" /></Link>
          {orders.data.recent.length ? <ul className={styles.recentList}>{orders.data.recent.map((order) => <li key={order.id}>
            <div><Link href={`/admin/orders/${order.id}`} prefetch={false} className={styles.textLink}><bdi>{order.orderNumber}</bdi></Link><time dateTime={order.createdAt}><bdi>{formatDateTime(order.createdAt)}</bdi></time></div><span className={styles.statusPill}>{orderStatusLabel(order.status)}</span>
          </li>)}</ul> : <p className={styles.empty}>لا توجد طلبات منشأة في هذه الفترة.</p>}
        </> : <SourceState state={orders.state} note={orders.note} retryHref={retryHref} label="آخر الطلبات" />}
      </Card>
    </div>
    <p className={styles.footnote}>الأرقام تُقرأ من المصدر وقت فتح الصفحة؛ حالات الخطأ وعدم السماح وعدم توفر المصدر لا تعني صفرًا. افتح تعريف المؤشر لمعرفة حدود الحساب، وأعد تحميل الصفحة لقراءة محدثة.</p>
  </>;
}
