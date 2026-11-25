// Phase 06 P06-T02: category page context selection (parent + children).
// Contract proven from source: name/order come from the SAME bounded active list
// getAllCategories() returns; a non-active parent degrades to no link; children
// are active rows whose parentId equals the category — never invented.
import { describe, expect, it } from "vitest";
import { emptyCategoryCopy, orderCategoriesBySortOrder, selectCategoryChildren, selectCategoryParent } from "../category-context";
import type { CategoryShape } from "@/lib/catalog/serialize";

function cat(id: string, overrides: Partial<CategoryShape> = {}): CategoryShape {
  return {
    id,
    name: `قسم ${id}`,
    slug: `slug-${id}`,
    description: null,
    image: null,
    parentId: null,
    isActive: true,
    sortOrder: 0,
    createdAt: "2026-10-25T00:00:00.000Z",
    updatedAt: "2026-10-25T00:00:00.000Z",
    ...overrides,
  };
}

const MAIN = "m1";
const SUB_A = "s1";
const SUB_B = "s2";
const OTHER_MAIN = "m2";

const ALL_ACTIVE: CategoryShape[] = [
  cat(MAIN),
  cat(SUB_A, { parentId: MAIN }),
  cat(SUB_B, { parentId: MAIN }),
  cat(OTHER_MAIN),
] // name-asc order as getAllCategories produces;
  .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

describe("selectCategoryParent", () => {
  it("returns the active parent for a child category", () => {
    expect(selectCategoryParent(cat(SUB_A, { parentId: MAIN }), ALL_ACTIVE)?.id).toBe(MAIN);
  });

  it("returns null for a main category (no parent in data)", () => {
    expect(selectCategoryParent(cat(MAIN), ALL_ACTIVE)).toBeNull();
  });

  it("degrades to null when the parent is not in the active list (hidden parent)", () => {
    const hiddenList = ALL_ACTIVE.filter((c) => c.id !== MAIN);
    expect(selectCategoryParent(cat(SUB_A, { parentId: MAIN }), hiddenList)).toBeNull();
  });
});

describe("selectCategoryChildren", () => {
  it("returns active children in list order (source name order)", () => {
    const children = selectCategoryChildren(cat(MAIN), ALL_ACTIVE);
    expect(children.map((c) => c.id)).toEqual([SUB_A, SUB_B].sort());
  });

  it("returns an empty list for a childless category (no invented rows)", () => {
    expect(selectCategoryChildren(cat(OTHER_MAIN), ALL_ACTIVE)).toEqual([]);
  });

  it("never includes grandchildren as direct children (two-level tree stays bounded)", () => {
    const grandChild = cat("g1", { parentId: SUB_A });
    const withGrandchild = [...ALL_ACTIVE, grandChild];
    expect(selectCategoryChildren(cat(MAIN), withGrandchild).map((c) => c.id)).toEqual(
      [SUB_A, SUB_B].sort()
    );
  });
});

describe("orderCategoriesBySortOrder (CTR-1 display order)", () => {
  const A = cat("a", { name: "أقسام أ", sortOrder: 3 });
  const B = cat("b", { name: "أقسام ب", sortOrder: 1 });
  const C = cat("c", { name: "أقسام ج", sortOrder: 2 });
  const D = cat("d", { name: "أقسام د", sortOrder: 2 });

  it("sorts by sortOrder regardless of input order (approved sheet order wins)", () => {
    expect(orderCategoriesBySortOrder([A, B, C]).map((c) => c.id)).toEqual(["b", "c", "a"]);
  });

  it("tie-breaks equal sortOrder by name, then id (deterministic)", () => {
    expect(orderCategoriesBySortOrder([D, C, A]).map((c) => c.id)).toEqual(["c", "d", "a"]);
  });

  it("returns a new array — never mutates the source list", () => {
    const source = [A, B, C];
    const ordered = orderCategoriesBySortOrder(source);
    expect(source.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(ordered).not.toBe(source);
  });

  it("orders mains before/after subs purely by sortOrder (no parent/child logic)", () => {
    const parent = cat("m", { name: "أب", sortOrder: 1 });
    const child = cat("s", { name: "ابن", parentId: parent.id, sortOrder: 5 });
    const anotherMain = cat("m2", { name: "أب 2", sortOrder: 4 });
    expect(orderCategoriesBySortOrder([child, anotherMain, parent]).map((c) => c.id)).toEqual([
      "m",
      "m2",
      "s",
    ]);
  });
});

describe("emptyCategoryCopy (empty vs filtered-empty wording)", () => {
  it("no filters → the category itself has no products right now", () => {
    expect(emptyCategoryCopy(false)).toEqual({
      title: "القسم ده مفيهوش منتجات متاحة دلوقتي.",
      hint: "عُد لاحقًا لتصفح منتجات هذا القسم.",
    });
  });

  it("filters applied → filters may be the cause; invite clearing them", () => {
    const copy = emptyCategoryCopy(true);
    expect(copy.title).toBe("لا توجد منتجات مطابقة");
    expect(copy.hint).toBe("جرّب تعديل الفلاتر أو مسحها.");
    expect(copy.title).not.toBe(emptyCategoryCopy(false).title);
  });
});
