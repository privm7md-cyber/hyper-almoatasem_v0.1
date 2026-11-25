// ADMIN ORDER DETAIL — the operator's working screen for one order.
//
// The screen answers three things in order: what the order IS (customer,
// items, money, history) and then the ONE thing that can be done next. The
// server re-checks every gate on every write, so the page never offers a
// button that is bound to fail; where a step is blocked, the page says
// exactly what is missing instead.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { uuidSchema } from "@/lib/api/validation";
import { requirePermission } from "@/lib/auth/rbac";
import { getOrderFull } from "@/lib/orders/queries";
import { toOrder } from "@/lib/orders/serialize";
import { listReplacementsByOrder } from "@/lib/replacements/queries";
import { toReplacement } from "@/lib/replacements/serialize";
import { listOrderActorNames } from "@/lib/orders/admin-queue";
import { canCustomerCancel } from "@/lib/orders/display";
import {
  actorTypeLabel,
  formatDateTime,
  formatMoney,
  formatQuantity,
  itemStatusLabel,
  orderStatusLabel,
  replacementStatusLabel,
  unitLabel,
} from "@/lib/admin/terminology";
import { PermissionGate } from "@/components/admin/permission-gate";
import { CopyTextButton, OrderAction, PickForm, ProposeForm } from "@/components/admin/fulfillment-forms";
import {
  DataTable,
  EmptyState,
  ErrorState,
  KeyValue,
  Note,
  PageHead,
  Panel,
  Pill,
  StatusPill,
  type PillTone,
} from "@/components/admin/ui/surfaces";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "تفاصيل الطلب — الإدارة",
  robots: { index: false, follow: false },
};

/** Tones for the order status pill. */
const STATUS_TONE: Record<string, PillTone> = {
  NEW: "accent",
  CONFIRMED: "info",
  PREPARING: "info",
  READY_FOR_DELIVERY: "warn",
  OUT_FOR_DELIVERY: "warn",
  DELIVERED: "success",
  CANCELLED: "danger",
};

/** Tones for a line inside the order. */
const ITEM_TONE: Record<string, PillTone> = {
  PENDING: "warn",
  FULFILLED: "success",
  PARTIALLY_FULFILLED: "info",
  UNAVAILABLE: "danger",
  REPLACED: "info",
  CANCELLED: "neutral",
};

const CANCELABLE_STATES = ["NEW", "CONFIRMED", "PREPARING"];
const FULFILLMENT_MILESTONES = [
  "NEW",
  "CONFIRMED",
  "PREPARING",
  "READY_FOR_DELIVERY",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
] as const;

export default async function AdminOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requirePermission("orders.view");
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  let row: Awaited<ReturnType<typeof getOrderFull>>;
  try {
    row = await getOrderFull(id);
  } catch {
    return <ErrorState title="مقدرناش نحمّل الطلب" hint="حصلت مشكلة في قراءة الطلب. جرّب تحديث الصفحة." />;
  }
  if (!row) notFound();

  const order = toOrder(row);
  const isGuest = row.customerId === null;
  const replacementRows = await listReplacementsByOrder(id).catch(() => null);
  const replacements = replacementRows?.map(toReplacement) ?? [];
  const actorNames = admin.permissions.includes("users.view")
    ? await listOrderActorNames(row.history.filter((entry) => entry.actorType === "STAFF").map((entry) => entry.actorId ?? "")).catch(
        () => new Map<string, string>(),
      )
    : new Map<string, string>();

  const status = order.status;
  const milestoneIdx = FULFILLMENT_MILESTONES.indexOf(status as (typeof FULFILLMENT_MILESTONES)[number]);
  const isCancelled = status === "CANCELLED";
  const lastActiveBeforeCancel = isCancelled
    ? row.history.map((entry) => entry.oldStatus).reverse().find((s) => s && FULFILLMENT_MILESTONES.includes(s as (typeof FULFILLMENT_MILESTONES)[number]))
    : null;
  const cancelAnchorIdx = lastActiveBeforeCancel
    ? FULFILLMENT_MILESTONES.indexOf(lastActiveBeforeCancel as (typeof FULFILLMENT_MILESTONES)[number])
    : 0;
  const pendingLines = order.items.filter((item) => item.itemStatus === "PENDING");
  const openProposals = replacements.filter((replacement) => replacement.status === "PROPOSED");
  const cancelAllowedByState = CANCELABLE_STATES.includes(status);
  const cancelAllowed = canCustomerCancel({ status, items: order.items });
  const missing: string[] = [];
  if (pendingLines.length) missing.push(`${pendingLines.length} صنف لسه متجهّزش`);
  if (openProposals.length) missing.push(`${openProposals.length} بديل لسه منتظر قرار العميل`);
  if (replacementRows === null) missing.push("حالة البدائل مش معروفة بسبب تعذّر تحميلها");

  return (
    <>
      <PageHead
        eyebrow="الطلبات"
        title={`الطلب ${order.orderNumber}`}
        actions={
          <StatusPill tone={STATUS_TONE[status] ?? "neutral"}>{orderStatusLabel(status)}</StatusPill>
        }
        intro={`الطلب ده بتاع ${order.customerName}. الصفحة فيها بياناته وعنوان التوصيل، والأصناف اللي محتاجة تجهيز، وحساب الطلب. الخطوة اللي الفريق يقدر ياخدها دلوقتي باينة في أول لوحة تحت.`}
      />

      <Panel title="مسار تنفيذ الطلب" sub={isCancelled ? "توقّف المسار عند الإلغاء" : "المراحل من استلام الطلب وحتى التسليم"}>
        <ul className="adm-order-stepper" aria-label="مراحل تنفيذ الطلب">
          {FULFILLMENT_MILESTONES.map((step, idx) => {
            let stateClass = "adm-order-step";
            let stateText = "قادم";
            if (isCancelled) {
              if (idx <= cancelAnchorIdx) {
                stateClass += " adm-order-step--done";
                stateText = "مكتمل";
              } else {
                stateText = "لم يصل";
              }
            } else if (milestoneIdx >= 0) {
              if (idx < milestoneIdx) {
                stateClass += " adm-order-step--done";
                stateText = "مكتمل";
              } else if (idx === milestoneIdx) {
                stateClass += " adm-order-step--current";
                stateText = "الحالة الحالية";
              }
            }
            return (
              <li key={step} className={stateClass} aria-current={!isCancelled && idx === milestoneIdx ? "step" : undefined}>
                <span className="adm-order-step-state">{stateText}</span>
                <span className="adm-order-step-title">{orderStatusLabel(step)}</span>
              </li>
            );
          })}
          {isCancelled ? (
            <li className="adm-order-step adm-order-step--cancelled" aria-current="step">
              <span className="adm-order-step-state">تم الإيقاف</span>
              <span className="adm-order-step-title">{orderStatusLabel("CANCELLED")}</span>
            </li>
          ) : null}
        </ul>
      </Panel>

      {/* ------------------------------------------------- customer + address */}
      <Panel title="بيانات العميل والتوصيل" sub="البيانات متسجلة وقت الطلب، ومفيش حاجة بتتغير من هنا">
        <KeyValue
          items={[
            { label: "اسم العميل", value: order.customerName },
            {
              label: "نوع العميل",
              value: isGuest ? "ضيف — الطلب غير مرتبط بحساب" : (
                admin.permissions.includes("customers.view")
                  ? <Link href={`/admin/customers/${row.customerId}`} className="adm-cell-title">عميل مسجل — افتح ملف العميل</Link>
                  : "عميل مسجل"
              ),
            },
            {
              label: "تليفون العميل",
              value: (
                <span className="adm-cell-sub" dir="ltr">
                  {order.customerPhone}
                  <CopyTextButton value={order.customerPhone} label="تليفون العميل" />
                </span>
              ),
            },
            { label: "المدينة", value: order.delivery.city || "—" },
            { label: "المنطقة", value: order.delivery.area ?? "—" },
            { label: "القرية", value: order.delivery.village ?? "—" },
            { label: "الشارع", value: order.delivery.street ?? "—" },
            { label: "رقم العمارة", value: order.delivery.building ?? "—" },
            { label: "أقرب علامة مميزة", value: order.delivery.landmark ?? "—" },
            { label: "تليفون التوصيل", value: order.delivery.phone || "—" },
            { label: "ملاحظات الطلب", value: row.notes ?? "مفيش ملاحظات متسجلة على الطلب." },
          ]}
        />
      </Panel>

      {/* --------------------------------------------------------- the items */}
      <Panel title="أصناف الطلب" sub="الأسماء والأسعار متسجلة وقت الطلب زي ما العميل شافها" flush>
        {order.items.length === 0 ? (
          <div className="adm-panel-body">
            <EmptyState title="مفيش أصناف في الطلب" hint="الطلب اتسجل من غير أصناف." />
          </div>
        ) : (
          <DataTable
            caption="أصناف الطلب والكمية المجهّزة لكل صنف"
            columns={[
              { header: "المنتج" },
              { header: "الشكل المباع" },
              { header: "العلامة التجارية" },
              { header: "الكود" },
              { header: "الوحدة" },
              { header: "الكمية المطلوبة", numeric: true },
              { header: "الكمية المجهّزة", numeric: true },
              { header: "سعر الوحدة", numeric: true },
              { header: "الإجمالي", numeric: true },
              { header: "حالة الصنف" },
            ]}
            rows={order.items.map((item) => [
              item.productName,
              item.variantName,
              item.brandName ?? "—",
              item.productCode ? (
                <span className="adm-cell-id" dir="ltr">
                  {item.productCode}
                </span>
              ) : (
                "—"
              ),
              unitLabel(item.unit),
              formatQuantity(item.requestedQuantity),
              formatQuantity(item.actualQuantity),
              formatMoney(item.unitPrice),
              formatMoney(item.finalTotal ?? item.estimatedTotal),
              <Pill key={`${item.id}-status`} tone={ITEM_TONE[item.itemStatus] ?? "neutral"}>
                {itemStatusLabel(item.itemStatus)}
              </Pill>,
            ])}
          />
        )}
      </Panel>

      {/* ------------------------------------------------------------- money */}
      <Panel title="الحساب" sub="الأرقام دي بتتحدّث مع كل خطوة في التجهيز">
        <KeyValue
          items={[
            {
              label: order.subtotalFinal === null ? "المجموع الفرعي التقديري" : "المجموع الفرعي النهائي",
              value: formatMoney(order.subtotalFinal ?? order.subtotalEstimated),
            },
            { label: "الخصم", value: formatMoney(order.discountTotal) },
            { label: "رسوم التوصيل", value: formatMoney(order.deliveryFee) },
            {
              label: order.totalFinal === null ? "الإجمالي التقديري" : "الإجمالي النهائي",
              value: formatMoney(order.totalFinal ?? order.totalEstimated),
            },
          ]}
        />
        <div className="adm-mt-3">
          <Note tone="info">
            {order.totalFinal === null
              ? "الإجمالي التقديري ده اتحسب وقت تأكيد الطلب. رقمه النهائي بيقف لما الفريق يخلّص تجهيز الأصناف، والتوصيل بيتحسب عليه."
              : "الإجمالي النهائي ده اتقفل لما التجهيز خلص، وبيوضح قيمة الطلب مش إثبات الدفع."}
            {" "}مفيش في نموذج الطلب بيانات تثبت الدفع أو المبلغ المحصّل؛ الإجمالي النهائي مش دليل إن العميل دفع.
          </Note>
        </div>
      </Panel>

      {/* ------------------------------------------------------- next action */}
      <Panel title="الخطوة الجاية" sub="الخطوة اللي الحالة الحالية بتسمح بيها">
        <div className="adm-section">
          {status === "CONFIRMED" ? (
            <>
              <Note tone="accent">
                الطلب متأكد ومستني التجهيز. اضغط «ابدأ تجهيز الطلب» عشان الفريق يقدر يسجّل الكمية اللي
                اتجهّزت لكل صنف، والخطوة بتتحفظ في سجل التغييرات باسمك.
              </Note>
              <PermissionGate permissions={admin.permissions} required="orders.update" action="بدء تجهيز الطلب">
                <OrderAction
                  path={`/api/admin/orders/${order.id}/prepare`}
                  label="ابدأ تجهيز الطلب"
                  successText="الطلب بقى قيد التجهيز."
                  failureText="مقدرناش نبدأ تجهيز الطلب. حاول تاني."
                />
              </PermissionGate>
            </>
          ) : null}

          {status === "PREPARING" ? (
            <>
              <Note tone="accent">
                الفريق بيجهّز الطلب دلوقتي. لكل صنف لسه فاضل: سجّل الكمية اللي اتجهّزت، أو سجّله كغير متوفر
                لو خلص من المخزن. الكمية المسجّلة بتخصم من المخزون على طول.
              </Note>

              {pendingLines.length ? (
                <div className="adm-section">
                  {pendingLines.map((item) => (
                    <div key={item.id} className="adm-card">
                      <span className="adm-card-title">
                        {item.productName} · {item.variantName}
                      </span>
                      <p className="adm-card-text">
                        المطلوب {formatQuantity(item.requestedQuantity)} {unitLabel(item.unit)} · سعر الوحدة{" "}
                        {formatMoney(item.unitPrice)}
                      </p>
                      <PermissionGate permissions={admin.permissions} required="orders.update" action="تجهيز الصنف">
                        <PickForm
                          orderId={order.id}
                          itemId={item.id}
                          requested={formatQuantity(item.requestedQuantity)}
                          unit={unitLabel(item.unit)}
                        />
                        <OrderAction
                          path={`/api/admin/orders/${order.id}/items/${item.id}/unavailable`}
                          label="الصنف غير متوفر"
                          variant="secondary"
                          successText="الصنف اتسجل كغير متوفر."
                          failureText="مقدرناش نسجل الصنف كغير متوفر. حاول تاني."
                        />
                      </PermissionGate>
                    </div>
                  ))}
                </div>
              ) : (
                <Note tone="info">كل أصناف الطلب اتجهّزت. مفيش صنف فاضل.</Note>
              )}

              {missing.length ? (
                <Note tone="warn">
                  لسه في {missing.join(" و")}. سجّل الكمية لكل صنف فاضل، وقرار البديل لازم يتاخد قبل ما
                  الطلب يخلص تجهيزه، فخطوة «انهي التجهيز» مش هتنفع دلوقتي.
                </Note>
              ) : (
                <>
                  <Note tone="accent">
                    كل الأصناف اتجهّزت والبدائل اتقررت. اضغط «انهي التجهيز» عشان الطلب يبقى جاهز للتوصيل
                    ويقف على رقمه النهائي.
                  </Note>
                  <PermissionGate permissions={admin.permissions} required="orders.update" action="إنهاء تجهيز الطلب">
                    <OrderAction
                      path={`/api/admin/orders/${order.id}/ready`}
                      label="انهي التجهيز"
                      successText="الطلب بقى جاهز للتوصيل."
                      failureText="مقدرناش نخلّص تجهيز الطلب. حاول تاني."
                    />
                  </PermissionGate>
                </>
              )}
            </>
          ) : null}

          {status === "READY_FOR_DELIVERY" ? (
            <>
              <Note tone="accent">
                الطلب خلص تجهيزه وجاهز يخرج. اضغط «ارسل الطلب للتوصيل» عشان يروح مع مندوب التوصيل، والخطوة
                بتتحفظ في سجل التغييرات باسمك.
              </Note>
              <PermissionGate permissions={admin.permissions} required="orders.update" action="إرسال الطلب للتوصيل">
                <OrderAction
                  path={`/api/admin/orders/${order.id}/dispatch`}
                  label="ارسل الطلب للتوصيل"
                  successText="الطلب خرج للتوصيل."
                  failureText="مقدرناش نبعت الطلب للتوصيل. حاول تاني."
                />
              </PermissionGate>
            </>
          ) : null}

          {status === "OUT_FOR_DELIVERY" ? (
            <>
              <Note tone="accent">
                الطلب خرج مع مندوب التوصيل. اضغط «سجّل تسليم الطلب» لما المندوب يسلّمه للعميل، وساعتها
                الطلب بيتقفل والتسليم بيتسجل باسمك.
              </Note>
              <PermissionGate permissions={admin.permissions} required="orders.update" action="تسجيل تسليم الطلب">
                <OrderAction
                  path={`/api/admin/orders/${order.id}/deliver`}
                  label="سجّل تسليم الطلب"
                  successText="تسليم الطلب اتسجل."
                  failureText="مقدرناش نسجّل التسليم. حاول تاني."
                />
              </PermissionGate>
            </>
          ) : null}

          {status === "NEW" ? (
            <Note tone="warn">
              الطلب لسه في حالة «طلب جديد»، والحالة دي مفيش فيها خطوة تجهيز. الخطوة الوحيدة المتاحة هنا
              هي الإلغاء.
            </Note>
          ) : null}

          {status === "DELIVERED" ? (
            <Note tone="info">الطلب اتسلم وخلص. مفيش خطوات متبقية.</Note>
          ) : null}

          {status === "CANCELLED" ? (
            <Note tone="info">الطلب ده ملغي. مفيش خطوات متبقية.</Note>
          ) : null}

          {cancelAllowed ? (
            <PermissionGate permissions={admin.permissions} required="orders.cancel" action="إلغاء الطلب">
              <div className="adm-section">
                <Note tone="danger">
                  الإلغاء نهائي: بيفك حجز المخزون بس، مش بيرجّع بضاعة ولا بيزود الكمية الفعلية. العميل مش هيستلم الطلب.
                  ينفع بس قبل ما يتسجّل أي كمية على أي صنف، ولازم سبب وتأكيد الإلغاء.
                </Note>
                <OrderAction
                  path={`/api/admin/orders/${order.id}/cancel`}
                  label="ألغِ الطلب"
                  variant="danger"
                  requireCancelReason
                  confirm={{
                    question: "إلغاء الطلب نهائي ومش بيرجع. تأكيد؟",
                    confirmLabel: "ألغِ الطلب",
                  }}
                  successText="الطلب اتلغى."
                  failureText="مقدرناش نلغي الطلب. حاول تاني."
                />
              </div>
            </PermissionGate>
          ) : cancelAllowedByState ? (
            <Note tone="warn">
              الطلب ده اتجهّز منه جزء، ومينفعش يتلغى. الإلغاء ممكن بس قبل ما يتسجّل أي كمية على أي صنف.
            </Note>
          ) : null}
        </div>
      </Panel>

      {/* ------------------------------------------------------- replacements */}
      {replacementRows === null ? (
        <Note tone="warn">مقدرناش نحمّل البدائل. حالتها مش معروفة، وإنهاء التجهيز متوقف لحد ما نقدر نتحقق إن مفيش اقتراحات مفتوحة.</Note>
      ) : null}
      {replacements.length ? (
        <Panel title="البدائل المقترحة" sub="عروض استبدال صنف بمنتج تاني ورود العميل عليها">
          <div className="adm-cards">
            {replacements.map((replacement) => (
              <div key={replacement.id} className="adm-card">
                <span className="adm-card-title">
                  {replacement.original.productName} · {replacement.original.variantName}
                  <span aria-hidden="true"> ← </span>
                  {replacement.substitute.productName} · {replacement.substitute.variantName}
                </span>
                <p className="adm-card-text">
                  الكمية {formatQuantity(replacement.replacementQuantity)} {unitLabel(replacement.substitute.unit)} ·
                  سعر الوحدة {formatMoney(replacement.replacementUnitPrice)} · فرق السعر{" "}
                  {formatMoney(replacement.priceDifference)}
                </p>
                <p className="adm-card-text">
                  الحالة:{" "}
                  <Pill tone={replacement.status === "PROPOSED" ? "warn" : "neutral"}>
                    {replacementStatusLabel(replacement.status)}
                  </Pill>
                </p>
                <p className="adm-cell-sub">
                  مين اقترح: {actorTypeLabel(replacement.proposedByType)} · {formatDateTime(replacement.createdAt)}
                </p>
                {replacement.decidedByType ? (
                  <p className="adm-cell-sub">القرار: {actorTypeLabel(replacement.decidedByType)}</p>
                ) : null}
                {replacement.reason ? <p className="adm-cell-sub">السبب: {replacement.reason}</p> : null}
                {replacement.status === "PROPOSED" ? (
                  <PermissionGate permissions={admin.permissions} required="orders.update" action="إدارة البدائل">
                    <div className="adm-btn-row">
                      <OrderAction
                        path={`/api/admin/replacements/${replacement.id}/withdraw`}
                        label="سحب الاقتراح"
                        variant="secondary"
                        size="sm"
                        confirm={{
                          question: "سحب الاقتراح بيعتبر رفض من المتجر للصنف البديل. تأكيد؟",
                          confirmLabel: "سحب الاقتراح",
                        }}
                        successText="الاقتراح اتسحب."
                        failureText="مقدرناش نسحب الاقتراح. حاول تاني."
                      />
                      {!isGuest ? (
                        <OrderAction
                          path={`/api/admin/replacements/${replacement.id}/auto-accept`}
                          label="قبول حسب موافقة العميل المسبقة"
                          variant="secondary"
                          size="sm"
                          confirm={{
                            question: "الخادم بيتحقق من موافقة العميل المسجل المسبقة: فرق السعر لازم يكون صفر أو أقل، أو الزيادة لا تتجاوز 10٪ من تقدير الصنف الأصلي و50 جنيه معًا. ده مش منح موافقة جديدة. تأكيد؟",
                            confirmLabel: "تحقق واقبل البديل",
                          }}
                          successText="البديل اتقبل حسب الموافقة المسبقة."
                          failureText="القبول محتاج موافقة مسبقة وحدود فرق السعر؛ لو مش متحققين لازم قرار العميل."
                        />
                      ) : <Note tone="info">طلب الضيف محتاج موافقته الصريحة على البديل.</Note>}
                    </div>
                  </PermissionGate>
                ) : null}
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      {/* -------------------------------------------------------- substitute */}
      {status === "CONFIRMED" || status === "PREPARING" ? (
        <Panel title="اقتراح بديل" sub="لو الصنف مش متوفر، اقترح منتج تاني للعميل">
          {pendingLines.length ? (
            <PermissionGate permissions={admin.permissions} required="orders.update" action="اقتراح بديل">
              <ProposeForm
                orderId={order.id}
                lines={pendingLines.map((item) => ({
                  id: item.id,
                  label: `${item.productName} · ${item.variantName} (المطلوب ${formatQuantity(item.requestedQuantity)} ${unitLabel(item.unit)})`,
                }))}
              />
            </PermissionGate>
          ) : (
            <Note tone="info">مفيش صنف فاضل يقترح له بديل.</Note>
          )}
        </Panel>
      ) : null}

      {/* ---------------------------------------------------------- history */}
      <Panel title="سجل حركة الطلب" sub="كل تغيير في حالة الطلب، ومن عمله، وإمتى">
        {row.history.length === 0 ? (
          <EmptyState title="مفيش حركات متسجلة" hint="الطلب لسه ما اتسجلش عليه أي تغيير في الحالة." />
        ) : (
          <ol className="adm-section">
            {row.history.map((entry) => {
              const actorName = entry.actorType === "STAFF" && entry.actorId ? actorNames.get(entry.actorId) : undefined;
              return (
                <li key={entry.id} className="adm-card">
                  <span className="adm-card-title">
                    {entry.oldStatus
                      ? `من «${orderStatusLabel(entry.oldStatus)}» إلى «${orderStatusLabel(entry.newStatus)}»`
                      : `«${orderStatusLabel(entry.newStatus)}»`}
                  </span>
                  <p className="adm-card-text">
                    {actorTypeLabel(entry.actorType)}
                    {actorName ? ` · ${actorName}` : ""} · {formatDateTime(entry.createdAt)}
                  </p>
                  {entry.note ? <p className="adm-cell-sub">ملاحظة: {entry.note}</p> : null}
                </li>
              );
            })}
          </ol>
        )}
      </Panel>

      {/* --------------------------------------------------------- guest key */}
      {isGuest ? <Panel title="اعتماد الطلب للضيف" sub="إدارة إلغاء الوصول للطلب من غير حساب؛ الرمز نفسه مش بيتعرض هنا">
        <PermissionGate permissions={admin.permissions} required="orders.update" action="إدارة اعتماد الضيف">
          <div className="adm-btn-row">
            <OrderAction
              path={`/api/admin/orders/${order.id}/credential/revoke`}
              label="ألغِ رمز الوصول للطلب"
              variant="secondary"
              confirm={{
                question: "إلغاء الرمز بيمنع الضيف من فتح الطلب باللينك. تأكيد؟",
                confirmLabel: "ألغِ الرمز",
              }}
              successText="رمز الوصول اتلغى."
              failureText="مقدرناش نلغي رمز الوصول. حاول تاني."
            />
          </div>
        </PermissionGate>
        <div className="adm-mt-3">
          <Note tone="info">
            إلغاء الرمز الحالي يمنع استخدامه للوصول للطلب. مفيش تجديد أو تسليم رمز من الشاشة دي.
          </Note>
        </div>
      </Panel> : null}

      <Note tone="info">
        كل خطوة بتتسجل في سجل تغييرات الطلب باسم من عملها وبتوقته. لو الحالة اللي قدامك مش السماح خطوة
        واحدة، ارجع للصفحة تاني عشان تشوف آخر حالة.
      </Note>
    </>
  );
}
