// ADMIN HELP — the two inline explanation blocks every screen uses.
//
// Contract: an operator must never have to guess what a section does or what
// a button will do. The explanation is ALWAYS visible (never tooltip-only),
// it is short, and it is in plain Egyptian Arabic.

import React from "react";
import { Info } from "lucide-react";

/** Short description directly under the page title. */
export function PageIntro({ children }: { children: React.ReactNode }) {
  return <p className="adm-page-intro">{children}</p>;
}

/**
 * A visible note attached to a feature or an action.
 *
 * `tone` carries the meaning: "accent" for the happy path, "info" for
 * background, "warn" for a condition the operator should read, "danger" for
 * something irreversible.
 */
export function HelpNote({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "accent" | "info" | "warn" | "danger";
}) {
  const cls = tone === "neutral" ? "adm-note" : `adm-note adm-note--${tone}`;
  return (
    <p className={`${cls} adm-help-row`}>
      <Info size={16} className="adm-note-icon" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}
