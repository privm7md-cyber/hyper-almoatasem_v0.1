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
    <Tag className={["rounded-card bg-white p-4 shadow-subtle", className].join(" ")}>
      {children}
    </Tag>
  );
}
