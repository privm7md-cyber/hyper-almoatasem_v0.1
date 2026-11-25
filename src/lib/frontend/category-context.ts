// Phase 06 P06-T02: category page context (parent + children selection).
//
// Pure, server-safe selection over the ACTIVE category list (is_active AND
// deleted_at IS NULL — the same bounded ≤100 list getAllCategories returns).
// Names come only from source rows; nothing is invented, and an inactive or
// missing parent degrades gracefully to "no parent link" instead of a broken
// link to a category the storefront cannot render (active-only /c contract).
import type { CategoryShape } from "@/lib/catalog/serialize";

/**
 * The active parent of a category, or null.
 * null means: category is a main (no parent in data) OR the parent row is not
 * active (the /c route 404s for inactive ids — linking to it would break).
 */
export function selectCategoryParent(
  category: Pick<CategoryShape, "id" | "parentId">,
  allActive: CategoryShape[],
): CategoryShape | null {
  if (category.parentId === null) return null;
  return allActive.find((c) => c.id === category.parentId) ?? null;
}

/**
 * Active children of a category, in the source name order
 * (getAllCategories fetches name-asc; filter preserves it).
 */
export function selectCategoryChildren(
  category: Pick<CategoryShape, "id">,
  allActive: CategoryShape[],
): CategoryShape[] {
  return allActive.filter((c) => c.parentId === category.id);
}

/**
 * CTR-1 (navigation display order): sort a bounded category list by the
 * catalog's `sortOrder` (approved sheet order), with deterministic name/id
 * tie-breaks. Pure: returns a new array, never mutates the input. Rows missing
 * sortOrder are NOT possible on CategoryShape (required field) — the generic
 * input keeps the helper testable and honors any same-shape source list.
 */
export function orderCategoriesBySortOrder<T extends Pick<CategoryShape, "sortOrder" | "name" | "id">>(
  rows: readonly T[],
): T[] {
  return [...rows].sort(
    (a, b) =>
      a.sortOrder - b.sortOrder ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

export interface EmptyCategoryCopy {
  title: string;
  hint: string;
}

/**
 * Honest empty-state copy for a category listing whose product read SUCCEEDED
 * with zero rows. Two real states, never merged:
 * - no filters at all → the category itself currently has no sellable products;
 * - filters applied → the filters may be the cause; invite clearing them.
 * Copy only — never a data claim (no counts, no stock promises).
 */
export function emptyCategoryCopy(hasActiveFilters: boolean): EmptyCategoryCopy {
  return hasActiveFilters
    ? { title: "لا توجد منتجات مطابقة", hint: "جرّب تعديل الفلاتر أو مسحها." }
    : { title: "القسم ده مفيهوش منتجات متاحة دلوقتي.", hint: "عُد لاحقًا لتصفح منتجات هذا القسم." };
}
