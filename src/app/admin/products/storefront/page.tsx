import type { Metadata } from "next";
import Link from "next/link";
import { ProductCard } from "@/components/store/product-card";
import { EmptyState, ErrorState, Note, PageHead, Panel } from "@/components/admin/ui/surfaces";
import { ADMIN_STOREFRONT_PATH, adminStorefrontHref, readAdminStorefrontCatalog } from "@/lib/admin/storefront-catalog";
import { SEARCH_SORT_OPTIONS } from "@/lib/frontend/listing-params";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "كتالوج المتجر — الإدارة", robots: { index: false, follow: false } };

export default async function AdminStorefrontProductsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const data = await readAdminStorefrontCatalog(searchParams);
  const { query, sections, brands } = data;
  // Exactly the homepage's mains, then its ordered parent/child groups.
  const categoryOptions = sections ? [
    ...sections.mains.map(c => ({ id: c.id, name: c.name })),
    ...sections.subs.flatMap(s => s.children.map(c => ({ id: c.id, name: `${s.parent.name} — ${c.name}` }))),
  ] : [];
  const selectedCategoryMissing = query.categoryId && !categoryOptions.some(c => c.id === query.categoryId);
  const selectedBrandMissing = query.brandId && !brands?.some(b => b.id === query.brandId);
  return (
    <>
      <PageHead eyebrow="المنتجات" title="كتالوج المتجر" intro="نفس المنتجات النشطة وترتيبها وبطاقاتها في المتجر، مع روابط الإدارة المسموح بها فقط. هذه الصفحة للقراءة ولا تضيف شيئًا للسلة."
        actions={<>
          <Link href="/admin/products" prefetch={false} className="adm-btn adm-btn--secondary">إدارة كل المنتجات</Link>
          <Link href="/admin/products?state=archived" prefetch={false} className="adm-btn adm-btn--secondary">المنتجات المؤرشفة</Link>
        </>} />

      <Panel title="الأقسام المعروضة في المتجر" sub="اختيار القسم يشمل أقسامه الفرعية">
        {sections === null ? <Note tone="warn">قائمة الأقسام غير متاحة حاليًا؛ الفلترة المحددة لم تتغيّر.</Note> : sections.mains.length === 0 ? (
          <p>لا توجد أقسام رئيسية نشطة.</p>
        ) : <nav aria-label="أقسام كتالوج المتجر">
          <ul className="flex flex-wrap gap-2">
            {sections.mains.map(c => <li key={c.id}>
              <Link href={adminStorefrontHref({ ...query, categoryId: c.id })} prefetch={false} className="adm-btn adm-btn--secondary"
                aria-current={query.categoryId === c.id ? "page" : undefined}>{c.name}</Link>
            </li>)}
          </ul>
          {sections.subs.map(s => <div key={s.parent.id} className="mt-3">
            <p className="font-bold">{s.parent.name}</p>
            <ul className="flex flex-wrap gap-2">
              {s.children.map(c => <li key={c.id}>
                <Link href={adminStorefrontHref({ ...query, categoryId: c.id })} prefetch={false} className="adm-btn adm-btn--ghost"
                  aria-current={query.categoryId === c.id ? "page" : undefined}>{c.name}</Link>
              </li>)}
            </ul>
          </div>)}
        </nav>}
      </Panel>

      <form key={data.startHref + data.rawQuery} method="get" action={ADMIN_STOREFRONT_PATH} className="adm-filters" aria-label="فلاتر كتالوج المتجر">
        <div className="adm-field">
          <label className="adm-label" htmlFor="storefront-q">البحث في المتجر</label>
          <input id="storefront-q" name="q" className="adm-input" defaultValue={data.rawQuery} placeholder="اسم أو كود، من حرفين إلى 120 حرفًا" />
        </div>
        <div className="adm-field">
          <label className="adm-label" htmlFor="storefront-sort">ترتيب النتائج</label>
          <select id="storefront-sort" name="sort" className="adm-select" defaultValue={query.sort}>
            {data.searching ? SEARCH_SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>) : <>
              <option value="created_at">تاريخ الإضافة</option><option value="name">الاسم</option>
            </>}
          </select>
        </div>
        {!data.searching ? <div className="adm-field">
          <label className="adm-label" htmlFor="storefront-dir">اتجاه الترتيب</label>
          <select id="storefront-dir" name="dir" className="adm-select" defaultValue={query.dir}>
            <option value="desc">تنازلي</option><option value="asc">تصاعدي</option>
          </select>
        </div> : null}
        <div className="adm-field">
          <label className="adm-label" htmlFor="storefront-category">القسم</label>
          <select id="storefront-category" name="category" className="adm-select" defaultValue={query.categoryId ?? ""}>
            <option value="">كل الأقسام</option>
            {selectedCategoryMissing ? <option value={query.categoryId!}>القسم المحدد غير متاح في قائمة الخيارات</option> : null}
            {categoryOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="adm-field">
          <label className="adm-label" htmlFor="storefront-brand">العلامة التجارية</label>
          <select id="storefront-brand" name="brand" className="adm-select" defaultValue={query.brandId ?? ""}>
            <option value="">كل العلامات</option>
            {selectedBrandMissing ? <option value={query.brandId!}>العلامة المحددة غير متاحة في قائمة الخيارات</option> : null}
            {brands?.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div className="adm-field">
          <label className="adm-label" htmlFor="storefront-type">طريقة البيع</label>
          <select id="storefront-type" name="type" className="adm-select" defaultValue={query.type ?? ""}>
            <option value="">الكل</option><option value="PIECE">بالقطعة</option><option value="WEIGHT">بالوزن</option>
          </select>
        </div>
        {data.canSeePrices ? <>
          <div className="adm-field">
            <label className="adm-label" htmlFor="storefront-min">من سعر</label>
            <input id="storefront-min" name="minPrice" className="adm-input" inputMode="decimal" defaultValue={query.minPrice ?? ""} />
          </div>
          <div className="adm-field">
            <label className="adm-label" htmlFor="storefront-max">إلى سعر</label>
            <input id="storefront-max" name="maxPrice" className="adm-input" inputMode="decimal" defaultValue={query.maxPrice ?? ""} />
          </div>
        </> : null}
        {data.canSeeInventory && data.availabilityKnown === true ? <div className="adm-field">
          <label className="adm-label" htmlFor="storefront-stock">التوفر</label>
          <select id="storefront-stock" name="inStock" className="adm-select" defaultValue={query.inStock === null ? "" : String(query.inStock)}>
            <option value="">الكل</option><option value="true">له مخزون متاح</option><option value="false">لا يوجد مخزون موجب مسجّل</option>
          </select>
        </div> : null}
        <button type="submit" className="adm-btn adm-btn--primary">تطبيق البحث والفلاتر</button>
      </form>

      {brands === null ? <Note tone="warn">قائمة العلامات التجارية غير متاحة حاليًا؛ الاختيار الحالي محفوظ.</Note> : null}
      {!data.canSeePrices ? <Note tone="info">عرض الأسعار والفلترة بالسعر غير متاحين لحسابك.</Note> : null}
      {!data.canSeeInventory ? <Note tone="info">عرض المخزون والفلترة بالتوفر غير متاحين لحسابك.</Note> : data.availabilityKnown !== true ? (
        <Note tone="warn">بيانات التوفر غير متاحة؛ فلتر المخزون لا يُطبّق. عدم وجود رصيد لا يعني أن المخزون صفر.</Note>
      ) : <Note tone="info">عدم وجود مخزون موجب مسجّل قد يشمل رصيدًا غير معروف. البطاقة تميّز التوفر غير المحدد عن عدم التوفر المؤكد.</Note>}
      {data.invalidCursor ? <Note tone="warn">
        رابط الصفحة غير صالح. {data.page ? "عرضنا بداية النتائج بنفس الفلترة." : "لم نتمكن من عرض بداية النتائج."}
        <p><Link href={data.startHref} prefetch={false}>بداية النتائج بنفس الفلترة</Link></p>
      </Note> : null}

      <Panel title="المنتجات المطابقة">
        <p role="status">{data.total === null ? "إجمالي النتائج غير متاح حاليًا" : `إجمالي النتائج المطابقة: ${data.total}`}</p>
        {data.state === "invalid-query" ? <EmptyState title="اكتب من حرفين إلى 120 حرفًا للبحث" hint="لم يُنفّذ البحث بهذا الاستعلام." /> :
          data.state === "invalid-window" ? <EmptyState title="نطاق السعر غير صالح" hint="الحد الأول أكبر من الثاني — عدّل النطاق. لم يُنفّذ استعلام المنتجات." /> :
          data.state === "error" || data.page === null ? <>
            <ErrorState title="تعذّر تحميل كتالوج المتجر" hint="فشل القراءة لا يعني عدم وجود منتجات." />
            <a href={data.startHref} className="adm-btn adm-btn--secondary">إعادة المحاولة بنفس الفلترة</a>
          </> : <>
            {data.page.cards.some(c => c.imageUnavailable) ? <Note tone="warn">تعذّر قراءة صور المنتجات؛ الصور غير متاحة حاليًا، وليس ذلك تأكيدًا لعدم وجود صور.</Note> : null}
            {data.page.cards.length === 0 ? <EmptyState title="لا توجد نتائج في هذه الصفحة" hint="غيّر البحث أو الفلاتر، أو ارجع لبداية النتائج." /> :
              <div className="adm-storefront-parity-grid grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="بطاقات كتالوج المتجر">
                {data.page.cards.map(product => <div key={product.id} data-product-id={product.id} className="flex flex-col gap-2">
                  <ProductCard product={product} showPurchase={false} />
                  <nav aria-label={`إدارة ${product.name}`} className="adm-btn-row">
                    <Link href={`/admin/products/${product.id}`} prefetch={false} className="adm-btn adm-btn--secondary">تفاصيل الإدارة</Link>
                    {data.canEdit ? <Link href={`/admin/products/${product.id}#edit-product`} prefetch={false} className="adm-btn adm-btn--secondary">تعديل المنتج</Link> : null}
                    {data.canSeeInventory ? <Link href={`/admin/inventory?search=${encodeURIComponent(product.name)}`} prefetch={false} className="adm-btn adm-btn--secondary">بحث مخزون المنتج</Link> : null}
                  </nav>
                </div>)}
              </div>}
            <nav aria-label="صفحات كتالوج المتجر" className="adm-btn-row mt-3">
              <Link href={data.startHref} prefetch={false} className="adm-btn adm-btn--secondary">بداية النتائج بنفس الفلترة</Link>
              {data.nextHref ? <Link href={data.nextHref} prefetch={false} className="adm-btn adm-btn--primary">الصفحة التالية</Link> : <span>نهاية النتائج</span>}
            </nav>
          </>}
      </Panel>
      <Note tone="info">سعر البطاقة يخص أول شكل بيع نشط بترتيب الاسم ثم المعرّف، وليس بالضرورة أرخص شكل. السعر المرجعي ليس عرضًا. كل صفحة تعرض حتى 12 منتجًا؛ الترتيب قد يتغيّر عند تغيّر البيانات.</Note>
    </>
  );
}
