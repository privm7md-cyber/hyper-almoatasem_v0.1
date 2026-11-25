// The owner-approved store contact number, rendered as a dialable link.
//
// Every published surface that SHOWS the number (the contact page, the
// cancellation and replacement policies, order help, the FAQ and the footer)
// renders it through this component, so the displayed number and its `tel:`
// target can never drift between surfaces. The number itself lives in
// src/lib/store/contact.ts — the single owner-approved source.

import { STORE_CONTACT_PHONE, STORE_CONTACT_TEL } from "@/lib/store/contact";

export function StoreContactLink({
  className = "font-semibold text-brand hover:text-[color:var(--ink-purple-deep)]",
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <a href={`tel:${STORE_CONTACT_TEL}`} className={className} dir="ltr">
      <bdi>{children ?? STORE_CONTACT_PHONE}</bdi>
    </a>
  );
}
