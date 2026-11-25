// Shared admin route guard (BA-2).
// Server-side RBAC only: session + effective permission via checkPermission.
// Returns null when allowed, otherwise a ready 401/403 NextResponse.
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { verifySameOrigin } from "@/lib/api/request-context";
import { fail } from "@/lib/api/respond";
import { checkPermission, getCurrentAdmin, type AdminContext } from "@/lib/auth/rbac";
import {
  isAdminPreviewPermissionAllowed,
  isAdminReadOnlyPreviewConfigured,
} from "@/lib/auth/admin-read-only-preview";
import { isAdminPreviewReadRequestAllowed } from "@/lib/auth/admin-preview-request";

/** Preview veto only, NOT authentication. Empty capabilities mean a mutation. */
export async function denyAdminPreviewRequest(permissions: string[]): Promise<NextResponse | null> {
  if (!isAdminReadOnlyPreviewConfigured()) return null;
  if (permissions.length === 0 || !permissions.every(isAdminPreviewPermissionAllowed) ||
      !(await isAdminPreviewReadRequestAllowed())) {
    const r = fail(new ApiError("FORBIDDEN", "Admin read-only preview."));
    return NextResponse.json(r.body, { status: r.status });
  }
  return null;
}

async function isCrossOriginRequest(): Promise<boolean> {
  try {
    const h = await headers();
    return !verifySameOrigin(h);
  } catch {
    return false;
  }
}

export async function denyUnless(permission: string): Promise<NextResponse | null> {
  const previewDenied = await denyAdminPreviewRequest([permission]);
  if (previewDenied) return previewDenied;
  if (await isCrossOriginRequest()) {
    const r = fail(new ApiError("FORBIDDEN", "Forbidden."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const auth = await checkPermission(permission);
  if (auth.ok === false) {
    const r = fail(
      new ApiError(
        auth.code === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : "FORBIDDEN",
        auth.code === "UNAUTHENTICATED" ? "Authentication required." : "Forbidden.",
      ),
    );
    return NextResponse.json(r.body, { status: r.status });
  }
  return null;
}

/**
 * Same gate as denyUnless but also yields the authenticated admin context
 * (PRE-BA-11 audit retrofit: audited writes need the actor id server-side).
 * Identical 401/403 semantics; callers branch on `"denied" in gate`.
 */
export async function adminOrDeny(
  permission: string,
): Promise<{ admin: AdminContext } | { denied: NextResponse }> {
  const previewDenied = await denyAdminPreviewRequest([permission]);
  if (previewDenied) return { denied: previewDenied };
  if (await isCrossOriginRequest()) {
    const r = fail(new ApiError("FORBIDDEN", "Forbidden."));
    return { denied: NextResponse.json(r.body, { status: r.status }) };
  }
  const auth = await checkPermission(permission);
  if (auth.ok === false) {
    const r = fail(
      new ApiError(
        auth.code === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : "FORBIDDEN",
        auth.code === "UNAUTHENTICATED" ? "Authentication required." : "Forbidden.",
      ),
    );
    return { denied: NextResponse.json(r.body, { status: r.status }) };
  }
  return { admin: auth.admin };
}

/**
 * Own-inbox gate (ADM-11): authentication is the ONLY requirement — the
 * notification page has always been open to every signed-in admin, and the
 * inbox is scoped to the caller by `userId` in SQL. `previewPermission` is
 * used solely by the read-only preview veto: pass a `.view` key for reads and
 * `null` for mutations (a configured preview blocks every write).
 */
export async function adminSessionOrDeny(
  previewPermission: string | null,
): Promise<{ admin: AdminContext } | { denied: NextResponse }> {
  const previewDenied = await denyAdminPreviewRequest(previewPermission ? [previewPermission] : []);
  if (previewDenied) return { denied: previewDenied };
  if (await isCrossOriginRequest()) {
    const r = fail(new ApiError("FORBIDDEN", "Forbidden."));
    return { denied: NextResponse.json(r.body, { status: r.status }) };
  }
  const admin = await getCurrentAdmin();
  if (!admin) {
    const r = fail(new ApiError("UNAUTHENTICATED", "Authentication required."));
    return { denied: NextResponse.json(r.body, { status: r.status }) };
  }
  return { admin };
}

/**
 * Requires AT LEAST ONE of the listed permissions (E-3 closure).
 *
 * Used where one capability has a dedicated key and an older, broader key
 * still protects the same surface — e.g. the delivery-zone screens are gated
 * by `delivery.view` (the dedicated capability) and remain reachable for a
 * role that only holds the broader `settings.view`. The union never widens
 * access beyond what the database grants: the caller still has to hold ONE of
 * the listed keys.
 *
 * The preview veto is a READ check here: at least one listed key must be a
 * `.view` key, otherwise the request is treated as a mutation and blocked.
 * The 401/403 envelope never says WHICH key was missing.
 */
export async function denyUnlessAny(
  permissions: string[],
): Promise<NextResponse | null> {
  if (permissions.length === 0) {
    const r = fail(new ApiError("FORBIDDEN", "Forbidden."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const previewDenied = await denyAdminPreviewRequest(permissions);
  if (previewDenied) return previewDenied;
  if (await isCrossOriginRequest()) {
    const r = fail(new ApiError("FORBIDDEN", "Forbidden."));
    return NextResponse.json(r.body, { status: r.status });
  }
  let code: "UNAUTHENTICATED" | "FORBIDDEN" = "FORBIDDEN";
  for (const permission of permissions) {
    const auth = await checkPermission(permission);
    if (auth.ok) return null;
    // An unauthenticated caller is rejected as unauthenticated (401), not as
    // forbidden — but only if EVERY key says so; the first answer wins.
    if (auth.code === "UNAUTHENTICATED" && code === "FORBIDDEN") code = "UNAUTHENTICATED";
  }
  const r = fail(
    new ApiError(
      code === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : "FORBIDDEN",
      code === "UNAUTHENTICATED" ? "Authentication required." : "Forbidden.",
    ),
  );
  return NextResponse.json(r.body, { status: r.status });
}

/**
 * Requires EVERY listed permission (Phase-10 remediation, G01). Used where a
 * resource exposes two distinct capabilities — e.g. a variant carries the
 * product structure (`products.view`) AND the selling price (`prices.view`).
 * The first missing key produces the same 401/403 envelope as `denyUnless`;
 * the response never says WHICH key was missing.
 */
export async function denyUnlessAll(
  permissions: string[],
): Promise<NextResponse | null> {
  const previewDenied = await denyAdminPreviewRequest(permissions);
  if (previewDenied) return previewDenied;
  for (const permission of permissions) {
    const denied = await denyUnless(permission);
    if (denied) return denied;
  }
  return null;
}

/**
 * `adminOrDeny` for a resource that needs several capabilities at once
 * (Phase-10 remediation, G01): e.g. editing a variant's price field needs
 * both `products.update` (the variant) and `prices.update` (the price).
 */
export async function adminOrDenyAll(
  permissions: string[],
): Promise<{ admin: AdminContext } | { denied: NextResponse }> {
  const previewDenied = await denyAdminPreviewRequest(permissions);
  if (previewDenied) return { denied: previewDenied };
  if (await isCrossOriginRequest()) {
    const r = fail(new ApiError("FORBIDDEN", "Forbidden."));
    return { denied: NextResponse.json(r.body, { status: r.status }) };
  }
  let admin: AdminContext | null = null;
  for (const permission of permissions) {
    const auth = await checkPermission(permission);
    if (auth.ok === false) {
      const r = fail(
        new ApiError(
          auth.code === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : "FORBIDDEN",
          auth.code === "UNAUTHENTICATED" ? "Authentication required." : "Forbidden.",
        ),
      );
      return { denied: NextResponse.json(r.body, { status: r.status }) };
    }
    admin = auth.admin;
  }
  return { admin: admin as AdminContext };
}
