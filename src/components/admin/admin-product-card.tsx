import Link from "next/link";
import { ImageOff } from "lucide-react";
import type { AdminProductRow } from "@/lib/catalog/queries";
import type { MediaRow } from "@/lib/catalog/media";
import { NameBadge } from "@/components/admin/name-badge";
import { Pill } from "@/components/admin/ui/surfaces";
import { formatMoney, productTypeLabel, unitLabel } from "@/lib/admin/terminology";
import styles from "./admin-product-card.module.css";

type CardProduct = Pick<AdminProductRow,
  "id" | "name" | "slug" | "productType" | "unit" | "isActive" |
  "deletedAt" | "category" | "brand" | "minPrice" | "stock"
>;

export function AdminProductCard({
  product,
  image,
  imagesUnavailable = false,
  canSeePrices,
  canManage = false,
}: {
  product: CardProduct;
  image: Pick<MediaRow, "url" | "altText"> | null;
  imagesUnavailable?: boolean;
  canSeePrices: boolean;
  canManage?: boolean;
}) {
  const archived = product.deletedAt !== null;
  const displayed = !archived && product.isActive;
  const stock = product.stock;

  return (
    <article className={styles.card} aria-label={product.name}>
      <div className={image ? styles.imageFrame : styles.imageEmptyStrip}>
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image.url}
            alt={image.altText?.trim() || product.name}
            loading="lazy"
            className={styles.image}
          />
        ) : (
          <span className={styles.imagePlaceholder}>
            <ImageOff size={26} strokeWidth={1.5} aria-hidden="true" />
            <span>{imagesUnavailable ? "الصور غير متاحة حاليًا" : "بلا صورة"}</span>
          </span>
        )}
      </div>

      <h2 className={styles.name} title={product.name}>{product.name}</h2>
      <NameBadge name={product.name} />
      <div className={styles.taxonomy}>
        <p>التصنيف: {product.category.name}</p>
        <NameBadge name={product.category.name} />
        <p>العلامة التجارية: {product.brand?.name || "بدون علامة تجارية"}</p>
        {product.brand ? <NameBadge name={product.brand.name} /> : null}
      </div>
      <p className={styles.sale}>
        {productTypeLabel(product.productType)} · الوحدة: {unitLabel(product.unit)}
      </p>

      <div className={styles.statuses}>
        <Pill tone={archived ? "warn" : displayed ? "success" : "neutral"}>
          {archived ? "مؤرشف" : displayed ? "معروض" : "مخفي"}
        </Pill>
        <Pill tone={stock === "in" ? "success" : stock === "oos" ? "danger" : "neutral"}>
          {stock === "in" ? "متوفر" : stock === "oos" ? "غير متوفر" : "التوفر غير محدد"}
        </Pill>
      </div>

      {canSeePrices ? (
        <p className={styles.price}>
          {product.minPrice !== null ? (
            <>يبدأ من <bdi>{formatMoney(product.minPrice)}</bdi></>
          ) : "لا يوجد سعر لشكل بيع متاح"}
        </p>
      ) : null}

      <div className={styles.links}>
        <Link
          href={`/admin/products/${product.id}`}
          className="adm-btn adm-btn--secondary adm-btn--sm"
          aria-label={`${canManage && !archived ? "تفاصيل وإدارة" : "التفاصيل"}: ${product.name}`}
        >
          {canManage && !archived ? "تفاصيل وإدارة" : "التفاصيل"}
        </Link>
        {displayed ? (
          <Link
            href={`/p/${product.id}/${encodeURIComponent(product.slug)}`}
            className="adm-btn adm-btn--ghost adm-btn--sm"
            aria-label={`عرض في المتجر: ${product.name}`}
          >
            عرض في المتجر
          </Link>
        ) : null}
      </div>
    </article>
  );
}
