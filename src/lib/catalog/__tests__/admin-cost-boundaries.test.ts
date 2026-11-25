// @vitest-environment node
// Real HTTP handlers and serializers; auth, domain services and DB are isolated.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductVariant } from "@prisma/client";
import type { AdminContext } from "@/lib/auth/rbac";
import type { AuditRow } from "@/lib/admin/serialize";

const mocks = vi.hoisted(() => ({
  adminOrDeny: vi.fn(),
  adminOrDenyAll: vi.fn(),
  denyUnless: vi.fn(),
  checkPermission: vi.fn(),
  getProduct: vi.fn(),
  listVariantsByProduct: vi.fn(),
  getVariant: vi.fn(),
  createVariant: vi.fn(),
  patchVariant: vi.fn(),
  updateVariantPrice: vi.fn(),
  patchProduct: vi.fn(),
  listAudit: vi.fn(),
  getAudit: vi.fn(),
  dbAccess: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/route-auth", () => ({
  adminOrDeny: mocks.adminOrDeny,
  adminOrDenyAll: mocks.adminOrDenyAll,
  denyUnless: mocks.denyUnless,
}));
vi.mock("@/lib/auth/rbac", () => ({ checkPermission: mocks.checkPermission }));
vi.mock("@/lib/catalog/queries", () => ({
  getProduct: mocks.getProduct,
  listVariantsByProduct: mocks.listVariantsByProduct,
  getVariant: mocks.getVariant,
}));
vi.mock("@/lib/catalog/writes", () => ({
  createVariant: mocks.createVariant,
  patchVariant: mocks.patchVariant,
  updateVariantPrice: mocks.updateVariantPrice,
  patchProduct: mocks.patchProduct,
}));
vi.mock("@/lib/admin/queries", () => ({
  listAudit: mocks.listAudit,
  getAudit: mocks.getAudit,
}));
vi.mock("@/lib/db", () => ({
  // Fail closed if a handler ever bypasses the mocked domain services.
  prisma: new Proxy({}, {
    get(_target, key) {
      mocks.dbAccess(key);
      throw new Error("Direct DB access is forbidden in this isolated suite.");
    },
  }),
}));

import {
  GET as variantsGET,
  POST as variantsPOST,
} from "@/app/api/admin/catalog/products/[id]/variants/route";
import {
  GET as variantGET,
  PATCH as variantPATCH,
} from "@/app/api/admin/catalog/variants/[id]/route";
import { PATCH as pricePATCH } from "@/app/api/admin/catalog/variants/[id]/price/route";
import { PATCH as productPATCH } from "@/app/api/admin/catalog/products/[id]/route";
import { GET as auditListGET } from "@/app/api/admin/audit-logs/route";
import { GET as auditDetailGET } from "@/app/api/admin/audit-logs/[id]/route";
import { toAdminVariant, toProductListItem } from "@/lib/catalog/serialize";
import { toAudit } from "@/lib/admin/serialize";

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const VARIANT_ID = "22222222-2222-4222-8222-222222222222";
const ADMIN_ID = "33333333-3333-4333-8333-333333333333";
const AUDIT_ID = "44444444-4444-4444-8444-444444444444";
const DATE = new Date("2026-11-01T12:00:00.000Z");
const productContext = { params: Promise.resolve({ id: PRODUCT_ID }) };
const variantContext = { params: Promise.resolve({ id: VARIANT_ID }) };
const auditContext = { params: Promise.resolve({ id: AUDIT_ID }) };
const variantInput = { name: "Pack", price: "15" };
const moneyKeys = ["price", "compareAtPrice", "costPrice"] as const;
let authenticated = true;
let permissions: string[] = [];

function variantRow(overrides: Record<string, unknown> = {}): ProductVariant {
  // Strings stand in for Decimal.toString() without constructing a DB client.
  return {
    id: VARIANT_ID,
    productId: PRODUCT_ID,
    name: "Pack",
    sizeValue: "1",
    sizeUnit: "PIECE",
    price: "15",
    compareAtPrice: "19.5",
    costPrice: "9.99",
    isActive: true,
    createdAt: DATE,
    updatedAt: DATE,
    deletedAt: null,
    ...overrides,
  } as unknown as ProductVariant;
}

function productRow() {
  return {
    id: PRODUCT_ID,
    name: "Product",
    slug: "product",
    description: "Description",
    productType: "PIECE",
    unit: "PIECE",
    saleStepGrams: null,
    isActive: true,
    category: { id: PRODUCT_ID, name: "Category", slug: "category" },
    brand: null,
    createdAt: DATE,
    updatedAt: DATE,
    deletedAt: null,
    // Deliberately over-rich read: product response must still use its DTO.
    costPrice: "9.99",
    cost_price: "9.99",
    variants: [variantRow()],
  } as unknown as Parameters<typeof toProductListItem>[0];
}

function auditRow(): AuditRow {
  return {
    id: AUDIT_ID,
    user_id: ADMIN_ID,
    actor_type: "ADMIN",
    action: "variants.update",
    entity_type: "product_variants",
    entity_id: VARIANT_ID,
    old_values: {
      costPrice: "8.50",
      cost_price: "8.50",
      CoStPrIcE: "8.50",
      COST_PRICE: null,
      COSTPRICE: "8.50",
      "cost-price": "8.50",
      price: "15",
      compareAtPrice: null,
      sellingprice: "15",
      costPriceNote: "Keep this unrelated key",
      history: [{
        costPrice: "9.99",
        cost_price: null,
        sellingprice: "15",
        children: [
          { Cost_Price: "7.25", compareAtPrice: null },
          null,
          "primitive",
          42,
          false,
          [{ cOsTpRiCe: "6", label: "nested" }],
        ],
      }],
      note: "costPrice is a key name, not a value to rewrite",
    },
    new_values: [
      {
        cost_price: null,
        CoStPrIcE: "10",
        price: "16.25",
        meta: { costPrice: "10", cost_price: "10", sellingprice: "16.25" },
      },
      "cost_price",
      null,
      [[{ COST_PRICE: null, compareAtPrice: "19.5", keep: true }]],
    ],
    ip_address: null,
    user_agent: null,
    created_at: DATE,
  };
}

const redactedOldValues = {
  price: "15",
  compareAtPrice: null,
  sellingprice: "15",
  costPriceNote: "Keep this unrelated key",
  history: [{
    sellingprice: "15",
    children: [
      { compareAtPrice: null },
      null,
      "primitive",
      42,
      false,
      [{ label: "nested" }],
    ],
  }],
  note: "costPrice is a key name, not a value to rewrite",
};
const redactedNewValues = [
  { price: "16.25", meta: { sellingprice: "16.25" } },
  "cost_price",
  null,
  [[{ compareAtPrice: "19.5", keep: true }]],
];

function request(path: string, method = "GET", body?: unknown): Request {
  return new Request(`https://example.test/api/admin/${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      // Claimed client permissions must never replace the trusted gate context.
      "x-admin-permissions": "prices.view,prices.update",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function admin(): AdminContext {
  return {
    user: { id: ADMIN_ID, name: "Staff", email: "staff@example.test" },
    roles: ["STAFF"],
    permissions: [...permissions],
  };
}

function authorize(required: readonly string[]) {
  if (!authenticated) return { ok: false as const, code: "UNAUTHENTICATED" as const };
  if (!required.every((key) => permissions.includes(key))) {
    return { ok: false as const, code: "FORBIDDEN" as const };
  }
  return { ok: true as const, admin: admin() };
}

function guard(required: readonly string[]) {
  const auth = authorize(required);
  if (auth.ok) return { admin: auth.admin };
  return {
    denied: Response.json({
      error: {
        code: auth.code,
        message: auth.code === "UNAUTHENTICATED" ? "Authentication required." : "Forbidden.",
        details: null,
      },
    }, { status: auth.code === "UNAUTHENTICATED" ? 401 : 403 }),
  };
}

function expectNoMoney(value: unknown) {
  for (const key of moneyKeys) expect(value).not.toHaveProperty(key);
}

function expectMoney(value: unknown, row: ProductVariant) {
  expect(value).toMatchObject({
    price: row.price.toString(),
    compareAtPrice: row.compareAtPrice?.toString() ?? null,
    costPrice: row.costPrice?.toString() ?? null,
  });
  for (const key of moneyKeys) expect(value).toHaveProperty(key);
}

const domainMocks = [
  mocks.getProduct,
  mocks.listVariantsByProduct,
  mocks.getVariant,
  mocks.createVariant,
  mocks.patchVariant,
  mocks.updateVariantPrice,
  mocks.patchProduct,
  mocks.listAudit,
  mocks.getAudit,
];

function expectNoDomainAccess() {
  for (const mock of domainMocks) expect(mock).not.toHaveBeenCalled();
  expect(mocks.dbAccess).not.toHaveBeenCalled();
}

type Endpoint = {
  name: string;
  invoke: () => Promise<Response>;
  gate: "single" | "all" | "permission";
  required: string[];
};

const endpoints: Endpoint[] = [
  {
    name: "product variants GET",
    invoke: () => variantsGET(request(`catalog/products/${PRODUCT_ID}/variants`), productContext),
    gate: "single",
    required: ["products.view"],
  },
  {
    name: "product variants POST",
    invoke: () => variantsPOST(request(`catalog/products/${PRODUCT_ID}/variants`, "POST", variantInput), productContext),
    gate: "single",
    required: ["products.create"],
  },
  {
    name: "single variant GET",
    invoke: () => variantGET(request(`catalog/variants/${VARIANT_ID}`), variantContext),
    gate: "all",
    required: ["products.view", "prices.view"],
  },
  {
    name: "single variant PATCH",
    invoke: () => variantPATCH(request(`catalog/variants/${VARIANT_ID}`, "PATCH", { name: "Renamed" }), variantContext),
    gate: "all",
    required: ["products.update"],
  },
  {
    name: "variant price PATCH",
    invoke: () => pricePATCH(request(`catalog/variants/${VARIANT_ID}/price`, "PATCH", { price: "16.25" }), variantContext),
    gate: "permission",
    required: ["prices.update"],
  },
  {
    name: "product detail PATCH",
    invoke: () => productPATCH(request(`catalog/products/${PRODUCT_ID}`, "PATCH", { name: "Renamed" }), productContext),
    gate: "single",
    required: ["products.update"],
  },
  {
    name: "audit list GET",
    invoke: () => auditListGET(request("audit-logs?limit=2")),
    gate: "single",
    required: ["audit_logs.view"],
  },
  {
    name: "audit detail GET",
    invoke: () => auditDetailGET(request(`audit-logs/${AUDIT_ID}`), auditContext),
    gate: "single",
    required: ["audit_logs.view"],
  },
];

function expectGate(endpoint: Endpoint) {
  const expected = endpoint.gate === "all" ? mocks.adminOrDenyAll
    : endpoint.gate === "permission" ? mocks.checkPermission : mocks.adminOrDeny;
  expect(expected).toHaveBeenCalledTimes(1);
  expect(expected).toHaveBeenCalledWith(endpoint.gate === "all" ? endpoint.required : endpoint.required[0]);
  for (const mock of [mocks.adminOrDeny, mocks.adminOrDenyAll, mocks.checkPermission]) {
    if (mock !== expected) expect(mock).not.toHaveBeenCalled();
  }
  expect(mocks.denyUnless).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
  authenticated = true;
  permissions = [];
  mocks.adminOrDeny.mockImplementation(async (key: string) => guard([key]));
  mocks.adminOrDenyAll.mockImplementation(async (keys: string[]) => guard(keys));
  mocks.denyUnless.mockImplementation(async (key: string) => {
    const result = guard([key]);
    return "denied" in result ? result.denied : null;
  });
  mocks.checkPermission.mockImplementation(async (key: string) => authorize([key]));
  mocks.getProduct.mockResolvedValue(productRow());
  mocks.listVariantsByProduct.mockResolvedValue({ rows: [variantRow()], nextCursor: null });
  mocks.getVariant.mockResolvedValue(variantRow());
  mocks.createVariant.mockResolvedValue(variantRow());
  mocks.patchVariant.mockResolvedValue(variantRow({ name: "Renamed" }));
  mocks.updateVariantPrice.mockResolvedValue(variantRow({ price: "16.25" }));
  mocks.patchProduct.mockResolvedValue(productRow());
  mocks.listAudit.mockResolvedValue([auditRow()]);
  mocks.getAudit.mockResolvedValue(auditRow());
});

afterEach(() => {
  expect(mocks.dbAccess).not.toHaveBeenCalled();
});

describe("all catalog and audit handlers deny before reads or writes", () => {
  for (const endpoint of endpoints) {
    it(`${endpoint.name}: 401 even if the anonymous caller claims every permission`, async () => {
      authenticated = false;
      permissions = [...endpoint.required, "prices.view", "prices.update"];
      const response = await endpoint.invoke();
      expect(response.status).toBe(401);
      expect((await response.json()).error).toMatchObject({ code: "UNAUTHENTICATED" });
      expectGate(endpoint);
      expectNoDomainAccess();
    });

    it(`${endpoint.name}: 403 without its required permission`, async () => {
      const response = await endpoint.invoke();
      expect(response.status).toBe(403);
      expect((await response.json()).error).toMatchObject({ code: "FORBIDDEN" });
      expectGate(endpoint);
      expectNoDomainAccess();
    });
  }
});

describe("product variants GET projects trusted prices.view", () => {
  it.each([false, true])("reader permission = %s", async (canRead) => {
    permissions = ["products.view", ...(canRead ? ["prices.view"] : ["prices.update"])];
    const row = variantRow();
    const snapshot = structuredClone(row);
    mocks.listVariantsByProduct.mockResolvedValue({ rows: [row], nextCursor: null });
    const response = await variantsGET(
      request(`catalog/products/${PRODUCT_ID}/variants?limit=2&permissions=prices.view`), productContext,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ id: VARIANT_ID, name: "Pack", sizeValue: "1" });
    if (canRead) expectMoney(body.data[0], row);
    else expectNoMoney(body.data[0]);
    expect(body.meta).toMatchObject({ limit: 2, nextCursor: null });
    expectGate(endpoints[0]);
    expect(mocks.getProduct).toHaveBeenCalledWith(PRODUCT_ID, true);
    expect(mocks.listVariantsByProduct).toHaveBeenCalledWith(PRODUCT_ID, true, 2, null);
    expect(row).toStrictEqual(snapshot);
  });
});

describe("product variants POST separates create, price write and price read", () => {
  it.each([false, true])("creation without a cost field needs only products.create; reader = %s", async (canRead) => {
    permissions = ["products.create", ...(canRead ? ["prices.view"] : [])];
    const row = variantRow();
    mocks.createVariant.mockResolvedValue(row);
    const response = await variantsPOST(
      request(`catalog/products/${PRODUCT_ID}/variants`, "POST", variantInput), productContext,
    );
    expect(response.status).toBe(201);
    const { data } = await response.json();
    if (canRead) expectMoney(data, row);
    else expectNoMoney(data);
    expectGate(endpoints[1]);
    expect(mocks.createVariant).toHaveBeenCalledTimes(1);
    expect(mocks.createVariant).toHaveBeenCalledWith({ ...variantInput, productId: PRODUCT_ID }, ADMIN_ID);
    expect(mocks.createVariant.mock.calls[0][0]).not.toHaveProperty("costPrice");
    expect(mocks.getProduct).not.toHaveBeenCalled();
  });

  for (const costPrice of [null, "9.99"]) {
    it.each([false, true])(`refuses explicit cost ${costPrice} before writing; prices.view = %s`, async (canRead) => {
      permissions = ["products.create", ...(canRead ? ["prices.view"] : [])];
      const response = await variantsPOST(
        request(`catalog/products/${PRODUCT_ID}/variants`, "POST", { ...variantInput, costPrice }), productContext,
      );
      expect(response.status).toBe(403);
      expect((await response.json()).error).toMatchObject({ code: "FORBIDDEN" });
      expectGate(endpoints[1]);
      expectNoDomainAccess();
    });

    it.each([false, true])(`allows explicit cost ${costPrice} with prices.update; reader = %s`, async (canRead) => {
      permissions = ["products.create", "prices.update", ...(canRead ? ["prices.view"] : [])];
      const row = variantRow({ costPrice });
      mocks.createVariant.mockResolvedValue(row);
      const response = await variantsPOST(
        request(`catalog/products/${PRODUCT_ID}/variants`, "POST", { ...variantInput, costPrice }), productContext,
      );
      expect(response.status).toBe(201);
      const { data } = await response.json();
      if (canRead) expectMoney(data, row);
      else expectNoMoney(data);
      expectGate(endpoints[1]);
      expect(mocks.createVariant).toHaveBeenCalledWith({ ...variantInput, costPrice, productId: PRODUCT_ID }, ADMIN_ID);
    });
  }
});

describe("single variant GET requires both read capabilities", () => {
  it.each(["products.view", "prices.view"])("refuses a caller with only %s", async (key) => {
    permissions = [key];
    const response = await endpoints[2].invoke();
    expect(response.status).toBe(403);
    expectGate(endpoints[2]);
    expectNoDomainAccess();
  });

  it.each([null, "9.99"])("both permissions expose stored cost %s, including explicit null", async (costPrice) => {
    permissions = ["products.view", "prices.view"];
    const row = variantRow({ costPrice });
    mocks.getVariant.mockResolvedValue(row);
    const response = await endpoints[2].invoke();
    expect(response.status).toBe(200);
    expectMoney((await response.json()).data, row);
    expectGate(endpoints[2]);
    expect(mocks.getVariant).toHaveBeenCalledTimes(1);
    expect(mocks.getVariant).toHaveBeenCalledWith(VARIANT_ID, true);
  });
});

describe("single variant PATCH cannot leak stored cost or bypass field permissions", () => {
  it.each([false, true])("descriptive update needs no prices.update; reader = %s", async (canRead) => {
    permissions = ["products.update", ...(canRead ? ["prices.view"] : [])];
    const row = variantRow({ name: "Renamed" });
    mocks.patchVariant.mockResolvedValue(row);
    const response = await endpoints[3].invoke();
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.name).toBe("Renamed");
    if (canRead) expectMoney(data, row);
    else expectNoMoney(data);
    expectGate(endpoints[3]);
    expect(mocks.patchVariant).toHaveBeenCalledWith(VARIANT_ID, { name: "Renamed" }, ADMIN_ID);
    expect(mocks.patchVariant.mock.calls[0][1]).not.toHaveProperty("costPrice");
    expect(mocks.getVariant).not.toHaveBeenCalled();
  });

  for (const field of ["compareAtPrice", "costPrice"] as const) {
    for (const value of [null, field === "costPrice" ? "9.99" : "19.5"]) {
      it.each(["products.update", "prices.update"])(`${field}=${value} refuses a caller with only %s (read is not write)`, async (key) => {
        permissions = [key, "prices.view"];
        const response = await variantPATCH(
          request(`catalog/variants/${VARIANT_ID}`, "PATCH", { [field]: value }), variantContext,
        );
        expect(response.status).toBe(403);
        expect((await response.json()).error).toMatchObject({ code: "FORBIDDEN" });
        expectGate({ ...endpoints[3], required: ["products.update", "prices.update"] });
        expectNoDomainAccess();
      });

      it.each([false, true])(`${field}=${value} permits both writers but projects the response; reader = %s`, async (canRead) => {
        permissions = ["products.update", "prices.update", ...(canRead ? ["prices.view"] : [])];
        const row = variantRow({ [field]: value });
        mocks.patchVariant.mockResolvedValue(row);
        const response = await variantPATCH(
          request(`catalog/variants/${VARIANT_ID}`, "PATCH", { [field]: value }), variantContext,
        );
        expect(response.status).toBe(200);
        const { data } = await response.json();
        if (canRead) expectMoney(data, row);
        else expectNoMoney(data);
        expectGate({ ...endpoints[3], required: ["products.update", "prices.update"] });
        expect(mocks.patchVariant).toHaveBeenCalledTimes(1);
        expect(mocks.patchVariant).toHaveBeenCalledWith(VARIANT_ID, { [field]: value }, ADMIN_ID);
      });
    }
  }
});

describe("price PATCH does not imply price read, even on a no-op", () => {
  for (const noOp of [false, true]) {
    it.each([false, true])(`no-op = ${noOp}; reader = %s; always re-fetches the full row and projects`, async (canRead) => {
      permissions = ["prices.update", ...(canRead ? ["prices.view"] : [])];
      const price = noOp ? "15.000" : "16.25";
      const reason = noOp ? null : "Routine adjustment";
      const full = variantRow({ name: "Full re-fetched variant", price: noOp ? "15" : "16.25" });
      // The real no-op service may return only its price/compare-at SELECT.
      mocks.updateVariantPrice.mockResolvedValue(noOp
        ? { price: "15", compareAtPrice: "19.5" }
        : variantRow({ name: "Stale write result", price: "16.25", costPrice: "8.50" }));
      mocks.getVariant.mockResolvedValue(full);
      const response = await pricePATCH(
        request(`catalog/variants/${VARIANT_ID}/price`, "PATCH", { price, reason }), variantContext,
      );
      expect(response.status).toBe(200);
      const { data } = await response.json();
      expect(data).toMatchObject({ id: VARIANT_ID, name: "Full re-fetched variant", productId: PRODUCT_ID });
      if (canRead) expectMoney(data, full);
      else expectNoMoney(data);
      expectGate(endpoints[4]);
      expect(mocks.updateVariantPrice).toHaveBeenCalledTimes(1);
      expect(mocks.updateVariantPrice).toHaveBeenCalledWith(VARIANT_ID, price, reason, ADMIN_ID, ADMIN_ID);
      expect(mocks.getVariant).toHaveBeenCalledTimes(1);
      expect(mocks.getVariant).toHaveBeenCalledWith(VARIANT_ID, true);
      expect(mocks.getVariant.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.updateVariantPrice.mock.invocationCallOrder[0]);
    });
  }

  it("prices.view plus products.update is not permission to write selling prices", async () => {
    permissions = ["prices.view", "products.update"];
    const response = await endpoints[4].invoke();
    expect(response.status).toBe(403);
    expectGate(endpoints[4]);
    expectNoDomainAccess();
  });

  it("authorized price reader preserves a null cost from the full re-fetch", async () => {
    permissions = ["prices.update", "prices.view"];
    const full = variantRow({ price: "16.25", costPrice: null });
    mocks.getVariant.mockResolvedValue(full);
    const response = await endpoints[4].invoke();
    expect(response.status).toBe(200);
    expectMoney((await response.json()).data, full);
    expectGate(endpoints[4]);
  });
});

describe("product detail PATCH keeps an over-rich re-fetched row out of the response", () => {
  it("a product-only writer receives no stored cost or embedded variants", async () => {
    permissions = ["products.update"];
    const row = productRow();
    const snapshot = structuredClone(row);
    mocks.getProduct.mockResolvedValue(row);
    const response = await endpoints[5].invoke();
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data).toMatchObject({ id: PRODUCT_ID, slug: "product" });
    expectNoMoney(data);
    expect(data).not.toHaveProperty("cost_price");
    expect(data).not.toHaveProperty("variants");
    expectGate(endpoints[5]);
    expect(mocks.patchProduct).toHaveBeenCalledWith(PRODUCT_ID, expect.objectContaining({ name: "Renamed" }), ADMIN_ID);
    expect(mocks.getProduct).toHaveBeenCalledWith(PRODUCT_ID, true);
    expect(row).toStrictEqual(snapshot);
  });
});

describe("audit GET handlers project history without changing stored JSON", () => {
  for (const endpoint of endpoints.slice(6)) {
    it.each([false, true])(`${endpoint.name}: prices.view = %s; selling price stays visible`, async (canRead) => {
      permissions = ["audit_logs.view", ...(canRead ? ["prices.view"] : ["prices.update"])];
      const row = auditRow();
      const snapshot = structuredClone(row);
      mocks.listAudit.mockResolvedValue([row]);
      mocks.getAudit.mockResolvedValue(row);
      const response = await endpoint.invoke();
      expect(response.status).toBe(200);
      const body = await response.json();
      const data = endpoint.name === "audit list GET" ? body.data[0] : body.data;
      expect(data).toMatchObject({ id: AUDIT_ID, action: "variants.update", createdAt: DATE.toISOString() });
      expect(data.oldValues).toStrictEqual(canRead ? row.old_values : redactedOldValues);
      expect(data.newValues).toStrictEqual(canRead ? row.new_values : redactedNewValues);
      expectGate(endpoint);
      if (endpoint.name === "audit list GET") {
        expect(body.data).toHaveLength(1);
        expect(body.meta).toMatchObject({ limit: 2, nextCursor: null });
        expect(mocks.listAudit).toHaveBeenCalledWith({
          limit: 2, cursor: null, userId: null, action: null, entityType: null,
          entityId: null, since: null, until: null, outcome: null, sensitiveOnly: false,
        });
        expect(mocks.getAudit).not.toHaveBeenCalled();
      } else {
        expect(mocks.getAudit).toHaveBeenCalledWith(AUDIT_ID);
        expect(mocks.listAudit).not.toHaveBeenCalled();
      }
      expect(row).toStrictEqual(snapshot);
    });

    it(`${endpoint.name}: prices.view alone cannot read audit history`, async () => {
      permissions = ["prices.view", "prices.update"];
      const response = await endpoint.invoke();
      expect(response.status).toBe(403);
      expectGate(endpoint);
      expectNoDomainAccess();
    });
  }
});

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

describe("serializer-level permission and immutable history regressions", () => {
  it.each([
    { grants: [] },
    { grants: ["products.view"] },
    { grants: ["prices.update"] },
    { grants: ["PRICES.VIEW", "prices.view.extra"] },
  ])("admin variant omits all money keys, rather than returning null, for $grants", ({ grants }) => {
    const row = variantRow();
    const snapshot = structuredClone(row);
    const output = toAdminVariant(row, grants);
    expectNoMoney(output);
    expect(output).toMatchObject({ id: VARIANT_ID, name: "Pack", sizeValue: "1", sizeUnit: "PIECE" });
    expect(row).toStrictEqual(snapshot);
  });

  it.each([null, "9.99"])("prices.view exposes exact strings and legitimate null cost %s", (costPrice) => {
    const row = variantRow({ costPrice, compareAtPrice: null });
    const grants: readonly string[] = Object.freeze(["prices.view"]);
    expectMoney(toAdminVariant(row, grants), row);
  });

  it.each([
    { grants: [] },
    { grants: ["audit_logs.view", "prices.update"] },
    { grants: ["PRICES.VIEW", "prices.view.extra"] },
  ])("audit recursively removes camel/snake/case-variant cost keys for $grants without mutating frozen input", ({ grants }) => {
    const row = auditRow();
    const snapshot = structuredClone(row);
    deepFreeze(row);
    const output = toAudit(row, grants);
    expect(output.oldValues).toStrictEqual(redactedOldValues);
    expect(output.newValues).toStrictEqual(redactedNewValues);
    expect(row).toStrictEqual(snapshot);
    // A later authorized projection must still see the original DB history.
    const authorized = toAudit(row, ["prices.view"]);
    expect(authorized.oldValues).toStrictEqual(snapshot.old_values);
    expect(authorized.newValues).toStrictEqual(snapshot.new_values);
  });

  it("authorized audit projection preserves all cost spellings and nulls without input mutation", () => {
    const row = auditRow();
    const snapshot = structuredClone(row);
    deepFreeze(row);
    const output = toAudit(row, Object.freeze(["audit_logs.view", "prices.view"]));
    expect(output.oldValues).toStrictEqual(snapshot.old_values);
    expect(output.newValues).toStrictEqual(snapshot.new_values);
    expect(row).toStrictEqual(snapshot);
  });

  it.each([false, true])("audit null old/new histories remain null; reader = %s", (canRead) => {
    const row = { ...auditRow(), old_values: null, new_values: null };
    const output = toAudit(row, canRead ? ["prices.view"] : []);
    expect(output.oldValues).toBeNull();
    expect(output.newValues).toBeNull();
  });
});
