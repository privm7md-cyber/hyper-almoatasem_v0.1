// FE-10 shared admin presentational primitives (server): table + section head.
// Mutations live in admin-mutate.tsx (client islands). No data fetching here.

import React from "react";

export function AdminTable({
  headers,
  rows,
  caption,
}: {
  headers: string[];
  rows: React.ReactNode[][];
  caption: string;
}) {
  return (
    <div className="overflow-x-auto rounded-card border border-line bg-white">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line bg-purple-surface">
            {headers.map((h) => (
              <th key={h} scope="col" className="whitespace-nowrap px-3 py-2 text-start font-bold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <tr key={i} className="border-b border-line last:border-0">
              {cells.map((c, j) => (
                // eslint-disable-next-line react/no-array-index-key
                <td key={j} className="whitespace-nowrap px-3 py-2">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AdminSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="grid gap-3">
      <h2 className="text-lg font-bold">{title}</h2>
      {children}
    </section>
  );
}
