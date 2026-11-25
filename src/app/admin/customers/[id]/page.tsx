// ADMIN CUSTOMER DETAIL — one customer, their addresses and their orders.
//
// Everything on this page is read from the database one page at a time: the
// order history is never loaded whole. The customer is never deleted from
// here — the store keeps the record and its history, and the operator only
// edits contact details.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { decodeCursor, encodeCursor, pageWhereCreatedAt, type PageCursor } from "@/lib/api/pagination";
import { formatDate, formatDateTime, formatMoney, orderStatusLabel } from "@/lib/admin/terminology";
import { NameBadge } from "@/components/admin/name-badge";
import { PermissionGate } from "@/components/admin/permission-gate";
import { CustomerEditForm } from "@/components/admin/customer-edit-form";
import { CustomerRegisterForm } from "@/components/admin/customer-forms";
import { CustomerAnonymizePanel } from "@/components/admin/customer-anonymize-panel";
import {
  getCustomerAnonymizeStatus,
  isCustomerAuditRedactionH2Enabled,
} from "@/lib/customers/anonymize";
import {
  CardGrid,
  DataTable,
  EmptyState,
  ErrorState,
  KeyValue,
  Note,
  PageHead,
  Panel,
  Pager,
  Pill,
  type PillTone,
} from "@/components/admin/ui/surfaces";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "بيانات العميل — الإدارة",
  robots: { index: false, follow: false },
};

const LIMIT = 20;

/** Status tones for the order table — the eye finds the live states first. */
const ORDER_TONE: Record<string, PillTone> = {
  NEW: "accent",
  CONFIRMED: "info",
  PREPARING: "info",
  READY_FOR_DELIVERY: "warn",
  OUT_FOR_DELIVERY: "warn",
  DELIVERED: "success",
  CANCELLED: "danger",
};

type RawParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function fullName(row: { firstName: string; lastName: string | null }): string {
  return row.lastName ? `${row.firstName} ${row.lastName}` : row.firstName;
}

function addressText(address: {
  city: string;
  area: string | null;
  village: string | null;
  street: string | null;
  buildingNumber: string | null;
  landmark: string | null;
}): string {
  return [
    address.city,
    address.area,
    address.village,
    address.street,
    address.buildingNumber ? `عمارة ${address.buildingNumber}` : null,
    address.landmark,
  ]
    .filter(Boolean)
    .join(" · ");
}

export default async function AdminCustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawParams>;
}) {
  const admin = await requirePermission("customers.view");
  const { id } = await params;
  const sp = await searchParams;

  const customer = await prisma.customer.findUnique({ where: { id } }).catch(() => null);
  if (!customer) notFound();

  let cursor: PageCursor | null = null;
  try {
    cursor = decodeCursor(one(sp.cursor) ?? null);
  } catch {
    cursor = null;
  }

  const addresses = await prisma.customerAddress
    .findMany({
      where: { customerId: id },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    })
    .catch(() => []);

  type OrderRow = {
    id: string;
    orderNumber: string;
    status: string;
    totalFinal: { toString(): string } | null;
    totalEstimated: { toString(): string };
    createdAt: Date;
  };
  // The customer's orders are their own permission. An account that may open
  // a customer but may not read orders gets the customer record without a
  // single order row, amount or date — and the orders are never even read.
  const canSeeOrders = admin.permissions.includes("orders.view");
  let orders: OrderRow[] | null = null;
  let hasMore = false;
  let orderCount = 0;
  if (canSeeOrders) {
    try {
      const found = await prisma.order.findMany({
        where: { customerId: id, ...(pageWhereCreatedAt(cursor, "desc") as Prisma.OrderWhereInput) },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: LIMIT + 1,
      });
      hasMore = found.length > LIMIT;
      orders = hasMore ? found.slice(0, LIMIT) : found;
      orderCount = await prisma.order.count({ where: { customerId: id } });
    } catch {
      orders = null;
    }
  }

  const lastOrder = orders && orders.length ? orders[orders.length - 1] : null;
  const nextCursor =
    hasMore && lastOrder ? encodeCursor(lastOrder.createdAt.toISOString(), lastOrder.id) : null;

  const canAnonymize = admin.permissions.includes("customers.anonymize");
  const initialAnonymizeStatus =
    canAnonymize && isCustomerAuditRedactionH2Enabled()
      ? await getCustomerAnonymizeStatus(customer.id).catch(() => null)
      : null;

  const name = fullName(customer);

  return (
    <>
      <PageHead
        eyebrow="العملاء"
        title={name}
        intro="بيانات العميل وطلباته وعناوينه المحفوظة. تعديل بيانات التواصل محتاج صلاحية «تعديل بيانات العملاء»."
        actions={<NameBadge name={name} />}
      />

      {customer.deletedAt ? (
        <Note tone="warn">
          العميل ده متشال من قائمة العملاء، بس بياناته وسجل طلباته محفوظين في المتجر.
        </Note>
      ) : null}

      <Note tone="info">
        الصفحة دي بتقرأ عن العميل: بياناته، وطلباته، وعناوينه اللي اتسجلت مع كل طلب. العناوين
        مش بتتغير بإيدك — كل عنوان اتسجل وقت طلب، فبتظهر هنا زي ما العميل كتبه. التعديلات
        المسموحة هي الاسم والبريد وحالة الحساب وقبول البدائل، والتليفون ما بيتغيرش لأنه المفتاح
        اللي بيتربط بيه الطلبات. أي تعديل بتعمله هنا بيتحفظ على طول وبيتأثر على المتجر فورًا.
      </Note>

      <Panel title="بيانات العميل">
        <KeyValue
          items={[
            { label: "الاسم", value: name },
            { label: "التليفون", value: <bdi>{customer.phone}</bdi> },
            ...(customer.email
              ? [{ label: "البريد الإلكتروني", value: <bdi>{customer.email}</bdi> }]
              : []),
            {
              label: "عنده حساب؟",
              value: customer.isRegistered
                ? "أيوه، عامِل حساب باسم وكلمة سر"
                : "لأ، لسه عميل ضيف من غير حساب",
            },
            {
              label: "حالة الدخول",
              value: customer.lockedUntil
                ? `مقفول لحد ${formatDateTime(customer.lockedUntil)}`
                : "مفتوح، مفيش قفل على الحساب",
            },
            {
              label: "قبول البدائل تلقائيًا",
              value: customer.autoAcceptReplacements ? "أيوه" : "لأ",
            },
            {
              label: "عدد الطلبات",
              value: canSeeOrders ? orderCount : "محجوب — صلاحية عرض الطلبات ناقصة",
            },
            { label: "تاريخ التسجيل", value: formatDate(customer.createdAt) },
          ]}
        />
      </Panel>

      <Panel title="عناوين العميل" sub={`${addresses.length} عنوان محفوظ`}>
        {addresses.length === 0 ? (
          <EmptyState
            title="مفيش عناوين محفوظة"
            hint="العميل ده لسه ماحفظش عنوان. العناوين بتتحفظ من حسابه على المتجر."
          />
        ) : (
          <CardGrid>
            {addresses.map((address) => (
              <div className="adm-card" key={address.id}>
                <span className="adm-card-title">
                  {address.label ?? "عنوان محفوظ"}
                  {address.isDefault ? (
                    <Pill tone="accent">العنوان الافتراضي</Pill>
                  ) : null}
                </span>
                <p className="adm-card-text">{addressText(address)}</p>
                <span className="adm-cell-sub">
                  تليفون العنوان: <bdi>{address.phone}</bdi>
                </span>
              </div>
            ))}
          </CardGrid>
        )}
      </Panel>

      <Panel
        title="طلبات العميل"
        sub={
          !canSeeOrders
            ? "الطلبات محجوبة عن هذا الحساب"
            : orderCount
              ? `${orderCount} طلب مسجل للعميل ده`
              : "العميل ده لسه مالهوش طلبات"
        }
        flush
      >
        {!canSeeOrders ? (
          <div className="adm-panel-body">
            <EmptyState
              title="الطلبات مش معروضة هنا"
              hint="عرض طلبات العميل محتاج صلاحية «عرض الطلبات». الحساب ده يقدر يشوف بيانات العميل بس من غير الطلبات."
            />
          </div>
        ) : orders === null ? (
          <ErrorState
            title="مفيش تحميل للطلبات"
            hint="حصلت مشكلة في جلب طلبات العميل. جرّب تعمل تحديث للصفحة."
          />
        ) : (
          <>
            <DataTable
              caption="طلبات العميل، الأحدث أولًا"
              columns={[
                { header: "رقم الطلب" },
                { header: "التاريخ" },
                { header: "الحالة" },
                { header: "الإجمالي", numeric: true },
              ]}
              rows={orders.map((order) => [
                <Link key="number" href={`/admin/orders/${order.id}`} className="adm-cell-title">
                  {order.orderNumber}
                </Link>,
                formatDate(order.createdAt),
                <Pill key="status" tone={ORDER_TONE[order.status] ?? "neutral"}>
                  {orderStatusLabel(order.status)}
                </Pill>,
                formatMoney((order.totalFinal ?? order.totalEstimated).toString()),
              ])}
              emptyLabel="العميل ده لسه مالهوش طلبات."
            />
            <Pager
              basePath={`/admin/customers/${customer.id}`}
              params={{}}
              nextCursor={nextCursor}
              label="طلب"
            />
          </>
        )}
      </Panel>

      <Panel title="تعديل بيانات العميل" sub="الاسم والبريد وحالة الحساب — التليفون ما بيتغيرش">
        <PermissionGate
          permissions={admin.permissions}
          required="customers.manage"
          action="تعديل بيانات العميل"
        >
          <CustomerEditForm
            customerId={customer.id}
            firstName={customer.firstName}
            lastName={customer.lastName}
            email={customer.email}
            autoAcceptReplacements={customer.autoAcceptReplacements}
            isActive={customer.isActive}
          />
        </PermissionGate>
      </Panel>

      {!customer.isRegistered ? (
        <Panel title="تسجيل العميل" sub="تسجيل العميل بيديّه حساب يدخل منه على المتجر">
          <PermissionGate
            permissions={admin.permissions}
            required="customers.manage"
            action="تسجيل العميل"
          >
            <CustomerRegisterForm customerId={customer.id} />
          </PermissionGate>
        </Panel>
      ) : null}

      <Panel
        title="إخفاء هوية العميل"
        sub="المسار المعتمد لإخفاء الهوية: تشيل البيانات الشخصية وتسيب الطلبات والمالية زي ما هي"
      >
        <PermissionGate
          permissions={admin.permissions}
          required="customers.anonymize"
          action="إخفاء هوية العميل"
        >
          <CustomerAnonymizePanel
            customerId={customer.id}
            customerName={name}
            expectedUpdatedAt={customer.updatedAt.toISOString()}
            orderCount={canSeeOrders ? orderCount : null}
            initialOutcome={initialAnonymizeStatus?.result ?? null}
          />
        </PermissionGate>
      </Panel>
    </>
  );
}
