// VXP homepage category discovery (server): real data via getHomeCategorySections.
// Icon-led main tiles (decorative aria-hidden mapping with safe fallback), grouped
// subcategory chips. Honest: no counts/claims beyond the live DTO, no invented images.

import Link from "next/link";
import {
  LayoutGrid,
  Baby,
  Wheat,
  Carrot,
  Cookie,
  Fish,
  Sparkles,
  SprayCan,
  Milk,
  Package,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createElement } from "react";
import { wireSlugOf } from "@/lib/frontend/slug";
import { getHomeCategorySections, type HomeCategorySections } from "@/lib/frontend/storefront-reads";
import type { CategoryShape } from "@/lib/catalog/serialize";

/* Decorative icon identity per main category: matched on live names, safe fallback
   otherwise. Icons are presentation only — never data, never a business claim. */
const CATEGORY_ICONS: Array<{ match: string[]; Icon: LucideIcon }> = [
  { match: ["أطفال"], Icon: Baby },
  { match: ["عطارة", "بقالة"], Icon: Wheat },
  { match: ["خضار", "فاكه", "فواك"], Icon: Carrot },
  { match: ["سناكس", "حلويات"], Icon: Cookie },
  { match: ["دواجن", "أسماك", "لحوم"], Icon: Fish },
  { match: ["عناية"], Icon: Sparkles },
  { match: ["منظف", "منزلي"], Icon: SprayCan },
  { match: ["ألبان", "أجبان"], Icon: Milk },
  { match: ["مضحر", "متجمد", "مجمد"], Icon: Package },
];

export function iconFor(categoryName: string): LucideIcon {
  for (const { match, Icon } of CATEGORY_ICONS) {
    if (match.some((m) => categoryName.includes(m))) return Icon;
  }
  return LayoutGrid;
}

function MainTile({ category, index }: { category: CategoryShape; index: number }) {
  const accent =
    index % 2 === 0 ? "bg-purple-surface text-brand" : "bg-orange-surface text-[color:var(--text-orange)]";
  return (
    <li className="vxp-card min-w-0 rounded-card border border-line bg-white">
      <Link
        href={`/c/${category.id}/${wireSlugOf(category.slug)}`}
        prefetch={false}
        className="flex h-full min-w-0 items-center gap-2.5 p-3 sm:gap-3 sm:p-4"
        aria-label={category.name}
      >
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-control sm:h-11 sm:w-11 ${accent}`}
          aria-hidden="true"
        >
          {createElement(iconFor(category.name), { size: 22, strokeWidth: 1.8 })}
        </span>
        <span className="min-w-0 flex-1 line-clamp-2 break-words [overflow-wrap:anywhere] text-sm font-bold leading-snug text-ink sm:text-base">
          {category.name}
        </span>
      </Link>
    </li>
  );
}

function SubChip({ sub }: { sub: CategoryShape }) {
  return (
    <li>
      <Link
        href={`/c/${sub.id}/${wireSlugOf(sub.slug)}`}
        prefetch={false}
        className="vxp-card inline-flex min-h-[44px] items-center rounded-badge border border-line bg-white px-3 py-1 text-[13px] font-semibold text-secondary hover:border-brand/40 hover:bg-purple-surface hover:text-brand"
        aria-label={sub.name}
      >
        {sub.name}
      </Link>
    </li>
  );
}

type SubGroup = Omit<HomeCategorySections["subs"][number], "children"> & {
  /** Named `subs` — React reserves the `children` prop (react/no-children-prop). */
  subs: CategoryShape[];
};

function SubGroupCard({ parent, subs }: SubGroup) {
  return (
    <div key={parent.id} className="rounded-card border border-line bg-white p-4">
      <dt className="flex items-center gap-2">
        <span
          className="flex h-7 w-7 items-center justify-center rounded-control bg-purple-surface text-brand"
          aria-hidden="true"
        >
          {createElement(iconFor(parent.name), { size: 15, strokeWidth: 2 })}
        </span>
        <Link
          href={`/c/${parent.id}/${wireSlugOf(parent.slug)}`}
          prefetch={false}
          className="inline-flex min-h-[44px] items-center text-[15px] font-bold text-ink transition-colors duration-200 hover:text-brand"
        >
          {parent.name}
        </Link>
      </dt>
      <dd className="mt-2.5">
        <ul className="flex flex-wrap gap-1.5">
          {subs.map((sub) => (
            <SubChip key={sub.id} sub={sub} />
          ))}
        </ul>
      </dd>
    </div>
  );
}

/** Homepage categories body (server): throws through to the section's own boundary. */
export async function CategoriesContent() {
  const sections: HomeCategorySections = await getHomeCategorySections();

  if (sections.mains.length === 0) {
    return null;
  }

  return (
    <>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {sections.mains.map((c, i) => (
          <MainTile key={c.id} category={c} index={i} />
        ))}
      </ul>

      {sections.subs.length > 0 ? (
        <div className="mt-8">
          <dl className="grid gap-x-8 gap-y-4 md:grid-cols-2">
            {sections.subs.map(({ parent, children }) => (
              <SubGroupCard key={parent.id} parent={parent} subs={children} />
            ))}
          </dl>
        </div>
      ) : null}
    </>
  );
}
