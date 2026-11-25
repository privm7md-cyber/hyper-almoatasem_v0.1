// Phase 12 / P12-08 D01 — Hardened H2 Privacy & Audit Immutability Acceptance Suite
//
// Exercises ALL 15 Mandatory Workstream B Acceptance Scenarios end-to-end against:
//   - Real Next.js Production Server (`PHASE07_BASE_URL`, `CUSTOMER_AUDIT_REDACTION_MODE=H2`, zero worker creds)
//   - Real Prisma 7.10 (`@prisma/adapter-pg`) restricted runtime role (`h2_app`)
//   - Real Independent PostgreSQL 18.4 Cluster (isolated `PGDATA`, distinct `system_identifier`, 32 triggers)
//   - Real Dedicated Privacy Worker CLI & Daemon (`scripts/privacy-redaction-worker.mjs` as `h2_privacy_worker`)
//   - Real Desktop Chrome (`@playwright/test`) Admin UI across all 4 lifecycle states

import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { Pool } from "pg";

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

const REPO_ROOT = path.resolve(__dirname, "..");
const RUN_DIR = process.env.H2_E2E_RUN_DIR ?? "";
if (!RUN_DIR.trim()) {
  throw new Error("H2_E2E_MISSING_RUN_DIR: Set H2_E2E_RUN_DIR pointing to an isolated evidence directory.");
}

const SHOTS_DIR = path.join(RUN_DIR, "screenshots");
const EVIDENCE_DIR = path.join(RUN_DIR, "evidence");
const LOGS_DIR = path.join(RUN_DIR, "logs");
const WORKER_SCRIPT = path.join(REPO_ROOT, "scripts", "privacy-redaction-worker.mjs");
const WORKER_LOG = path.join(LOGS_DIR, "privacy-worker-e2e.log");

for (const d of [SHOTS_DIR, EVIDENCE_DIR, LOGS_DIR]) {
  fs.mkdirSync(d, { recursive: true });
}

const BASE = process.env.PHASE07_BASE_URL ?? "";
if (!BASE.trim()) {
  throw new Error("H2_E2E_MISSING_BASE_URL: Set PHASE07_BASE_URL pointing to isolated loopback server.");
}
const PARSED_BASE = new URL(BASE);
if (PARSED_BASE.hostname !== "127.0.0.1" && PARSED_BASE.hostname !== "localhost") {
  throw new Error(`H2_E2E_ABORT: Non-loopback host ${BASE}`);
}
if (PARSED_BASE.port === "3150" || PARSED_BASE.port === "3151") {
  throw new Error(`H2_E2E_ABORT: Forbidden shared port ${PARSED_BASE.port}`);
}

interface H2ClusterCreds {
  port: number;
  database: string;
  roles: {
    dba: { user: string; password: string };
    migrator: { user: string; password: string };
    app: { user: string; password: string };
    worker: { user: string; password: string };
  };
  syntheticAdminOwner: { email: string; password: string };
  rateLimitHmacSecret: string;
}

const credsPath =
  process.env.H2_CREDS_FILE ?? path.join(RUN_DIR, ".ephemeral-secrets", "cluster-creds.json");
const creds = JSON.parse(fs.readFileSync(credsPath, "utf8")) as H2ClusterCreds;

function roleUrl(roleKey: "dba" | "migrator" | "app" | "worker"): string {
  const r = creds.roles[roleKey];
  return `postgresql://${encodeURIComponent(r.user)}:${encodeURIComponent(r.password)}@127.0.0.1:${creds.port}/${creds.database}`;
}

const APP_DB_URL = roleUrl("app");
const WORKER_DB_URL = roleUrl("worker");
const MIG_DB_URL = roleUrl("migrator");
const DBA_DB_URL = roleUrl("dba");

let appPool: Pool;
let migPool: Pool;
let workerPool: Pool;
let dbaPool: Pool;

let superAdminCookie = "";
let storeAdminCookie = "";
let storeAdminEmail = "";
const STORE_ADMIN_PW = "H2StoreAdmin-Pass!9Aa";
let viewerAdminCookie = "";
let storeAdminUserId = "";
let viewerRoleId = "";
let viewerUserId = "";
let variantIdForOrder = "";

const RUN_STAMP = Date.now().toString(36);
const gateResults: Record<string, unknown> = {};
const trackedPiiTokens = new Set<string>();

let phoneCounter = Math.floor(100000 + Math.random() * 800000);
function nextEgyptPhone(): string {
  phoneCounter += 1;
  return `0109${String(phoneCounter).slice(-7).padStart(7, "0")}`;
}

function extractSetCookie(headers: Headers, prefixes: string[]): string {
  const raw =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : [headers.get("set-cookie") ?? ""];
  for (const line of raw) {
    for (const p of prefixes) {
      if (line.startsWith(`${p}=`)) return line.split(";")[0]!;
    }
  }
  return "";
}

async function apiJson<T = Record<string, unknown>>(
  method: string,
  urlPath: string,
  body?: unknown,
  cookie?: string,
  extraHeaders?: Record<string, string>,
): Promise<{ status: number; data: T; raw: Record<string, unknown>; headers: Headers }> {
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: {
      Origin: BASE,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(extraHeaders ?? {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let parsed: Record<string, unknown> = {};
  try {
    parsed = (await res.json()) as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  return {
    status: res.status,
    data: (parsed.data as T) ?? (null as unknown as T),
    raw: parsed,
    headers: res.headers,
  };
}

function runWorkerCli(
  args: string[],
  extraEnv: Record<string, string> = {},
): { status: number | null; stdout: string; stderr: string } {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PRIVACY_WORKER_DATABASE_URL: WORKER_DB_URL,
    ...extraEnv,
  };
  delete env.DATABASE_URL;
  const r = spawnSync(process.execPath, [WORKER_SCRIPT, ...args], {
    cwd: REPO_ROOT,
    env,
    encoding: "utf8",
    timeout: 20_000,
  });
  const combined = [r.stdout ?? "", r.stderr ?? ""].filter(Boolean).join("\n");
  if (combined.trim()) {
    fs.appendFileSync(WORKER_LOG, combined.trim() + "\n", "utf8");
  }
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

async function resetRateLimits() {
  await appPool.query("DELETE FROM admin_auth_rate_limits");
  await appPool.query("DELETE FROM customer_auth_rate_limits");
  await appPool.query("DELETE FROM guest_order_rate_limits");
}

async function createCustomerWithDeliveredOrder(rawTag: string) {
  const tag = `${rawTag}_${RUN_STAMP}`;
  await resetRateLimits();
  const localPhone = nextEgyptPhone();
  const canonicalPhone = `2${localPhone}`;
  const firstName = `محمود_${tag}`;
  const lastName = `الشناوي_${tag}`;
  const email = `cust.${tag.toLowerCase()}.${Date.now()}@synthetic-h2.invalid`;
  const street = `شارع البحر الأعظم رقم ${tag}`;
  const landmark = `بجوار صيدلية الشفاء ${tag}`;
  const notes = `ملاحظة خاصة للعميل ${firstName} تليفون ${localPhone}`;

  for (const tok of [firstName, lastName, localPhone, canonicalPhone, email, street, landmark, notes]) {
    trackedPiiTokens.add(tok);
  }

  const reg = await apiJson<{ customer: { id: string } }>("POST", "/api/store/customers/register", {
    phone: localPhone,
    firstName,
    lastName,
    password: "CustSafe-H2-Password!9",
  });
  expect(reg.status).toBe(201);
  const customerCookie = extractSetCookie(reg.headers, [
    "__Host-customer-session",
    "hyper-customer-session-dev",
  ]);
  expect(customerCookie).not.toBe("");
  const customerId = reg.data.customer.id;

  await appPool.query(`UPDATE customers SET email = $1 WHERE id = $2::uuid`, [email, customerId]);

  const addrRes = await apiJson<{ id: string }>(
    "POST",
    "/api/store/customers/addresses",
    {
      label: "المنزل",
      city: "المنصورة",
      area: "حي الجامعة",
      street,
      buildingNumber: "14B",
      landmark,
      phone: localPhone,
      isDefault: true,
    },
    customerCookie,
  );
  expect(addrRes.status).toBe(201);
  const addressId = addrRes.data.id;

  expect((await apiJson("POST", "/api/store/cart", {}, customerCookie)).status).toBeLessThan(300);
  const cartAdd = await apiJson(
    "POST",
    "/api/store/cart/items",
    { productVariantId: variantIdForOrder, quantity: "2" },
    customerCookie,
  );
  expect([200, 201]).toContain(cartAdd.status);

  const orderRes = await apiJson<{ orderId?: string; order?: { id: string } }>(
    "POST",
    "/api/store/orders",
    {
      addressId,
      expectedDeliveryFee: "15.00",
      idempotencyKey: `h2-ord-${crypto.randomUUID()}`,
    },
    customerCookie,
  );
  expect(orderRes.status).toBe(201);
  const orderId = (orderRes.data.orderId ?? orderRes.data.order?.id)!;

  await appPool.query(`UPDATE orders SET notes = $1 WHERE id = $2::uuid`, [notes, orderId]);

  expect((await apiJson("POST", `/api/admin/orders/${orderId}/prepare`, {}, superAdminCookie)).status).toBe(200);
  const orderItems = (
    await appPool.query<{ id: string }>(`SELECT id::text AS id FROM order_items WHERE order_id = $1::uuid`, [
      orderId,
    ])
  ).rows;
  for (const item of orderItems) {
    expect(
      (
        await apiJson(
          "POST",
          `/api/admin/orders/${orderId}/items/${item.id}/pick`,
          { actualQuantity: "2" },
          superAdminCookie,
        )
      ).status,
    ).toBe(200);
  }
  expect((await apiJson("POST", `/api/admin/orders/${orderId}/ready`, {}, superAdminCookie)).status).toBe(200);
  expect((await apiJson("POST", `/api/admin/orders/${orderId}/dispatch`, {}, superAdminCookie)).status).toBe(200);
  expect((await apiJson("POST", `/api/admin/orders/${orderId}/deliver`, {}, superAdminCookie)).status).toBe(200);

  const custRow = (
    await appPool.query<{ updated_at: Date }>(`SELECT updated_at FROM customers WHERE id = $1::uuid`, [
      customerId,
    ])
  ).rows[0]!;

  return {
    customerId,
    orderId,
    localPhone,
    canonicalPhone,
    firstName,
    lastName,
    email,
    street,
    landmark,
    notes,
    updatedAtIso: custRow.updated_at.toISOString(),
  };
}

test.beforeAll(async () => {
  appPool = new Pool({ connectionString: APP_DB_URL, max: 4 });
  migPool = new Pool({ connectionString: MIG_DB_URL, max: 2 });
  workerPool = new Pool({ connectionString: WORKER_DB_URL, max: 2 });
  dbaPool = new Pool({ connectionString: DBA_DB_URL, max: 2 });

  const idCheck = (
    await dbaPool.query<{ db: string; port: number; sys_id: string }>(`
      SELECT current_database() AS db,
             inet_server_port()::int AS port,
             (pg_control_system()).system_identifier::text AS sys_id
    `)
  ).rows[0]!;
  if (
    idCheck.sys_id === "7687734853145036120" ||
    idCheck.db === "hyper_almoatasem" ||
    Number(idCheck.port) === 5432 ||
    Number(idCheck.port) !== creds.port
  ) {
    throw new Error(`CRITICAL ISOLATION ABORT: ${JSON.stringify(idCheck)}`);
  }

  await resetRateLimits();

  variantIdForOrder = (
    await appPool.query<{ id: string }>(`
      SELECT pv.id::text AS id
        FROM product_variants pv
        JOIN products p ON p.id = pv.product_id
        JOIN inventory i ON i.product_variant_id = pv.id
       WHERE p.product_type = 'PIECE' AND p.is_active = true AND pv.is_active = true AND i.quantity >= 50
       LIMIT 1
    `)
  ).rows[0]!.id;

  const loginRes = await apiJson("POST", "/api/admin/session", {
    email: creds.syntheticAdminOwner.email,
    password: creds.syntheticAdminOwner.password,
  });
  expect(loginRes.status).toBe(201);
  superAdminCookie = extractSetCookie(loginRes.headers, [
    "__Host-admin-session",
    "hyper-admin-session-dev",
  ]);
  expect(superAdminCookie).not.toBe("");

  storeAdminEmail = `h2-store-mgr-${Date.now()}@h2.local`;
  const storeUser = await apiJson<{ id: string }>(
    "POST",
    "/api/admin/users",
    { name: "H2 Store Manager", email: storeAdminEmail },
    superAdminCookie,
  );
  expect(storeUser.status).toBe(201);
  storeAdminUserId = storeUser.data.id;
  expect(
    (
      await apiJson(
        "POST",
        `/api/admin/users/${storeAdminUserId}/password`,
        { password: STORE_ADMIN_PW },
        superAdminCookie,
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await apiJson(
        "POST",
        `/api/admin/users/${storeAdminUserId}/roles`,
        { roleId: "02800000-0000-7000-8000-000000000002" },
        superAdminCookie,
      )
    ).status,
  ).toBe(201);

  const storeLogin2 = await apiJson("POST", "/api/admin/session", {
    email: storeAdminEmail,
    password: STORE_ADMIN_PW,
  });
  expect(storeLogin2.status).toBe(201);
  storeAdminCookie = extractSetCookie(storeLogin2.headers, [
    "__Host-admin-session",
    "hyper-admin-session-dev",
  ]);

  const perms = await apiJson<Array<{ id: string; key: string }>>(
    "GET",
    "/api/admin/permissions?limit=100",
    undefined,
    superAdminCookie,
  );
  const custViewPermId = perms.data.find((p) => p.key === "customers.view")!.id;
  const vRole = await apiJson<{ id: string }>(
    "POST",
    "/api/admin/roles",
    { name: `H2_CUST_VIEWER_${Date.now()}`, description: "Read-only customer viewer" },
    superAdminCookie,
  );
  expect(vRole.status).toBe(201);
  viewerRoleId = vRole.data.id;
  expect(
    (
      await apiJson(
        "POST",
        `/api/admin/roles/${viewerRoleId}/grants`,
        { permissionId: custViewPermId },
        superAdminCookie,
      )
    ).status,
  ).toBe(201);
  const vEmail = `h2-cust-viewer-${Date.now()}@h2.local`;
  const vPw = "H2ViewerAdmin-Pass!9Aa";
  const vUser = await apiJson<{ id: string }>(
    "POST",
    "/api/admin/users",
    { name: "H2 Customer Viewer", email: vEmail },
    superAdminCookie,
  );
  expect(vUser.status).toBe(201);
  viewerUserId = vUser.data.id;
  expect(
    (await apiJson("POST", `/api/admin/users/${viewerUserId}/password`, { password: vPw }, superAdminCookie))
      .status,
  ).toBe(200);
  expect(
    (
      await apiJson(
        "POST",
        `/api/admin/users/${viewerUserId}/roles`,
        { roleId: viewerRoleId },
        superAdminCookie,
      )
    ).status,
  ).toBe(201);
  const vLogin = await apiJson("POST", "/api/admin/session", { email: vEmail, password: vPw });
  expect(vLogin.status).toBe(201);
  viewerAdminCookie = extractSetCookie(vLogin.headers, [
    "__Host-admin-session",
    "hyper-admin-session-dev",
  ]);
});

test.afterAll(async () => {
  if (viewerUserId && viewerRoleId) {
    await apiJson("DELETE", `/api/admin/users/${viewerUserId}/roles/${viewerRoleId}`, undefined, superAdminCookie);
    await apiJson("PATCH", `/api/admin/users/${viewerUserId}`, { isActive: false }, superAdminCookie);
    await apiJson("DELETE", `/api/admin/roles/${viewerRoleId}`, undefined, superAdminCookie);
  }
  if (storeAdminUserId) {
    await apiJson(
      "DELETE",
      `/api/admin/users/${storeAdminUserId}/roles/02800000-0000-7000-8000-000000000002`,
      undefined,
      superAdminCookie,
    );
    await apiJson("PATCH", `/api/admin/users/${storeAdminUserId}`, { isActive: false }, superAdminCookie);
  }

  fs.writeFileSync(
    path.join(EVIDENCE_DIR, "03-d01-h2-15-scenarios-results.json"),
    JSON.stringify({ verifiedAt: new Date().toISOString(), gateResults }, null, 2),
    "utf8",
  );

  await appPool?.end();
  await migPool?.end();
  await workerPool?.end();
  await dbaPool?.end();
});

test("WS-B #1 & #15: Never-edited customer anonymizes synchronously (200 OK) via Admin UI while preserving order/account referential & financial integrity", async ({
  page,
}) => {
  const c1 = await createCustomerWithDeliveredOrder("WSB_NEVER_EDITED");

  const orderBefore = (
    await appPool.query(
      `SELECT customer_id::text, subtotal_estimated::text, subtotal_final::text, discount_total::text,
              delivery_fee::text, total_final::text, delivery_city
         FROM orders WHERE id = $1::uuid`,
      [c1.orderId],
    )
  ).rows[0];

  await resetRateLimits();
  const browserLogin = await page.request.post(`${BASE}/api/admin/session`, {
    data: { email: creds.syntheticAdminOwner.email, password: creds.syntheticAdminOwner.password },
    headers: { Origin: BASE },
  });
  expect(browserLogin.status()).toBe(201);

  await page.goto(`${BASE}/admin/customers/${c1.customerId}`);
  const initialSection = page.getByRole("region", { name: "إخفاء هوية العميل" });
  await expect(initialSection).toHaveAttribute("data-anonymize-state", "INITIAL");
  await page.screenshot({ path: path.join(SHOTS_DIR, "01-admin-ui-initial-state.png"), fullPage: true });

  const responsePromise = page.waitForResponse(
    (r) => r.url().includes(`/api/admin/customers/${c1.customerId}/anonymize`) && r.request().method() === "POST",
  );
  await initialSection.getByLabel(/سبب إخفاء الهوية/).fill("طلب إخفاء هوية عميل لم يسبق تعديل ملفه إداريًا");
  await initialSection.getByRole("button", { name: "اخفي هوية العميل" }).click();
  await initialSection.getByRole("button", { name: "تأكيد إخفاء الهوية" }).click();

  const postRes = await responsePromise;
  expect(postRes.status()).toBe(200);
  const postJson = (await postRes.json()) as {
    data: { anonymized: boolean; outcome: string; redactionTaskId: string | null };
  };
  expect(postJson.data.anonymized).toBe(true);
  expect(postJson.data.outcome).toBe("COMPLETED_WITH_LEGAL_REVIEW");
  expect(postJson.data.redactionTaskId).toBeNull();

  const completedSection = page.getByRole("region", { name: "نتيجة إخفاء الهوية" });
  await expect(completedSection).toHaveAttribute("data-anonymize-state", "COMPLETED");
  await expect(completedSection).toContainText("عميل مجهول");

  const taskCount = (
    await appPool.query(`SELECT count(*)::int AS n FROM customer_audit_redaction_tasks WHERE customer_id = $1::uuid`, [
      c1.customerId,
    ])
  ).rows[0].n;
  expect(taskCount).toBe(0);

  const orderAfter = (
    await appPool.query(
      `SELECT customer_id::text, subtotal_estimated::text, subtotal_final::text, discount_total::text,
              delivery_fee::text, total_final::text, delivery_city
         FROM orders WHERE id = $1::uuid`,
      [c1.orderId],
    )
  ).rows[0];
  expect(orderAfter).toEqual(orderBefore);

  gateResults.s01_neverEditedCustomer = "PASS";
  gateResults.s15_orderAccountReferentialIntegrity = "PASS";
});

test("WS-B #2a: Post-Task-2 Admin PATCH (`changedFields`-only, zero PII) completes synchronously with 200 OK", async () => {
  const c2a = await createCustomerWithDeliveredOrder("WSB_TASK2_PATCH");
  const editedFirstName = `معدل_بدون_نسخ_${Date.now()}`;
  const editedEmail = `minimized.${Date.now()}@synthetic-h2.invalid`;
  trackedPiiTokens.add(editedFirstName);
  trackedPiiTokens.add(editedEmail);

  const patchRes = await apiJson(
    "PATCH",
    `/api/admin/customers/${c2a.customerId}`,
    { firstName: editedFirstName, email: editedEmail, autoAcceptReplacements: true },
    superAdminCookie,
  );
  expect(patchRes.status).toBe(200);

  const latestUpd = (
    await appPool.query<{ updated_at: Date }>(`SELECT updated_at FROM customers WHERE id = $1::uuid`, [
      c2a.customerId,
    ])
  ).rows[0]!;

  const anonRes = await apiJson<{ anonymized: boolean; outcome: string; removed: { auditRows: number } }>(
    "POST",
    `/api/admin/customers/${c2a.customerId}/anonymize`,
    {
      confirmed: true,
      reason: "إخفاء هوية عميل تم تعديل اسمه وبريده عبر المسار المصغر",
      expectedUpdatedAt: latestUpd.updated_at.toISOString(),
    },
    superAdminCookie,
  );
  expect(anonRes.status).toBe(200);
  expect(anonRes.data.anonymized).toBe(true);
  expect(anonRes.data.outcome).toBe("COMPLETED_WITH_LEGAL_REVIEW");
  expect(anonRes.data.removed.auditRows).toBeGreaterThanOrEqual(1);

  gateResults.s02_adminEditCustomerNameEmail = "PASS";
});

test("WS-B #3, #4, #5, #6, #7, #8, #9, #10 & #11: Historical customer PII in audit_logs returns 202 PENDING, independent worker scrubs PII, preserves envelope, isolates bystanders, and transitions UI to 200 COMPLETED", async ({
  page,
}) => {
  const c3 = await createCustomerWithDeliveredOrder("WSB_HIST_PII");
  const bystander = await createCustomerWithDeliveredOrder("WSB_BYSTANDER");

  const legacyNick = `لقب_تاريخي_${Date.now()}`;
  const secondaryPhone = nextEgyptPhone();
  const histEmail = `legacy.pii.${Date.now()}@historical.invalid`;
  trackedPiiTokens.add(legacyNick);
  trackedPiiTokens.add(secondaryPhone);
  trackedPiiTokens.add(histEmail);

  const histAuditIns = await appPool.query<{ id: string }>(
    `INSERT INTO audit_logs (user_id, actor_type, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent)
     VALUES (
       '02800000-0000-7000-8000-000000000010'::uuid,
       'ADMIN',
       'customers.update',
       'customers',
       $1::uuid,
       $2::jsonb,
       $3::jsonb,
       '127.0.0.1'::inet,
       'Mozilla/5.0 HistoricalAdmin/1.0'
     )
     RETURNING id::text AS id`,
    [
      c3.customerId,
      JSON.stringify({ firstName: c3.firstName, phone: c3.canonicalPhone, isActive: true }),
      JSON.stringify({
        firstName: c3.firstName,
        lastName: c3.lastName,
        email: histEmail,
        legacyNickname: legacyNick,
        nestedProfile: { secondaryPhone, autoAcceptReplacements: true },
        changedFields: ["firstName", "email"],
        correlation_id: "corr-hist-001",
      }),
    ],
  );
  const histAuditId = histAuditIns.rows[0]!.id;

  const bystanderAuditIns = await appPool.query<{ id: string }>(
    `INSERT INTO audit_logs (user_id, actor_type, action, entity_type, entity_id, old_values, new_values)
     VALUES ('02800000-0000-7000-8000-000000000010'::uuid, 'ADMIN', 'customers.update', 'customers', $1::uuid, null, $2::jsonb)
     RETURNING id::text AS id`,
    [bystander.customerId, JSON.stringify({ firstName: bystander.firstName, email: bystander.email })],
  );
  const bystanderBefore = (
    await appPool.query(`SELECT old_values, new_values FROM audit_logs WHERE id = $1::uuid`, [
      bystanderAuditIns.rows[0]!.id,
    ])
  ).rows[0];

  const envelopeBefore = (
    await appPool.query(
      `SELECT id::text, user_id::text, actor_type, action, entity_type, entity_id::text,
              ip_address::text, user_agent, created_at::text
         FROM audit_logs WHERE id = $1::uuid`,
      [histAuditId],
    )
  ).rows[0];

  await resetRateLimits();
  const browserLogin = await page.request.post(`${BASE}/api/admin/session`, {
    data: { email: creds.syntheticAdminOwner.email, password: creds.syntheticAdminOwner.password },
    headers: { Origin: BASE },
  });
  expect(browserLogin.status()).toBe(201);
  await page.goto(`${BASE}/admin/customers/${c3.customerId}`);

  const initialPanel = page.getByRole("region", { name: "إخفاء هوية العميل" });
  const postPromise = page.waitForResponse(
    (r) => r.url().includes(`/api/admin/customers/${c3.customerId}/anonymize`) && r.request().method() === "POST",
  );
  await initialPanel.getByLabel(/سبب إخفاء الهوية/).fill("إخفاء هوية عميل له سجل تدقيق تاريخي يحتوي على اسم وبريد");
  await initialPanel.getByRole("button", { name: "اخفي هوية العميل" }).click();
  await initialPanel.getByRole("button", { name: "تأكيد إخفاء الهوية" }).click();

  const pendingResp = await postPromise;
  expect(pendingResp.status()).toBe(202);
  const pendingBody = await pendingResp.text();
  expect(pendingBody).not.toContain(histEmail);
  expect(pendingBody).not.toContain(c3.firstName);
  const pendingParsed = JSON.parse(pendingBody) as {
    data: { anonymized: boolean; outcome: string; redactionTaskId: string };
  };
  expect(pendingParsed.data.anonymized).toBe(false);
  expect(pendingParsed.data.outcome).toBe("PENDING_AUDIT_REDACTION");
  const taskId = pendingParsed.data.redactionTaskId;
  expect(taskId).toMatch(/^[0-9a-f-]{36}$/i);

  const pendingPanel = page.getByRole("region", { name: "نتيجة إخفاء الهوية" });
  await expect(pendingPanel).toHaveAttribute("data-anonymize-state", "PENDING_AUDIT_REDACTION");
  await expect(pendingPanel).toContainText("PENDING_AUDIT_REDACTION");
  await expect(pendingPanel).toContainText("ولم تكتمل عملية إخفاء الهوية نهائيًا بعد");
  await page.screenshot({ path: path.join(SHOTS_DIR, "02-admin-ui-202-pending-state.png"), fullPage: true });

  await page.reload();
  await expect(page.getByRole("region", { name: "نتيجة إخفاء الهوية" })).toHaveAttribute(
    "data-anonymize-state",
    "PENDING_AUDIT_REDACTION",
  );

  // Duplicate submission reuses active task safely
  const latestUpd = (
    await appPool.query<{ updated_at: Date }>(`SELECT updated_at FROM customers WHERE id = $1::uuid`, [
      c3.customerId,
    ])
  ).rows[0]!;
  const dupRes = await apiJson<{ anonymized: boolean; outcome: string; redactionTaskId: string }>(
    "POST",
    `/api/admin/customers/${c3.customerId}/anonymize`,
    {
      confirmed: true,
      reason: "طلب مكرر أثناء انتظار العامل",
      expectedUpdatedAt: latestUpd.updated_at.toISOString(),
    },
    superAdminCookie,
  );
  expect(dupRes.status).toBe(202);
  expect(dupRes.data.anonymized).toBe(false);
  expect(dupRes.data.redactionTaskId).toBe(taskId);

  const getPending = await apiJson<{ state: string; anonymized: boolean }>(
    "GET",
    `/api/admin/customers/${c3.customerId}/anonymize`,
    undefined,
    superAdminCookie,
  );
  expect(getPending.status).toBe(202);
  expect(getPending.data.state).toBe("PENDING_AUDIT_REDACTION");
  expect(getPending.data.anonymized).toBe(false);

  // Independent local worker (`--once`) processes task
  const workerRun = runWorkerCli(["--once"]);
  expect(workerRun.status).toBe(0);

  await page.getByRole("button", { name: "تحديث حالة التنقية" }).click();
  await expect(page.getByRole("region", { name: "نتيجة إخفاء الهوية" })).toHaveAttribute(
    "data-anonymize-state",
    "COMPLETED",
  );
  await expect(page.getByRole("region", { name: "نتيجة إخفاء الهوية" })).toContainText(
    "سجلات تدقيق للعميل اتنقّت: 1",
  );
  await page.screenshot({ path: path.join(SHOTS_DIR, "04-admin-ui-200-completed-state.png"), fullPage: true });

  const getDone = await apiJson<{ state: string; anonymized: boolean }>(
    "GET",
    `/api/admin/customers/${c3.customerId}/anonymize`,
    undefined,
    superAdminCookie,
  );
  expect(getDone.status).toBe(200);
  expect(getDone.data.state).toBe("COMPLETED");
  expect(getDone.data.anonymized).toBe(true);

  const scrubbedRow = (
    await appPool.query(
      `SELECT id::text, user_id::text, actor_type, action, entity_type, entity_id::text,
              ip_address::text, user_agent, created_at::text, old_values, new_values
         FROM audit_logs WHERE id = $1::uuid`,
      [histAuditId],
    )
  ).rows[0];
  const { old_values: oldAfter, new_values: newAfter, ...envelopeAfter } = scrubbedRow;
  expect(envelopeAfter).toEqual(envelopeBefore);
  expect(oldAfter).toEqual({
    firstName: "تمت إزالة البيانات لأسباب الخصوصية",
    phone: "تمت إزالة البيانات لأسباب الخصوصية",
    isActive: true,
  });
  expect(newAfter).toEqual({
    firstName: "تمت إزالة البيانات لأسباب الخصوصية",
    lastName: "تمت إزالة البيانات لأسباب الخصوصية",
    email: "تمت إزالة البيانات لأسباب الخصوصية",
    legacyNickname: "تمت إزالة البيانات لأسباب الخصوصية",
    nestedProfile: {
      secondaryPhone: "تمت إزالة البيانات لأسباب الخصوصية",
      autoAcceptReplacements: true,
    },
    changedFields: ["firstName", "email"],
    correlation_id: "corr-hist-001",
  });

  // Verify bystander customer's audit & profile rows remain untouched!
  const bystanderAfter = (
    await appPool.query(`SELECT old_values, new_values FROM audit_logs WHERE id = $1::uuid`, [
      bystanderAuditIns.rows[0]!.id,
    ])
  ).rows[0];
  expect(bystanderAfter).toEqual(bystanderBefore);
  const bystanderCustRow = (
    await appPool.query<{ first_name: string; email: string }>(`SELECT first_name, email FROM customers WHERE id = $1::uuid`, [
      bystander.customerId,
    ])
  ).rows[0]!;
  expect(bystanderCustRow.first_name).toBe(bystander.firstName);
  expect(bystanderCustRow.email).toBe(bystander.email);

  // Cleanly anonymize bystander afterwards so the final full-DB PII scan verifies 0 retained PII across anonymized records
  const byUpd = (
    await appPool.query<{ updated_at: Date }>(`SELECT updated_at FROM customers WHERE id = $1::uuid`, [
      bystander.customerId,
    ])
  ).rows[0]!;
  const byAnon = await apiJson(
    "POST",
    `/api/admin/customers/${bystander.customerId}/anonymize`,
    {
      confirmed: true,
      reason: "تنظيف العميل المجاور بعد إثبات عدم التداخل",
      expectedUpdatedAt: byUpd.updated_at.toISOString(),
    },
    superAdminCookie,
  );
  expect(byAnon.status).toBe(202);
  expect(runWorkerCli(["--once"]).status).toBe(0);

  await page.goto(`${BASE}/admin/audit-logs?action=customers.audit_redact`);
  await expect(page.locator("body")).toContainText("تنقية القيم التاريخية لعميل مخفي الهوية");
  await expect(page.locator("body")).not.toContainText("عمل غير معروف");

  gateResults.s03_historicalPiiRecorded = "PASS";
  gateResults.s04_adminInitiatesAnonymization = "PASS";
  gateResults.s05_responseIs202Pending = "PASS";
  gateResults.s06_independentWorkerProcessesTask = "PASS";
  gateResults.s07_finalStatus200Completed = "PASS";
  gateResults.s09_auditEnvelopePreserved = "PASS";
  gateResults.s10_otherCustomersUnchanged = "PASS";
  gateResults.s11_adminUiRendersCorrectly = "PASS";
});

test("WS-B #13: Worker crash rollback, FAILED state visibility in API & Admin UI, health alert, and safe recovery (`--recover-task`)", async ({
  page,
}) => {
  const c6 = await createCustomerWithDeliveredOrder("WSB_CRASH_RECOVER");
  const crashEmail = `crash.recover.${Date.now()}@historical.invalid`;
  trackedPiiTokens.add(crashEmail);

  await appPool.query(
    `INSERT INTO audit_logs (user_id, actor_type, action, entity_type, entity_id, old_values, new_values)
     VALUES ('02800000-0000-7000-8000-000000000010'::uuid, 'ADMIN', 'customers.update', 'customers', $1::uuid, null, $2::jsonb)`,
    [c6.customerId, JSON.stringify({ firstName: c6.firstName, email: crashEmail })],
  );

  const upd = (
    await appPool.query<{ updated_at: Date }>(`SELECT updated_at FROM customers WHERE id = $1::uuid`, [
      c6.customerId,
    ])
  ).rows[0]!;
  const anon = await apiJson<{ redactionTaskId: string; anonymized: boolean }>(
    "POST",
    `/api/admin/customers/${c6.customerId}/anonymize`,
    {
      confirmed: true,
      reason: "اختبار فشل العامل واسترداده بأمان",
      expectedUpdatedAt: upd.updated_at.toISOString(),
    },
    superAdminCookie,
  );
  expect(anon.status).toBe(202);
  const taskId = anon.data.redactionTaskId;

  const crash1 = runWorkerCli(["--once", "--max-attempts", "2"], {
    ALLOW_WORKER_FAULT_INJECTION: "1",
    PRIVACY_WORKER_SIMULATE_FAULT: "ALWAYS",
  });
  expect(crash1.status).toBe(2);
  const crash2 = runWorkerCli(["--once", "--max-attempts", "2"], {
    ALLOW_WORKER_FAULT_INJECTION: "1",
    PRIVACY_WORKER_SIMULATE_FAULT: "ALWAYS",
  });
  expect(crash2.status).toBe(2);

  expect(runWorkerCli(["--health"]).status).toBe(1);

  const getFailed = await apiJson<{
    state: string;
    anonymized: boolean;
    result: { outcome: string; attemptCount: number; lastErrorCode: string };
  }>("GET", `/api/admin/customers/${c6.customerId}/anonymize`, undefined, superAdminCookie);
  expect(getFailed.status).toBe(202);
  expect(getFailed.data.state).toBe("FAILED");
  expect(getFailed.data.anonymized).toBe(false);
  expect(getFailed.data.result.outcome).toBe("FAILED");
  expect(getFailed.data.result.attemptCount).toBe(2);
  expect(getFailed.data.result.lastErrorCode).toBe("SIMULATED_WORKER_CRASH");

  await resetRateLimits();
  const browserLogin = await page.request.post(`${BASE}/api/admin/session`, {
    data: { email: creds.syntheticAdminOwner.email, password: creds.syntheticAdminOwner.password },
    headers: { Origin: BASE },
  });
  expect(browserLogin.status()).toBe(201);
  await page.goto(`${BASE}/admin/customers/${c6.customerId}`);

  const failedRegion = page.getByRole("region", { name: "نتيجة إخفاء الهوية" });
  await expect(failedRegion).toHaveAttribute("data-anonymize-state", "FAILED");
  await expect(failedRegion).toContainText("FAILED");
  await expect(failedRegion).toContainText("SIMULATED_WORKER_CRASH");
  await expect(failedRegion).toContainText("لم تكتمل عملية إخفاء الهوية نهائيًا بعد");
  await page.screenshot({ path: path.join(SHOTS_DIR, "03-admin-ui-failed-recovery-state.png"), fullPage: true });

  expect(runWorkerCli(["--recover-task", taskId]).status).toBe(0);
  expect(runWorkerCli(["--health"]).status).toBe(0);

  await page.getByRole("button", { name: "تحديث حالة التنقية" }).click();
  await expect(page.getByRole("region", { name: "نتيجة إخفاء الهوية" })).toHaveAttribute(
    "data-anonymize-state",
    "COMPLETED",
  );

  // Re-running recover/worker on an already COMPLETED task is strictly idempotent
  expect(runWorkerCli(["--recover-task", taskId]).status).toBe(0);

  gateResults.s13_workerFailureAndRecovery = "PASS";
});

test("WS-A4 Concurrency & Daemon Lifecycle: 4 concurrent workers serialize safely + `--daemon` wakes via LISTEN/NOTIFY and shuts down cleanly", async () => {
  const c8 = await createCustomerWithDeliveredOrder("WSB_CONCURRENT");
  const concEmail = `concurrent.${Date.now()}@historical.invalid`;
  trackedPiiTokens.add(concEmail);

  await appPool.query(
    `INSERT INTO audit_logs (user_id, actor_type, action, entity_type, entity_id, old_values, new_values)
     VALUES ('02800000-0000-7000-8000-000000000010'::uuid, 'ADMIN', 'customers.update', 'customers', $1::uuid, null, $2::jsonb)`,
    [c8.customerId, JSON.stringify({ firstName: c8.firstName, email: concEmail })],
  );
  const upd8 = (
    await appPool.query<{ updated_at: Date }>(`SELECT updated_at FROM customers WHERE id = $1::uuid`, [
      c8.customerId,
    ])
  ).rows[0]!;
  const anon8 = await apiJson<{ redactionTaskId: string }>(
    "POST",
    `/api/admin/customers/${c8.customerId}/anonymize`,
    {
      confirmed: true,
      reason: "اختبار أربعة عمال متزامنين",
      expectedUpdatedAt: upd8.updated_at.toISOString(),
    },
    superAdminCookie,
  );
  expect(anon8.status).toBe(202);

  const env: NodeJS.ProcessEnv = { ...process.env, PRIVACY_WORKER_DATABASE_URL: WORKER_DB_URL };
  delete env.DATABASE_URL;
  const exits = await Promise.all(
    [1, 2, 3, 4].map(
      () =>
        new Promise<number | null>((resolve) => {
          const child = spawn(process.execPath, [WORKER_SCRIPT, "--once"], { cwd: REPO_ROOT, env });
          let out = "";
          child.stdout.on("data", (d) => (out += String(d)));
          child.stderr.on("data", (d) => (out += String(d)));
          child.on("close", (code) => {
            if (out.trim()) fs.appendFileSync(WORKER_LOG, out.trim() + "\n", "utf8");
            resolve(code);
          });
        }),
    ),
  );
  expect(exits).toEqual([0, 0, 0, 0]);

  const redactAuditCount = (
    await appPool.query(
      `SELECT count(*)::int AS n FROM audit_logs WHERE entity_type = 'customers' AND entity_id = $1::uuid AND action = 'customers.audit_redact'`,
      [c8.customerId],
    )
  ).rows[0].n;
  expect(redactAuditCount).toBe(1);

  const daemonChild = spawn(process.execPath, [WORKER_SCRIPT, "--daemon", "--poll-ms", "10000"], {
    cwd: REPO_ROOT,
    env,
  });
  let daemonOut = "";
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Daemon did not reach ready state")), 8000);
    daemonChild.stdout.on("data", (chunk) => {
      daemonOut += String(chunk);
      if (daemonOut.includes("worker.daemon_ready")) {
        clearTimeout(timer);
        resolve();
      }
    });
  });

  const cDaemon = await createCustomerWithDeliveredOrder("WSB_DAEMON_NOTIFY");
  const daemonEmail = `daemon.notify.${Date.now()}@historical.invalid`;
  trackedPiiTokens.add(daemonEmail);
  await appPool.query(
    `INSERT INTO audit_logs (user_id, actor_type, action, entity_type, entity_id, old_values, new_values)
     VALUES ('02800000-0000-7000-8000-000000000010'::uuid, 'ADMIN', 'customers.update', 'customers', $1::uuid, null, $2::jsonb)`,
    [cDaemon.customerId, JSON.stringify({ firstName: cDaemon.firstName, email: daemonEmail })],
  );
  const updD = (
    await appPool.query<{ updated_at: Date }>(`SELECT updated_at FROM customers WHERE id = $1::uuid`, [
      cDaemon.customerId,
    ])
  ).rows[0]!;
  await apiJson(
    "POST",
    `/api/admin/customers/${cDaemon.customerId}/anonymize`,
    {
      confirmed: true,
      reason: "اختبار استيقاظ العامل عبر NOTIFY",
      expectedUpdatedAt: updD.updated_at.toISOString(),
    },
    superAdminCookie,
  );

  await expect
    .poll(
      async () => {
        const s = await apiJson<{ state: string }>(
          "GET",
          `/api/admin/customers/${cDaemon.customerId}/anonymize`,
          undefined,
          superAdminCookie,
        );
        return s.data.state;
      },
      { timeout: 3000 },
    )
    .toBe("COMPLETED");

  daemonChild.kill("SIGTERM");
  await new Promise<void>((resolve) => daemonChild.on("close", () => resolve()));
  fs.appendFileSync(WORKER_LOG, daemonOut.trim() + "\n", "utf8");

  gateResults.s_concurrentWorkersAndDaemon = "PASS";
});

test("WS-B #12 & #14: Restricted Admin authorization denials (401/403) + Direct PostgreSQL privilege escalation denials", async ({
  page,
}) => {
  const cAuth = await createCustomerWithDeliveredOrder("WSB_AUTHZ");

  expect((await apiJson("GET", `/api/admin/customers/${cAuth.customerId}/anonymize`)).status).toBe(401);
  expect(
    (
      await apiJson("POST", `/api/admin/customers/${cAuth.customerId}/anonymize`, {
        confirmed: true,
        reason: "بدون جلسة",
        expectedUpdatedAt: cAuth.updatedAtIso,
      })
    ).status,
  ).toBe(401);

  expect(
    (
      await apiJson(
        "POST",
        `/api/admin/customers/${cAuth.customerId}/anonymize`,
        { confirmed: true, reason: "هجوم CSRF", expectedUpdatedAt: cAuth.updatedAtIso },
        superAdminCookie,
        { Origin: "https://attacker.example" },
      )
    ).status,
  ).toBe(403);

  expect(
    (await apiJson("GET", `/api/admin/customers/${cAuth.customerId}/anonymize`, undefined, storeAdminCookie))
      .status,
  ).toBe(403);
  expect(
    (
      await apiJson(
        "POST",
        `/api/admin/customers/${cAuth.customerId}/anonymize`,
        {
          confirmed: true,
          reason: "محاولة مدير متجر بدون صلاحية إخفاء",
          expectedUpdatedAt: cAuth.updatedAtIso,
        },
        storeAdminCookie,
      )
    ).status,
  ).toBe(403);

  expect(
    (await apiJson("GET", `/api/admin/customers/${cAuth.customerId}/anonymize`, undefined, viewerAdminCookie))
      .status,
  ).toBe(403);
  expect(
    (
      await apiJson(
        "POST",
        `/api/admin/customers/${cAuth.customerId}/anonymize`,
        { confirmed: true, reason: "محاولة مشاهد", expectedUpdatedAt: cAuth.updatedAtIso },
        viewerAdminCookie,
      )
    ).status,
  ).toBe(403);

  await resetRateLimits();
  await page.context().clearCookies();
  const sBrowserLogin = await page.request.post(`${BASE}/api/admin/session`, {
    data: { email: storeAdminEmail, password: STORE_ADMIN_PW },
    headers: { Origin: BASE },
  });
  expect(sBrowserLogin.status()).toBe(201);
  await page.goto(`${BASE}/admin/customers/${cAuth.customerId}`);
  await expect(page.getByRole("button", { name: "اخفي هوية العميل" })).toHaveCount(0);

  const randomUuid = crypto.randomUUID();
  await expect(
    appPool.query(`SELECT public.redact_customer_audit_pii($1::uuid)`, [randomUuid]),
  ).rejects.toMatchObject({ code: "42501" });
  await expect(
    appPool.query(`SELECT public.record_customer_audit_redaction_failure($1::uuid, 'ERR')`, [randomUuid]),
  ).rejects.toMatchObject({ code: "42501" });
  await expect(
    appPool.query(`SELECT public.reset_failed_customer_audit_redaction_task($1::uuid)`, [randomUuid]),
  ).rejects.toMatchObject({ code: "42501" });
  await expect(
    appPool.query(`SELECT public.scrub_customer_audit_jsonb('{}'::jsonb)`),
  ).rejects.toMatchObject({ code: "42501" });

  await expect(appPool.query(`SET ROLE ${creds.roles.worker.user}`)).rejects.toMatchObject({ code: "42501" });
  await expect(appPool.query(`SET ROLE h2_audit_redactor`)).rejects.toMatchObject({ code: "42501" });
  await expect(workerPool.query(`SET ROLE h2_audit_redactor`)).rejects.toMatchObject({ code: "42501" });
  await expect(workerPool.query(`SET ROLE ${creds.roles.migrator.user}`)).rejects.toMatchObject({
    code: "42501",
  });

  await expect(appPool.query(`UPDATE public.audit_logs SET new_values = '{}'::jsonb`)).rejects.toMatchObject({
    code: "42501",
  });
  await expect(appPool.query(`DELETE FROM public.audit_logs`)).rejects.toMatchObject({ code: "42501" });
  await expect(workerPool.query(`SELECT count(*) FROM public.audit_logs`)).rejects.toMatchObject({
    code: "42501",
  });
  await expect(workerPool.query(`SELECT count(*) FROM public.customers`)).rejects.toMatchObject({
    code: "42501",
  });

  const migClient = await migPool.connect();
  try {
    await migClient.query("BEGIN");
    await migClient.query(`SELECT pg_catalog.set_config('hyper.audit_redaction_scope', 'customer_pii_only', true)`);
    await expect(
      migClient.query(`UPDATE public.audit_logs SET new_values = '{}'::jsonb`),
    ).rejects.toMatchObject({ code: "23000" });
    await migClient.query("ROLLBACK");
  } finally {
    migClient.release();
  }
  await expect(migPool.query(`DELETE FROM public.audit_logs`)).rejects.toMatchObject({ code: "23000" });

  const anonAuth = await apiJson(
    "POST",
    `/api/admin/customers/${cAuth.customerId}/anonymize`,
    {
      confirmed: true,
      reason: "تنظيف عميل اختبار الصلاحيات",
      expectedUpdatedAt: cAuth.updatedAtIso,
    },
    superAdminCookie,
  );
  expect([200, 202]).toContain(anonAuth.status);
  if (anonAuth.status === 202) expect(runWorkerCli(["--once"]).status).toBe(0);

  gateResults.s12_restrictedAdminDenied = "PASS";
  gateResults.s14_noPrivilegeEscalation = "PASS";
});

test("WS-B #8 & Log Hygiene: Zero retained prohibited historical PII in targeted active database records + zero PII/secrets in logs", async () => {
  const tablesToScan = [
    ["customers", "row_to_json(t)::text"],
    ["customer_addresses", "row_to_json(t)::text"],
    ["customer_sessions", "row_to_json(t)::text"],
    ["customer_auth_rate_limits", "row_to_json(t)::text"],
    ["orders", "row_to_json(t)::text"],
    ["audit_logs", "COALESCE(old_values::text, '') || ' ' || COALESCE(new_values::text, '')"],
    ["customer_audit_redaction_tasks", "row_to_json(t)::text"],
  ] as const;

  const piiHits: Array<{ table: string; tokenLength: number }> = [];
  for (const token of trackedPiiTokens) {
    if (!token || token.length < 4) continue;
    for (const [tbl, expr] of tablesToScan) {
      const n = (
        await dbaPool.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM public.${tbl} AS t WHERE (${expr}) LIKE $1`,
          [`%${token}%`],
        )
      ).rows[0]!.n;
      if (n > 0) {
        piiHits.push({ table: tbl, tokenLength: token.length });
      }
    }
  }
  expect(piiHits).toEqual([]);

  const logFiles = fs
    .readdirSync(LOGS_DIR)
    .filter((f) => f.endsWith(".log"))
    .map((f) => path.join(LOGS_DIR, f));

  const secretTokens = [
    creds.roles.dba.password,
    creds.roles.migrator.password,
    creds.roles.app.password,
    creds.roles.worker.password,
    creds.syntheticAdminOwner.password,
    creds.rateLimitHmacSecret,
    ...trackedPiiTokens,
  ];

  const logLeaks: Array<{ file: string; kind: string }> = [];
  for (const lf of logFiles) {
    const text = fs.readFileSync(lf, "utf8");
    for (const secret of secretTokens) {
      if (secret && secret.length >= 6 && text.includes(secret)) {
        logLeaks.push({ file: path.basename(lf), kind: "secret_or_pii_match" });
      }
    }
  }
  expect(logLeaks).toEqual([]);

  gateResults.s08_zeroHistoricalProhibitedPiiInDb = "PASS";
  gateResults.s_zeroSecretsOrPiiInLogs = "PASS";
});
