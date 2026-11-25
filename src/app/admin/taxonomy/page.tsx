// Admin taxonomy — the catalogue structure, in the owner's own words.
//
// Two questions live on this page and they are not the same question: the
// category says WHERE a product sits, the brand says WHO made it. Each one
// gets its own heading, its own explanation, its own search, its own
// pagination and its own forms, so the operator never mixes them up.
//
// The lists page with a keyset over a deterministic order, and the cursor is
// the id of the LAST DISPLAYED row — the extra row is only the probe that
// says "there is a next page". Reading the cursor from that extra row would
// skip one row on every page.
//
// There is no hard delete in the catalogue: a category or a brand that still
// holds products cannot be removed, so "deleting" means deactivating — the
// row leaves the storefront and stays in the catalogue with its products.

import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/rbac";
import { listBrandsForAdmin, listCategoriesForAdmin } from "@/lib/catalog/queries";
import { PermissionGate } from "@/components/admin/permission-gate";
import {
  BrandCreateForm,
  BrandDeactivateForm,
  BrandEditForm,
  CategoryCreateForm,
  CategoryDeactivateForm,
  CategoryEditForm,
} from "@/components/admin/taxonomy-forms";
import { AdminInput, AdminSelect } from "@/components/admin/ui/controls";
import { NameBadge } from "@/components/admin/name-badge";
import {
  DataTable,
  EmptyState,
  ErrorState,
  Note,
  PageHead,
  Panel,
  Pill,
} from "@/components/admin/ui/surfaces";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "التصنيفات والعلامات التجارية — الإدارة",
  robots: { index: false, follow: false },
};

const PAGE_SIZE = 20;

interface TaxonomyState {
  search: string;
  status: "" | "active" | "inactive";
  deleted: boolean;
  cursor: string | null;
}

function readState(
  sp: Record<string, string | undefined>,
  keys: { search: string; status: string; deleted: string; cursor: string },
): TaxonomyState {
  const status = sp[keys.status];
  return {
    search: (sp[keys.search] ?? "").trim().slice(0, 160),
    status: status === "active" || status === "inactive" ? status : "",
    deleted: sp[keys.deleted] === "1",
    cursor: (sp[keys.cursor] ?? "").trim() === "" ? null : (sp[keys.cursor] ?? "").trim(),
  };
}

function isActiveFilter(state: TaxonomyState): boolean | null {
  if (state.status === "active") return true;
  if (state.status === "inactive") return false;
  return null;
}

/** A list that lives next to another list needs its own cursor parameter. */
function ListPager({
  params,
  nextCursor,
  cursorKey,
  label,
}: {
  params: Record<string, string | undefined>;
  nextCursor: string | null;
  cursorKey: string;
  label: string;
}) {
  const build = (cursor: string | null) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) search.set(key, value);
    }
    if (cursor) search.set(cursorKey, cursor);
    const query = search.toString();
    return query ? `/admin/taxonomy?${query}` : "/admin/taxonomy";
  };
  return (
    <div className="adm-pager">
      <span>بتعرض أول {PAGE_SIZE} {label} على الأكثر في الصفحة.</span>
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

function SectionHead({
  eyebrow,
  title,
  intro,
}: {
  eyebrow: string;
  title: string;
  intro: string;
}) {
  return (
    <div className="adm-page-head">
      <p className="adm-eyebrow">{eyebrow}</p>
      <h2 className="adm-page-title">{title}</h2>
      <p className="adm-page-intro">{intro}</p>
    </div>
  );
}

export default async function AdminTaxonomyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const admin = await requirePermission("products.view");
  const raw = await searchParams;
  const sp: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(raw)) sp[key] = Array.isArray(value) ? value[0] : value;

  const categories = readState(sp, {
    search: "q",
    status: "status",
    deleted: "deleted",
    cursor: "ccursor",
  });
  const brands = readState(sp, {
    search: "bq",
    status: "bstatus",
    deleted: "bdeleted",
    cursor: "bcursor",
  });

  const [categoryPage, brandPage, allCategories, allBrands] = await Promise.all([
    listCategoriesForAdmin({
      limit: PAGE_SIZE,
      cursor: categories.cursor,
      search: categories.search === "" ? null : categories.search,
      isActive: isActiveFilter(categories),
      includeDeleted: categories.deleted,
    }).catch(() => null),
    listBrandsForAdmin({
      limit: PAGE_SIZE,
      cursor: brands.cursor,
      search: brands.search === "" ? null : brands.search,
      isActive: isActiveFilter(brands),
      includeDeleted: brands.deleted,
    }).catch(() => null),
    listCategoriesForAdmin({
      limit: 200,
      cursor: null,
      search: null,
      isActive: null,
      includeDeleted: false,
    }).catch(() => null),
    listBrandsForAdmin({
      limit: 200,
      cursor: null,
      search: null,
      isActive: null,
      includeDeleted: false,
    }).catch(() => null),
  ]);

  // The pickers in the edit and deactivate forms need every row, not only the
  // page on screen — a category on page three still has to be reachable.
  const categoryRows = (allCategories?.rows ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    isActive: row.isActive,
    productCount: row.productCount,
    parentId: row.parentId,
  }));
  const brandRows = (allBrands?.rows ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    isActive: row.isActive,
    productCount: row.productCount,
  }));

  const categoryParams: Record<string, string | undefined> = {
    q: categories.search || undefined,
    status: categories.status || undefined,
    deleted: categories.deleted ? "1" : undefined,
    bq: brands.search || undefined,
    bstatus: brands.status || undefined,
    bdeleted: brands.deleted ? "1" : undefined,
  };
  const brandParams: Record<string, string | undefined> = {
    bq: brands.search || undefined,
    bstatus: brands.status || undefined,
    bdeleted: brands.deleted ? "1" : undefined,
    q: categories.search || undefined,
    status: categories.status || undefined,
    deleted: categories.deleted ? "1" : undefined,
  };

  return (
    <>
      <PageHead
        eyebrow="الكتالوج"
        title="التصنيفات والعلامات التجارية"
        intro="التصنيف بيحدد القسم اللي المنتج بيتحط تحته، والعلامة التجارية بتحدد اسم الشركة اللي بتعمل المنتج. من هنا بتدوّر على القسمين، وبتضيفهم، وبتتحكم في ظهورهم في المتجر."
      />

      {/* ------------------------------------------------------ categories */}
      <SectionHead
        eyebrow="الكتالوج"
        title="التصنيفات"
        intro="التصنيف هو القسم اللي المنتج بيتحط تحته. كل منتج بيتحط في تصنيف واحد بس، والعميل بيتنقل بين التصنيفات عشان يلاقي اللي بيدوّر عليه."
      />

      <form method="get" action="/admin/taxonomy" className="adm-filters" aria-label="فلترة التصنيفات">
        <input type="hidden" name="bq" value={brands.search} />
        <input type="hidden" name="bstatus" value={brands.status} />
        <input type="hidden" name="bdeleted" value={brands.deleted ? "1" : ""} />
        <div className="adm-filters-grid">
          <div className="adm-filter-search adm-field">
            <label htmlFor="tf-q" className="adm-label">
              بحث في التصنيفات
            </label>
            <AdminInput
              inputId="tf-q"
              name="q"
              defaultValue={categories.search}
              placeholder="اسم التصنيف"
              maxLength={160}
              type="search"
            />
          </div>

          <div className="adm-field">
            <label htmlFor="tf-status" className="adm-label">
              الظهور في المتجر
            </label>
            <AdminSelect inputId="tf-status" name="status" defaultValue={categories.status}>
              <option value="">الكل</option>
              <option value="active">معروض في المتجر</option>
              <option value="inactive">مخفي من المتجر</option>
            </AdminSelect>
          </div>

          <div className="adm-field">
            <label htmlFor="tf-deleted" className="adm-label">
              التصنيفات المحذوفة
            </label>
            <AdminSelect inputId="tf-deleted" name="deleted" defaultValue={categories.deleted ? "1" : ""}>
              <option value="">مش ظاهرة</option>
              <option value="1">تظهر في الجدول</option>
            </AdminSelect>
          </div>
        </div>

        <div className="adm-btn-row">
          <button type="submit" className="adm-btn adm-btn--primary">
            طبّق الفلترة
          </button>
          <Link href="/admin/taxonomy" className="adm-btn adm-btn--ghost">
            ألغِ الفلترة
          </Link>
        </div>
      </form>

      {categoryPage === null ? (
        <Panel title="قائمة التصنيفات">
          <ErrorState
            title="تعذّر تحميل التصنيفات"
            hint="حصلت مشكلة في جلب القائمة — جرّب تعمل تحديث للصفحة."
          />
        </Panel>
      ) : categoryPage.rows.length === 0 ? (
        <Panel title="قائمة التصنيفات">
          <EmptyState
            title="لا توجد تصنيفات مطابقة"
            hint="ملقيناش نتائج بالفلترة دي — غيّر كلمة البحث أو ألغِ الفلترة وجرب تاني."
          />
        </Panel>
      ) : (
        <Panel title="قائمة التصنيفات" sub="التصنيفات مرتبة بالاسم" flush>
          <DataTable
            caption="التصنيفات"
            columns={[
              { header: "التصنيف" },
              { header: "التصنيف الأب" },
              { header: "عدد المنتجات", numeric: true },
              { header: "معروض؟" },
              { header: "الحالة" },
            ]}
            rows={categoryPage.rows.map((row) => [
              <span key={`${row.id}-name`} className="adm-cell-main">
                <span className="adm-cell-title">{row.name}</span>
                <NameBadge name={row.name} />
              </span>,
              row.parentName ?? "—",
              row.productCount,
              row.isActive ? "نعم" : "لا",
              <span key={`${row.id}-state`} className="adm-cell-main">
                <Pill tone={row.isActive ? "success" : "neutral"}>{row.isActive ? "معروض" : "مخفي"}</Pill>
                {row.deletedAt ? <Pill tone="danger">محذوف</Pill> : null}
              </span>,
            ])}
          />
          <ListPager
            params={categoryParams}
            nextCursor={categoryPage.nextCursor}
            cursorKey="ccursor"
            label="تصنيف"
          />
        </Panel>
      )}

      <Panel title="إضافة تصنيف" sub="التصنيف الجديد بيظهر للعميل في المتجر على طول">
        <PermissionGate permissions={admin.permissions} required="products.create" action="إضافة تصنيف">
          <CategoryCreateForm parents={categoryRows.map((row) => ({ id: row.id, name: row.name }))} />
        </PermissionGate>
      </Panel>

      <Panel title="تعديل تصنيف" sub="تغيير الاسم أو إظهار التصنيف في المتجر">
        <PermissionGate permissions={admin.permissions} required="products.update" action="تعديل تصنيف">
          <CategoryEditForm categories={categoryRows} />
        </PermissionGate>
      </Panel>

      <Panel
        title="تعطيل تصنيف"
        sub="التعطيل بيخفي التصنيف ومنتجاته من المتجر، وبيسيبهم في الكتالوج"
      >
        <PermissionGate permissions={admin.permissions} required="products.update" action="تعطيل تصنيف">
          <CategoryDeactivateForm categories={categoryRows} />
        </PermissionGate>
      </Panel>

      <hr className="adm-divider" />

      {/* ---------------------------------------------------------- brands */}
      <SectionHead
        eyebrow="الكتالوج"
        title="العلامات التجارية"
        intro="العلامة التجارية هي اسم الشركة. لما المنتجات تتبطنفس العلامة، العميل يلاقي كل منتجات الشركة نفسها في مكان واحد."
      />

      <form method="get" action="/admin/taxonomy" className="adm-filters" aria-label="فلترة العلامات التجارية">
        <input type="hidden" name="q" value={categories.search} />
        <input type="hidden" name="status" value={categories.status} />
        <input type="hidden" name="deleted" value={categories.deleted ? "1" : ""} />
        <div className="adm-filters-grid">
          <div className="adm-filter-search adm-field">
            <label htmlFor="tf-bq" className="adm-label">
              بحث في العلامات التجارية
            </label>
            <AdminInput
              inputId="tf-bq"
              name="bq"
              defaultValue={brands.search}
              placeholder="اسم الشركة"
              maxLength={160}
              type="search"
            />
          </div>

          <div className="adm-field">
            <label htmlFor="tf-bstatus" className="adm-label">
              الظهور في المتجر
            </label>
            <AdminSelect inputId="tf-bstatus" name="bstatus" defaultValue={brands.status}>
              <option value="">الكل</option>
              <option value="active">معروضة في المتجر</option>
              <option value="inactive">مخفية من المتجر</option>
            </AdminSelect>
          </div>

          <div className="adm-field">
            <label htmlFor="tf-bdeleted" className="adm-label">
              العلامات المحذوفة
            </label>
            <AdminSelect inputId="tf-bdeleted" name="bdeleted" defaultValue={brands.deleted ? "1" : ""}>
              <option value="">مش ظاهرة</option>
              <option value="1">تظهر في الجدول</option>
            </AdminSelect>
          </div>
        </div>

        <div className="adm-btn-row">
          <button type="submit" className="adm-btn adm-btn--primary">
            طبّق الفلترة
          </button>
          <Link href="/admin/taxonomy" className="adm-btn adm-btn--ghost">
            ألغِ الفلترة
          </Link>
        </div>
      </form>

      {brandPage === null ? (
        <Panel title="قائمة العلامات التجارية">
          <ErrorState
            title="تعذّر تحميل العلامات التجارية"
            hint="حصلت مشكلة في جلب القائمة — جرّب تعمل تحديث للصفحة."
          />
        </Panel>
      ) : brandPage.rows.length === 0 ? (
        <Panel title="قائمة العلامات التجارية">
          <EmptyState
            title="لا توجد علامات تجارية مطابقة"
            hint="ملقيناش نتائج بالفلترة دي — غيّر كلمة البحث أو ألغِ الفلترة وجرب تاني."
          />
        </Panel>
      ) : (
        <Panel title="قائمة العلامات التجارية" sub="العلامات مرتبة بالاسم" flush>
          <DataTable
            caption="العلامات التجارية"
            columns={[
              { header: "العلامة" },
              { header: "عدد المنتجات", numeric: true },
              { header: "معروضة؟" },
              { header: "الحالة" },
            ]}
            rows={brandPage.rows.map((row) => [
              <span key={`${row.id}-name`} className="adm-cell-main">
                <span className="adm-cell-title">{row.name}</span>
                <NameBadge name={row.name} />
              </span>,
              row.productCount,
              row.isActive ? "نعم" : "لا",
              <span key={`${row.id}-state`} className="adm-cell-main">
                <Pill tone={row.isActive ? "success" : "neutral"}>{row.isActive ? "معروضة" : "مخفية"}</Pill>
                {row.deletedAt ? <Pill tone="danger">محذوف</Pill> : null}
              </span>,
            ])}
          />
          <ListPager params={brandParams} nextCursor={brandPage.nextCursor} cursorKey="bcursor" label="علامة تجارية" />
        </Panel>
      )}

      <Panel title="إضافة علامة تجارية" sub="العلامة الجديدة بتظهر للعميل مع منتجات الشركة">
        <PermissionGate permissions={admin.permissions} required="products.create" action="إضافة علامة تجارية">
          <BrandCreateForm />
        </PermissionGate>
      </Panel>

      <Panel title="تعديل علامة تجارية" sub="تغيير الاسم أو إظهار العلامة في المتجر">
        <PermissionGate permissions={admin.permissions} required="products.update" action="تعديل علامة تجارية">
          <BrandEditForm brands={brandRows} />
        </PermissionGate>
      </Panel>

      <Panel
        title="تعطيل علامة تجارية"
        sub="التعطيل بيخفي العلامة ومنتجاتها من المتجر، وبيسيبها في الكتالوج"
      >
        <PermissionGate permissions={admin.permissions} required="products.update" action="تعطيل علامة تجارية">
          <BrandDeactivateForm brands={brandRows} />
        </PermissionGate>
      </Panel>

      <Note tone="info">
        التصنيف والعلامة التجارية مش نفس الحاجة: التصنيف بيقول المنتج فين، والعلامة التجارية بتقول
        مين بيعه. كل منتج ليه تصنيف واحد بس، وبيلاقي تحته كل منتجات نفس الشركة.
      </Note>
    </>
  );
}
