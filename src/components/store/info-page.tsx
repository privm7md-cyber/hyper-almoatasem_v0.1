// FE-9 shared frame for the storefront's informational pages (server component).
// No invented content: the copy of every page comes from a verified source
// (the catalogue contract, store settings, or the owner's approved specs) and
// is documented in the Phase 09 content-provenance record.

import Link from "next/link";
import { PageTitle } from "@/components/ui/container";

export function InfoPage({
  title,
  lede,
  children,
  backHref = "/",
  backLabel = "العودة إلى المتجر",
}: {
  title: string;
  lede?: string;
  children: React.ReactNode;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <div className="mt-6">
      <nav aria-label="مسار التنقل" className="text-sm text-secondary">
        <Link href={backHref} className="font-semibold text-brand hover:text-[color:var(--ink-purple-deep)]">
          {backLabel}
        </Link>
      </nav>
      <header className="mt-3">
        <PageTitle>{title}</PageTitle>
        {lede ? <p className="mt-2 max-w-[70ch] text-secondary">{lede}</p> : null}
      </header>
      <div className="mt-6 grid gap-4">{children}</div>
    </div>
  );
}

export function InfoSection({
  title,
  children,
  note,
}: {
  title: string;
  children: React.ReactNode;
  note?: string;
}) {
  return (
    <section className="rounded-card border border-line bg-white p-4">
      <h2 className="text-lg font-bold leading-[1.35]">{title}</h2>
      <div className="mt-2 grid gap-2 text-sm leading-relaxed text-secondary">{children}</div>
      {note ? <p className="mt-2 text-xs text-secondary">{note}</p> : null}
    </section>
  );
}

export function InfoList({ items }: { items: string[] }) {
  return (
    <ul className="grid gap-1">
      {items.map((item) => (
        <li key={item} className="flex gap-2">
          <span aria-hidden="true" className="text-[color:var(--brand-orange)]">
            •
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function InfoNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-control border border-line bg-purple-surface px-3 py-2 text-xs text-secondary">
      {children}
    </p>
  );
}
