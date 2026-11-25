// Admin product detail — one screen, four separated panels.
//
// Every panel answers one question: what the product is, what it is sold as,
// how it is coded, and how its data can be changed. Write controls stay
// behind the exact permission the server enforces; the price columns are
// hidden behind the price capability instead of being left half-rendered.
//
// A damaged stored name is shown exactly as stored — never hidden, never
// rewritten — and it carries the review badge from the display-only
// classifier. The raw text is repeated once, in a clearly marked secondary
// block, so the operator can see what is really in the database.

import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/rbac";
import { getProduct, listCategoriesForAdmin, listBrandsForAdmin, listVariantsWithCodes, type AdminTaxonomyFilter } from "@/lib/catalog/queries";
import { toAdminVariant, toMediaImage, type MediaShape } from "@/lib/catalog/serialize";
import { listImages } from "@/lib/catalog/media";
import { ProductLifecycleControls } from "@/components/admin/product-lifecycle-controls";
import { ProductImageManager } from "@/components/admin/product-image-manager";
import { classifyCatalogName } from "@/lib/catalog/name-integrity";
import { PermissionGate } from "@/components/admin/permission-gate";
import { NameBadge } from "@/components/admin/name-badge";
import { CopySlugButton } from "@/components/admin/copy-slug-button";
import { CodeCreateForm } from "@/components/admin/code-create-form";
import { ProductEditForm } from "@/components/admin/product-edit-form";
import { VariantCreateForm, VariantEditPanel } from "@/components/admin/variant-form";
import { VariantPriceEditor } from "@/components/admin/variant-price-editor";
import { AdminRetryButton } from "@/components/admin/ui/controls";
import {
  DataTable,
  EmptyState,
  KeyValue,
  Note,
  PageHead,
  Panel,
  Pill,
} from "@/components/admin/ui/surfaces";
import {
  codeTypeLabel,
  formatDate,
  formatDateTime,
  formatMoney,
  productTypeLabel,
  sizeUnitLabel,
  unitLabel,
} from "@/lib/admin/terminology";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "تفاصيل المنتج — الإدارة",
  robots: { index: false, follow: false },
};

type PickerOption = { id: string; name: string };

// Load the actual keyset to completion. Only id/name reach the edit island;
// any failed page discards the incomplete lookup instead of making it usable.
async function loadPickerOptions(
  query: (filter: AdminTaxonomyFilter) => Promise<{ rows: PickerOption[]; nextCursor: string | null }>,
): Promise<PickerOption[]> {
  const options: PickerOption[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = await query({ limit: 200, cursor, search: null, isActive: null, includeDeleted: false });
    options.push(...page.rows.map(({ id, name }) => ({ id, name })));
    cursor = page.nextCursor;
    if (cursor !== null) {
      if (seen.has(cursor)) throw new Error("Taxonomy pagination did not advance");
      seen.add(cursor);
    }
  } while (cursor !== null);
  return options;
}

function withCurrentOption(options: PickerOption[], current: PickerOption | null): PickerOption[] {
  if (!current || options.some((option) => option.id === current.id)) return options;
  // A product can still reference archived taxonomy excluded from the lookup.
  return [...options, { id: current.id, name: current.name }];
}

export default async function AdminProductDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const admin = await requirePermission("products.view");
  const { id } = await params;
  const sp = await searchParams;
  const justCreated = sp.created === "1";

  const row = await getProduct(id, true).catch(() => null);
  if (!row) notFound();

  const variantRows = await listVariantsWithCodes(id).catch(() => null);
  const shapes = variantRows ? variantRows.map((variant) => toAdminVariant(variant, admin.permissions)) : [];
  const codesByVariant = new Map((variantRows ?? []).map((variant) => [variant.id, variant.codes]));
  let images: MediaShape[] | null;
  try { images = (await listImages(id)).map(toMediaImage); } catch { images = null; }

  // The price capability is separate from the product capability: an account
  // may edit a product without being allowed to see its prices.
  const canSeePrice = admin.permissions.includes("prices.view");
  const canUpdatePrice = admin.permissions.includes("prices.update");

  const [categories, brands] = await Promise.all([
    loadPickerOptions(listCategoriesForAdmin).catch(() => null),
    loadPickerOptions(listBrandsForAdmin).catch(() => null),
  ]);

  const trust = classifyCatalogName(row.name);
  const needsReview = trust === "needs-review";
  const isDisplayed = !row.deletedAt && row.isActive;
  const productState = row.deletedAt ? "مؤرشف" : row.isActive ? "معروض في المتجر" : "مخفي من المتجر";

  const codeRows = (variantRows ?? []).flatMap((variant) =>
    variant.codes.map((code) => ({
      id: code.id,
      code: code.code,
      type: code.type,
      isPrimary: code.isPrimary,
      variantName: variant.name,
    })),
  );

  return (
    <>
      <PageHead
        eyebrow="المنتجات"
        title={row.name}
        intro={
          <span className="adm-btn-row">
            <span>بيانات المنتج وأشكال بيعه وأسعاره وأكواده، وكلها من نفس الصفحة.</span>
            <NameBadge name={row.name} />
          </span>
        }
        actions={
          <>
            {admin.permissions.includes("products.update") ? (
              <Link href="#edit-product" className="adm-btn adm-btn--secondary">
                تعديل بيانات المنتج
              </Link>
            ) : null}
            {admin.permissions.includes("products.create") ? (
              <Link href="#add-shape" className="adm-btn adm-btn--primary">
                إضافة شكل بيع جديد
              </Link>
            ) : null}
          </>
        }
      />

      {justCreated ? (
        <Note tone="accent">
          تم إنشاء المنتج وأول شكل للبيع. تقدر تضيف باقي الأشكال والأكواد من تحت.
        </Note>
      ) : null}

      {needsReview ? (
        <Note tone="warn">
          <div className="adm-cell-main">
            <span className="adm-cell-title">اسم المنتج محتاج مراجعة.</span>
            <span className="adm-hint">
              النص المخزّن فيه علامات تدل على مشكلة ترميز قديمة في البيانات — مش خطأ منك. الاسم
              معروض زي ما هو محفوظ بالحرف، ومراجعة الأسماء وتصحيحها مشروع منفصل.
            </span>
            <span className="adm-cell-sub">النص المخزّن</span>
            <bdi dir="ltr" className="adm-cell-id">
              {row.name}
            </bdi>
          </div>
        </Note>
      ) : null}

      <Note tone="info">
        الصفحة دي بتجمع كل حاجة عن المنتج: بياناته، وأشكال بيعه، وأسعاره، وأكواده. التعديلات
        بتظهر للعميل لما المنتج يكون معروضًا في المتجر، مش لمجرد حفظها. الشكل هو الحاجة اللي بتتباع فعلاً — من غير
        شكل وسعر المنتج مش هيبان في المتجر ومش هيتباع في نقطة البيع. لو بتغيّر اسم المنتج أو
        تصنيفه، خد بالك إن العميل بيشوف الاسم الجديد في صفحة المنتج.
      </Note>

      {/* ------------------------------------------------- product facts */}
      <Panel
        title="بيانات المنتج"
        sub="اللي بيتحفظ في الكتالوج للمنتج ده"
        footer={
          <div className="adm-btn-row">
            <CopySlugButton value={row.slug} />
            <bdi dir="ltr" className="adm-cell-id">
              {row.slug}
            </bdi>
            {isDisplayed ? (
              <Link
                href={`/p/${row.id}/${row.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="adm-btn adm-btn--ghost adm-btn--sm"
              >
                افتحه في المتجر
              </Link>
            ) : null}
          </div>
        }
      >
        <KeyValue
          items={[
            { label: "التصنيف", value: row.category.name },
            { label: "العلامة التجارية", value: row.brand?.name ?? "—" },
            { label: "طريقة البيع", value: productTypeLabel(row.productType) },
            { label: "الوحدة", value: unitLabel(row.unit) },
            ...(row.productType === "WEIGHT"
              ? [
                  {
                    label: "خطوة البيع",
                    value: row.saleStepGrams === null ? "—" : `${row.saleStepGrams} ${unitLabel("GRAM")}`,
                  },
                ]
              : []),
            { label: "حالة المنتج", value: productState },
            { label: "تاريخ الإنشاء", value: formatDate(row.createdAt) },
            { label: "تاريخ آخر تعديل", value: formatDateTime(row.updatedAt) },
          ]}
        />
        <div className="adm-btn-row">
          <CopySlugButton value={row.slug} />
          <bdi dir="ltr" className="adm-cell-id">
            {row.slug}
          </bdi>
          {isDisplayed ? (
            <Link
              href={`/p/${row.id}/${row.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="adm-btn adm-btn--ghost adm-btn--sm"
            >
              افتحه في المتجر
            </Link>
          ) : null}
        </div>
      </Panel>

      {admin.permissions.includes("products.update") || admin.permissions.includes("products.delete") ? (
        <Panel title="أرشفة واستعادة المنتج" sub="تغيير حالة المنتج فقط، وليس حذف بياناته" footer={
          <Link href="/admin/products?state=archived" prefetch={false} className="adm-btn adm-btn--secondary">المنتجات المؤرشفة</Link>
        }>
          <ProductLifecycleControls key={row.updatedAt.toISOString()} productId={row.id} productName={row.name}
            archived={!!row.deletedAt} expectedUpdatedAt={row.updatedAt.toISOString()}
            canArchive={admin.permissions.includes("products.delete")} canRestore={admin.permissions.includes("products.update")}
            canDelete={admin.permissions.includes("products.delete")} />
        </Panel>
      ) : null}

      <Panel title="صور المنتج" sub="معرض مرتب وبيانات روابط الصور فقط">
        {images === null ? <>
          <Note tone="warn">تعذّر تحميل صور المنتج. البيانات غير متاحة حاليًا، وده مش معناه إن المعرض فاضي.</Note>
          <AdminRetryButton />
        </> : <ProductImageManager productId={row.id} images={images}
          canUpdate={admin.permissions.includes("products.update")} canDelete={admin.permissions.includes("products.delete")} />}
      </Panel>

      {/* --------------------------------------------------- sell shapes */}
      <Panel
        title="أشكال البيع"
        sub="الشكل هو الحاجة اللي بتتباع فعلاً، وكل شكل ليه سعره"
        flush
      >
        {!canSeePrice ? (
          <div className="adm-panel-body">
            <Note tone="info">
              الأسعار مش معروضة لحسابك. لو محتاج تعدّل سعر، كلّم مالك المتجر عشان يضيف صلاحية عرض
              الأسعار لحسابك.
            </Note>
          </div>
        ) : null}

        {variantRows === null ? (
          <div className="adm-panel-body">
            <Note tone="warn">تعذّر تحميل أشكال البيع. البيانات غير متاحة حاليًا.</Note>
            <AdminRetryButton />
          </div>
        ) : shapes.length === 0 ? (
          <EmptyState
            title="مفيش أشكال بيع للمنتج ده"
            hint="من غير شكل بيع وسعر، المنتج مش هيبان في المتجر ومش هيتباع في نقطة البيع. ابدأ بإضافة أول شكل من تحت."
          />
        ) : (
          <DataTable
            caption="أشكال بيع المنتج"
            columns={[
              { header: "الشكل" },
              { header: "الحجم والوحدة" },
              { header: "السعر", numeric: true },
              { header: "السعر قبل الخصم", numeric: true },
              { header: "الكود الأساسي" },
              { header: "الحالة" },
            ]}
            rows={shapes.map((shape) => {
              const codes = codesByVariant.get(shape.id) ?? [];
              const primary = codes.find((code) => code.isPrimary) ?? codes[0];
              return [
                <span key={`${shape.id}-name`} className="adm-cell-main">
                  <span className="adm-cell-title">{shape.name}</span>
                </span>,
                shape.sizeValue
                  ? `${shape.sizeValue} ${shape.sizeUnit ? sizeUnitLabel(shape.sizeUnit) : ""}`.trim()
                  : "—",
                canSeePrice ? formatMoney(shape.price) : "—",
                canSeePrice && shape.compareAtPrice !== null ? formatMoney(shape.compareAtPrice) : "—",
                primary ? (
                  <bdi key={`${shape.id}-code`} dir="ltr" className="adm-cell-id">
                    {primary.code}
                  </bdi>
                ) : (
                  "—"
                ),
                shape.isActive ? (
                  <Pill key={`${shape.id}-state`} tone="success">
                    معروض
                  </Pill>
                ) : (
                  <Pill key={`${shape.id}-state`} tone="neutral">
                    مخفي
                  </Pill>
                ),
              ];
            })}
          />
        )}

        {variantRows !== null ? (
          <div className="adm-panel-body">
            <PermissionGate permissions={admin.permissions} required="prices.update" action="تعديل الأسعار">
              <div className="adm-form">
                <h3 className="adm-section-title">تعديل سعر شكل</h3>
                <p className="adm-section-intro">
                  كل تغيير سعر بيتسجل في تاريخ الأسعار بالتاريخ والسبب، عشان أي مراجعة بعدين تقدر
                  تعرف السعر اتغيّر إزاي.
                </p>
                <VariantPriceEditor
                  canSeePrices={canSeePrice}
                  variants={canSeePrice ? shapes.map((shape) => ({ id: shape.id, name: shape.name, price: shape.price! })) : []}
                />
              </div>
            </PermissionGate>
          </div>
        ) : null}
      </Panel>

      {/* ------------------------------------------------------- the codes */}
      <Panel title="الأكواد" sub="الباركود والكود الداخلي لكل شكل بيع" flush>
        {variantRows === null ? (
          <div className="adm-panel-body">
            <Note tone="warn">تعذّر تحميل الأكواد. البيانات غير متاحة حاليًا.</Note>
          </div>
        ) : codeRows.length === 0 ? (
          <EmptyState
            title="مفيش أكواد مسجلة"
            hint="الباركود هو اللي بيتقرا في نقطة البيع، والكود الداخلي للاستخدام الداخلي. سجّلهم من تحت."
          />
        ) : (
          <DataTable
            caption="أكواد المنتج"
            columns={[
              { header: "الشكل" },
              { header: "نوع الكود" },
              { header: "الكود" },
              { header: "أساسي؟" },
            ]}
            rows={codeRows.map((code) => [
              code.variantName,
              codeTypeLabel(code.type),
              <bdi key={code.id} dir="ltr" className="adm-cell-id">
                {code.code}
              </bdi>,
              code.isPrimary ? "نعم" : "لا",
            ])}
          />
        )}

        <div className="adm-panel-body">
          <PermissionGate permissions={admin.permissions} required="products.create" action="تسجيل الأكواد">
            {variantRows !== null ? (
              <CodeCreateForm variants={shapes.map((shape) => ({ id: shape.id, name: shape.name }))} />
            ) : null}
          </PermissionGate>
        </div>
      </Panel>

      {/* -------------------------------------------------- shape editing */}
      <Panel title="تعديل شكل بيع" sub="الاسم والحجم والسعر قبل الخصم وحالة الظهور">
        <PermissionGate permissions={admin.permissions} required="products.update" action="تعديل أشكال البيع">
          {variantRows === null ? (
            <Note tone="warn">أشكال البيع غير متاحة للتعديل حاليًا.</Note>
          ) : (
            <VariantEditPanel
              canEditCost={canSeePrice && canUpdatePrice}
              canEditPrices={canSeePrice && canUpdatePrice}
              variants={shapes.map((shape) => ({
                id: shape.id,
                name: shape.name,
                sizeValue: shape.sizeValue,
                sizeUnit: shape.sizeUnit,
                ...(canSeePrice ? { price: shape.price, compareAtPrice: shape.compareAtPrice, costPrice: shape.costPrice } : {}),
                isActive: shape.isActive,
              }))}
            />
          )}
        </PermissionGate>
      </Panel>

      {/* -------------------------------------------------- adding a shape */}
      <section id="add-shape">
        <Panel title="إضافة شكل بيع جديد" sub="الشكل الجديد بياخد سعره وكوده من هنا">
          <PermissionGate permissions={admin.permissions} required="products.create" action="إضافة شكل بيع">
            <VariantCreateForm productId={row.id} canEditCost={canUpdatePrice} />
          </PermissionGate>
        </Panel>
      </section>

      {/* ---------------------------------------------- editing the product */}
      <section id="edit-product">
        <Panel title="تعديل بيانات المنتج" sub="الاسم والتصنيف والعلامة التجارية وطريقة البيع">
          <PermissionGate permissions={admin.permissions} required="products.update" action="تعديل المنتج">
            {categories === null || brands === null ? (
              <>
                <Note tone="warn">
                  {categories === null ? <p>تعذّر تحميل قائمة التصنيفات كاملة.</p> : null}
                  {brands === null ? <p>تعذّر تحميل قائمة العلامات التجارية كاملة.</p> : null}
                  <p>التعديل غير متاح لحد ما القوائم تتحمّل كاملة. البيانات الحالية محفوظة زي ما هي.</p>
                </Note>
                <AdminRetryButton />
              </>
            ) : (
              <ProductEditForm
                productId={row.id}
                product={{
                  name: row.name,
                  description: row.description,
                  isActive: row.isActive,
                  categoryId: row.category.id,
                  brandId: row.brand?.id ?? null,
                  productType: row.productType === "WEIGHT" ? "WEIGHT" : "PIECE",
                  unit: row.unit === "GRAM" ? "GRAM" : row.unit === "KG" ? "KG" : "PIECE",
                  saleStepGrams: row.saleStepGrams,
                }}
                categories={withCurrentOption(categories, row.category)}
                brands={withCurrentOption(brands, row.brand)}
              />
            )}
          </PermissionGate>
        </Panel>
      </section>
    </>
  );
}
