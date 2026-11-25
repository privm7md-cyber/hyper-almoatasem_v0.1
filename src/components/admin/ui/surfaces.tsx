// ADMIN SURFACES — the shared, server-safe building blocks of the admin panel.
//
// Every screen is assembled from these, so the whole panel shares one visual
// and one voice: a graphite instrument rail, a warm bone work surface, and a
// single jade signal colour. Nothing here is a card-in-a-card soup — a page
// is a set of flat panels on one surface, with hairlines doing the work.
//
// All components are server components (no client JS) unless the file says
// otherwise, so the panel stays light: the only hydrated code in the admin
// is the forms, the navigation drawer and the dashboard motion.

import React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Lock,
  PackageSearch,
  type LucideIcon,
} from "lucide-react";

/* ------------------------------------------------------------- page head */

export function PageHead({
  eyebrow,
  title,
  intro,
  actions,
}: {
  eyebrow?: string;
  title: string;
  /** What the operator can do here, in one or two plain sentences. */
  intro?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="adm-page-head">
      <div className="adm-page-head-row">
        <div className="adm-head-copy">
          {eyebrow ? <p className="adm-eyebrow">{eyebrow}</p> : null}
          <h1 className="adm-page-title">{title}</h1>
        </div>
        {actions ? <div className="adm-page-actions">{actions}</div> : null}
      </div>
      {intro ? <p className="adm-page-intro">{intro}</p> : null}
    </header>
  );
}

/* ----------------------------------------------------------------- panel */

export function Panel({
  title,
  sub,
  actions,
  footer,
  flush = false,
  children,
}: {
  title?: React.ReactNode;
  sub?: React.ReactNode;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  /** Removes body padding — for tables and lists that own their own edges. */
  flush?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="adm-panel">
      {title || actions ? (
        <div className="adm-panel-head">
          <div className="adm-panel-head-text">
            {title ? <h2 className="adm-panel-title">{title}</h2> : null}
            {sub ? <p className="adm-panel-sub">{sub}</p> : null}
          </div>
          {actions ? <div className="adm-btn-row">{actions}</div> : null}
        </div>
      ) : null}
      <div className={flush ? "adm-panel-body adm-panel-body--flush" : "adm-panel-body"}>{children}</div>
      {footer ? <div className="adm-panel-foot">{footer}</div> : null}
    </section>
  );
}

/* ------------------------------------------------------------------ note */

export type NoteTone = "neutral" | "accent" | "info" | "warn" | "danger";

export function Note({
  tone = "neutral",
  icon,
  children,
}: {
  tone?: NoteTone;
  icon?: LucideIcon;
  children: React.ReactNode;
}) {
  const Icon = icon ?? (tone === "warn" || tone === "danger" ? AlertTriangle : Info);
  return (
    <div className={`adm-note${tone === "neutral" ? "" : ` adm-note--${tone}`}`}>
      <Icon size={16} className="adm-note-icon" aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ pill */

export type PillTone = "neutral" | "accent" | "info" | "warn" | "danger" | "success" | "outline";

export function Pill({ tone = "neutral", children }: { tone?: PillTone; children: React.ReactNode }) {
  const cls = tone === "neutral" ? "adm-pill" : `adm-pill adm-pill--${tone}`;
  return <span className={cls}>{children}</span>;
}

/** A status pill with a leading dot — the shared way a status is shown. */
export function StatusPill({ tone = "neutral", children }: { tone?: PillTone; children: React.ReactNode }) {
  const cls = tone === "neutral" ? "adm-pill" : `adm-pill adm-pill--${tone}`;
  return (
    <span className={cls}>
      <span className="adm-dot" aria-hidden="true" />
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ stat */

export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="adm-stat">
      <span className="adm-stat-label">{label}</span>
      <span className="adm-stat-value">{value}</span>
      {hint ? <span className="adm-stat-hint">{hint}</span> : null}
    </div>
  );
}

/* ---------------------------------------------------------------- states */

export function EmptyState({
  title,
  hint,
  action,
  icon: Icon = PackageSearch,
}: {
  title: string;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="adm-empty">
      <Icon size={26} aria-hidden="true" className="adm-empty-icon" />
      <p className="adm-empty-title">{title}</p>
      {hint ? <p className="adm-empty-hint">{hint}</p> : null}
      {action ? <div className="adm-btn-row">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ title = "تعذّر تحميل البيانات", hint }: { title?: string; hint?: React.ReactNode }) {
  return (
    <div className="adm-empty adm-empty--danger" role="alert">
      <AlertTriangle size={26} aria-hidden="true" className="adm-empty-icon--danger" />
      <p className="adm-empty-title">{title}</p>
      {hint ? <p className="adm-empty-hint">{hint}</p> : null}
    </div>
  );
}

/**
 * Shown when the account does not hold the permission a section needs.
 * The message names the capability in words, never a technical key.
 */
export function ForbiddenState({ capability }: { capability: string }) {
  return (
    <div className="adm-empty" role="note">
      <Lock size={26} aria-hidden="true" className="adm-empty-icon" />
      <p className="adm-empty-title">لا تملك صلاحية الوصول إلى هذه الصفحة</p>
      <p className="adm-empty-hint">
        تتطلب هذه العملية صلاحية: {capability}. إذا كنت بحاجة إليها في مهامك، تواصل مع مالك المتجر لإضافتها لحسابك.
      </p>
    </div>
  );
}

/* ----------------------------------------------------------------- table */

export interface AdminColumn {
  header: string;
  /** Right-aligned, tabular figures — for money, quantities and dates. */
  numeric?: boolean;
}

/**
 * The shared table. One horizontal scroll region, sticky header, a real
 * caption for screen readers, and rows that reveal in sequence.
 */
export function DataTable({
  columns,
  rows,
  caption,
  emptyLabel = "مفيش بيانات لعرضها.",
}: {
  columns: AdminColumn[];
  rows: React.ReactNode[][];
  caption: string;
  emptyLabel?: string;
}) {
  if (rows.length === 0) {
    return <EmptyState title={emptyLabel} />;
  }
  return (
    <div className="adm-table-scroll" tabIndex={0} role="region" aria-label={caption}>
      <table className="adm-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th key={index} scope="col" className={column.numeric ? "adm-cell-num" : undefined}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, rowIndex) => (
            <tr key={rowIndex}>
              {cells.map((cell, cellIndex) => (
                <td key={cellIndex} className={columns[cellIndex]?.numeric ? "adm-cell-num" : undefined}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A labelled value list — the honest way to show a record's fields. */
export function KeyValue({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="adm-kv">
      {items.map((item, index) => (
        <React.Fragment key={index}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/* ------------------------------------------------------------------ cards */

export function CardGrid({ children }: { children: React.ReactNode }) {
  return <div className="adm-cards">{children}</div>;
}

export function ActionLink({
  href,
  title,
  text,
  icon: Icon,
}: {
  href: string;
  title: string;
  text: string;
  icon: LucideIcon;
}) {
  return (
    <Link href={href} className="adm-card">
      <span className="adm-card-title">
        <Icon size={18} aria-hidden="true" className="adm-link-icon" />
        {title}
      </span>
      <p className="adm-card-text">{text}</p>
      <span className="adm-card-go">
        افتح <span aria-hidden="true">←</span>
      </span>
    </Link>
  );
}

/* ------------------------------------------------------------------- pager */

export interface PagerParams {
  [key: string]: string | undefined;
}

/**
 * Keyset pagination. The cursor is the last row's key, so the next page
 * starts exactly where this one ended — no row is skipped or repeated.
 */
export function Pager({
  basePath,
  params,
  nextCursor,
  label = "النتايج",
}: {
  basePath: string;
  params: PagerParams;
  nextCursor: string | null;
  label?: string;
}) {
  const build = (cursor: string | null) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) search.set(key, value);
    }
    if (cursor) search.set("cursor", cursor);
    const query = search.toString();
    return query ? `${basePath}?${query}` : basePath;
  };
  return (
    <div className="adm-pager">
      <span>بتعرض أول 20 {label} على الأكثر في الصفحة.</span>
      {nextCursor ? (
        <Link href={build(nextCursor)} className="adm-btn adm-btn--secondary adm-btn--sm">
          الصفحة اللي بعد كده <span aria-hidden="true">←</span>
        </Link>
      ) : (
        <span className="adm-chip">وصلت لآخر {label} المطابقة.</span>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- checklist */

/** A short list of what a section lets the operator do. */
export function CapabilityList({ items }: { items: { title: string; text: string }[] }) {
  return (
    <div className="adm-actions">
      {items.map((item) => (
        <div key={item.title} className="adm-action">
          <span className="adm-action-title">{item.title}</span>
          <span className="adm-action-text">{item.text}</span>
        </div>
      ))}
    </div>
  );
}

export { CheckCircle2 };
