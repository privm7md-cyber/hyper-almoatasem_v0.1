// FE-1 shared Card primitive (server component: no handlers, semantic by default).

import React from "react";

export function Card({
  as: Tag = "section",
  children,
  className = "",
}: {
  as?: "section" | "article" | "div";
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Tag className={["rounded-card border border-line bg-white p-4 shadow-subtle md:p-5", className].filter(Boolean).join(" ")}>
      {children}
    </Tag>
  );
}
