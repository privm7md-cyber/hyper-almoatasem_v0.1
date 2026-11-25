// ADMIN PRESENTATIONAL PRIMITIVES (server): table + section shell.
//
// These two stay as the shared building blocks every admin page composes, but
// they now render inside the admin design system (warm bone surface, hairline
// borders, sticky table header, a real caption for screen readers).
//
// Mutations live in the client islands. Nothing here fetches data.

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
    <div className="adm-table-scroll">
      <table className="adm-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header} scope="col">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, rowIndex) => (
            <tr key={rowIndex}>
              {cells.map((cell, cellIndex) => (
                <td key={cellIndex}>{cell}</td>
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
  sub,
  children,
}: {
  title: string;
  /** One line explaining what the operator can do inside this section. */
  sub?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="adm-panel" aria-label={title}>
      <div className="adm-panel-head">
        <div className="adm-panel-title">
          {title}
          {sub ? <span className="adm-panel-sub">{sub}</span> : null}
        </div>
      </div>
      <div className="adm-panel-body">{children}</div>
    </section>
  );
}
