// Shared admin identities for the Phase-10 browser specs.
//
// The fixtures are created THROUGH THE ADMIN API (no direct database access,
// no fixture files) and removed again in `afterAll`. Every identity is a
// purpose-built role so the browser can assert the EXACT permission boundary:
//
//   store  -> the seeded STORE_ADMIN role (business operator)
//   viewer -> products/orders/inventory/promotions/coupons/customers READ only
//   price-reader / price-writer / cust-reader / cust-writer -> the split
//              capabilities introduced by the Phase-10 remediation
export const OWNER_EMAIL = process.env.PHASE10_OWNER_EMAIL ?? "owner@hyper-al-moatasem.local";
export const OWNER_PASSWORD = process.env.PHASE10_OWNER_PASSWORD ?? "";
export const PROBE_PASSWORD = process.env.PHASE10_TEST_PASSWORD ?? "P10-E2E-Pass-0001!";
export const BASE = process.env.PHASE10_BASE_URL ?? "http://127.0.0.1:3131";

export interface ApiResult<T = unknown> {
  status: number;
  data: T | null;
}

export type Identity = { email: string; roleId: string; userId: string };

type Json = Record<string, unknown>;

export async function apiLogin(email: string, password: string): Promise<string | null> {
  const r = await fetch(`${BASE}/api/admin/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const setCookie = r.headers.get("set-cookie") || "";
  const m = setCookie.match(/(?:__Host-admin-session|hyper-admin-session-dev)=([^;]+)/);
  return m ? `${m[0].split("=")[0]}=${m[1]}` : null;
}

export async function api<T = Json>(
  cookie: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let parsed: { data?: T } | null = null;
  try {
    parsed = (await r.json()) as { data?: T };
  } catch {
    parsed = null;
  }
  return { status: r.status, data: parsed?.data ?? null };
}

/** Create a role with the given permission keys, a user holding it, and log in. */
export async function createIdentity(
  ownerCookie: string,
  label: string,
  keys: string[],
  email: string,
): Promise<Identity> {
  const byKey = new Map<string, string>();
  const perms = await api<Array<{ id: string; key: string }>>(
    ownerCookie,
    "GET",
    "/api/admin/permissions?limit=100",
  );
  for (const p of perms.data ?? []) byKey.set(p.key, p.id);
  const role = await api<{ id: string }>(ownerCookie, "POST", "/api/admin/roles", {
    name: label.toUpperCase(),
    description: "phase10 browser probe",
  });
  if (role.status !== 201 || !role.data) {
    throw new Error(`FIXTURE role ${label} failed (${role.status})`);
  }
  for (const key of keys) {
    const pid = byKey.get(key);
    if (!pid) throw new Error(`FIXTURE unknown permission ${key}`);
    const g = await api(ownerCookie, "POST", `/api/admin/roles/${role.data.id}/grants`, {
      permissionId: pid,
    });
    if (g.status !== 201) throw new Error(`FIXTURE grant ${key} failed (${g.status})`);
  }
  const user = await api<{ id: string; email: string }>(ownerCookie, "POST", "/api/admin/users", {
    name: "P10 Probe",
    email,
  });
  if (user.status !== 201 || !user.data) {
    throw new Error(`FIXTURE user ${email} failed (${user.status})`);
  }
  const pw = await api(ownerCookie, "POST", `/api/admin/users/${user.data.id}/password`, {
    password: PROBE_PASSWORD,
  });
  if (pw.status !== 200) throw new Error(`FIXTURE password failed (${pw.status})`);
  const asg = await api(ownerCookie, "POST", `/api/admin/users/${user.data.id}/roles`, {
    roleId: role.data.id,
  });
  if (asg.status !== 201) throw new Error(`FIXTURE role assign failed (${asg.status})`);
  return { email, roleId: role.data.id, userId: user.data.id };
}

/** Remove a probe identity: detach the role, deactivate the user, drop the role. */
export async function removeIdentity(ownerCookie: string, id: Identity): Promise<void> {
  if (!id.roleId) return;
  await api(ownerCookie, "DELETE", `/api/admin/users/${id.userId}/roles/${id.roleId}`);
  await api(ownerCookie, "PATCH", `/api/admin/users/${id.userId}`, { isActive: false });
  await api(ownerCookie, "DELETE", `/api/admin/roles/${id.roleId}`);
}
