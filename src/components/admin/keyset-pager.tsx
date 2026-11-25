// Keyset pagination (server).
//
// The cursor is the LAST row's key, so the next page starts exactly where
// this one ended — no row is skipped and none is shown twice. The previous
// pages are reachable through the browser, which is why this shows only a
// "next" affordance.

import Link from "next/link";

export function KeysetPager({
  basePath,
  params,
  nextCursor,
  label = "النتايج",
}: {
  basePath: string;
  params: Record<string, string | undefined>;
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
