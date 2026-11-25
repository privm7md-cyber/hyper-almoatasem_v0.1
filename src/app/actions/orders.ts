// FE-7 order adapter (server actions ONLY — the FP03-G1 planned adapter, minimal scope).
// Why server-side: the guest creation response carries the one-time raw credential, which must
// never reach client JS/URL/storage (FP-04 §14, FP03-G1 §7b). These actions call the EXISTING
// backend endpoints over same-origin HTTP (never direct lib writes — contract parity), attach
// identity server-side (session cookie passthrough / order cookie → header), and persist the
// guest credential solely as an HttpOnly order cookie. No backend change. No logging of secrets.

"use server";

import { cookies, headers } from "next/headers";
import { z } from "zod";
import {
  GUEST_TTL_SECONDS,
  guestOrderCookieName,
  isGuestOrderCookieName,
} from "@/lib/orders/guest-order-cookie";
import { CUSTOMER_SESSION_COOKIE_NAMES } from "@/lib/customers/cookies";
import {
  isLocalOrigin,
  isTrustedProxyContext,
  verifySameOrigin,
} from "@/lib/api/request-context";
import { mutationErrorMessage } from "@/lib/orders/display";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The cookie lifetime (GUEST_TTL_SECONDS) is imported, never exported: a
// "use server" module may export async functions ONLY — a value export makes
// the whole module fail at request time and every action in it dies with it.
// A hung same-origin request must not leave the checkout button spinning forever.
// The server may still have committed the order when the timeout fires, so the
// timeout is reported as AMBIGUOUS (never as a definite failure).
const ORDER_REQUEST_TIMEOUT_MS = 15_000;
const ADMIN_SESSION_COOKIES = new Set<string>(["__Host-admin-session", "hyper-admin-session-dev"]);

const GuestAddress = z
  .object({
    city: z.string().trim().min(1).max(80),
    area: z.string().trim().min(1).max(80).nullish(),
    village: z.string().trim().min(1).max(80).nullish(),
    street: z.string().trim().min(1).max(120).nullish(),
    buildingNumber: z.string().trim().min(1).max(30).nullish(),
    landmark: z.string().trim().min(1).max(160).nullish(),
    phone: z.string().trim().min(1).max(32),
  })
  .strict();

const GuestContact = z
  .object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80).nullish(),
  })
  .strict();

const PlaceOrderInput = z
  .object({
    addressId: z.string().regex(UUID_RE).nullish(),
    guestAddress: GuestAddress.nullish(),
    guestContact: GuestContact.nullish(),
    couponCode: z.string().trim().min(1).max(64).nullish(),
    /**
     * Fee shown by the last estimate; the server rejects a change with 409.
     * Required for a NEW order (the storefront always previews the fee before
     * ordering, so a request is never built without a reviewed price). It may
     * be null ONLY for a same-key verification of an unresolved attempt, where
     * the server resolves the attempt before any pricing.
     */
    expectedDeliveryFee: z.string().regex(/^\d{1,8}(\.\d{1,2})?$/).nullish(),
    idempotencyKey: z.string().trim().min(1).max(64),
    cartToken: z.string().regex(/^[0-9a-f]{64}$/i).nullish(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const owned = v.addressId != null;
    const guestSide = v.guestAddress != null || v.guestContact != null;
    if (owned === guestSide) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Address side ambiguous." });
    }
    if (guestSide && (v.guestAddress == null || v.guestContact == null)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Guest needs address and contact." });
    }
  });

export type PlaceOrderInput = z.infer<typeof PlaceOrderInput>;

export type PlaceOrderResult =
  | {
      ok: true;
      orderId: string;
      orderNumber: string;
      replay: boolean;
      /**
       * True when THIS browser can still read the created order: a registered
       * session is present, or the guest order credential cookie is present.
       * A guest replay after a lost 201 can be false forever (keep-same: the
       * credential is never reissued) — the caller must not pretend otherwise.
       */
      credentialAvailable: boolean;
    }
  | { ok: false; code: string; message: string; ambiguous?: boolean; details?: Record<string, unknown> };

async function assertSameOrigin(): Promise<boolean> {
  const h = await headers();
  return verifySameOrigin(h);
}

function parseSafeConfiguredOrigin(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (u.username !== "" || u.password !== "") return null;
    const hn = u.hostname.toLowerCase();
    if (hn === "169.254.169.254" || hn === "0.0.0.0" || hn === "[::]") return null;
    return u.origin;
  } catch {
    return null;
  }
}

function isAllowlistedPlatformHost(host: string): boolean {
  if (process.env.VERCEL !== "1") return false;
  const candidates = [
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
  ];
  const lower = host.toLowerCase();
  return candidates.some((c) => c && c.trim().toLowerCase() === lower);
}

function safeLoopbackPort(): string {
  const raw = process.env.PORT?.trim();
  if (!raw || !/^\d{1,5}$/.test(raw)) return "3000";
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? String(n) : "3000";
}

async function backendBase(): Promise<string | null> {
  const configured =
    parseSafeConfiguredOrigin(process.env.NEXT_PUBLIC_APP_URL) ||
    parseSafeConfiguredOrigin(process.env.APP_ORIGIN) ||
    parseSafeConfiguredOrigin(process.env.NEXT_PUBLIC_SITE_URL);
  if (configured) return configured;

  const h = await headers();
  const host = h.get("host")?.trim();
  if (!host) return null;

  // P12-07 SEC-01: Never trust arbitrary client-supplied Host headers as outbound
  // SSRF targets. Only loopback hosts or platform-verified Vercel deployment
  // hostnames may be addressed directly; any other Host falls back strictly to
  // local 127.0.0.1 loopback (or fails closed on serverless).
  if (isLocalOrigin(host)) {
    const proto =
      isTrustedProxyContext() &&
      h.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https"
        ? "https"
        : "http";
    const safeHost = host === "::1" ? "[::1]" : host;
    return `${proto}://${safeHost}`;
  }
  if (isAllowlistedPlatformHost(host)) {
    return `https://${host.toLowerCase()}`;
  }
  if (process.env.VERCEL === "1") return null;
  return `http://127.0.0.1:${safeLoopbackPort()}`;
}

async function forwardedCookie(): Promise<string> {
  const jar = await cookies();
  return jar
    .getAll()
    .filter((c) => !isGuestOrderCookieName(c.name) && !ADMIN_SESSION_COOKIES.has(c.name))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export async function placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
  if (!(await assertSameOrigin())) {
    return { ok: false, code: "FORBIDDEN", message: "طلب مرفوض." };
  }
  const parsed = PlaceOrderInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "VALIDATION", message: "بيانات الطلب غير صالحة." };
  }
  const base = await backendBase();
  if (!base) return { ok: false, code: "TRANSPORT", message: "تعذّر الاتصال بالخادم.", ambiguous: true };

  const body: Record<string, unknown> = { idempotencyKey: parsed.data.idempotencyKey };
  if (parsed.data.addressId) body.addressId = parsed.data.addressId;
  if (parsed.data.guestAddress) body.guestAddress = parsed.data.guestAddress;
  if (parsed.data.guestContact) body.guestContact = parsed.data.guestContact;
  if (parsed.data.couponCode) body.couponCode = parsed.data.couponCode;
  // Always carried on the wire (null when the storefront has no reviewed
  // fee): the create contract makes the field explicit, and the server
  // rejects a NEW order without it.
  body.expectedDeliveryFee = parsed.data.expectedDeliveryFee ?? null;

  const outbound: Record<string, string> = { "Content-Type": "application/json" };
  const cookie = await forwardedCookie();
  if (cookie !== "") outbound.Cookie = cookie;
  if (parsed.data.cartToken) outbound["x-guest-token"] = parsed.data.cartToken;

  let res: Response;
  try {
    res = await fetch(`${base}/api/store/orders`, {
      method: "POST",
      headers: outbound,
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(ORDER_REQUEST_TIMEOUT_MS),
    });
  } catch {
    // Transport failure OR timeout: the backend may already have committed the
    // order (single authoritative tx). Never imply "not created".
    return { ok: false, code: "TRANSPORT", message: "تعذّر تأكيد نتيجة الطلب.", ambiguous: true };
  }
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    return { ok: false, code: "TRANSPORT", message: "استجابة غير صالحة.", ambiguous: true };
  }
  if (!isRecord(payload)) {
    return { ok: false, code: "TRANSPORT", message: "استجابة غير صالحة.", ambiguous: true };
  }
  if (res.status === 201 && isRecord(payload.data)) {
    const data = payload.data;
    const order = isRecord(data.order) ? data.order : null;
    const orderId = typeof data.orderId === "string" ? data.orderId : typeof order?.id === "string" ? order.id : null;
    const orderNumber =
      typeof data.orderNumber === "string" ? data.orderNumber : typeof order?.orderNumber === "string" ? order.orderNumber : "";
    if (!orderId || !UUID_RE.test(orderId)) {
      return { ok: false, code: "TRANSPORT", message: "استجابة غير صالحة.", ambiguous: true };
    }
    if (typeof data.guestOrderToken === "string" && data.guestOrderToken !== "") {
      const jar = await cookies();
      jar.set(guestOrderCookieName(orderId), data.guestOrderToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: GUEST_TTL_SECONDS,
      });
    }
    // Fresh 201 means THIS request carried a valid identity (session XOR guest
    // cart), and a guest credential — when applicable — was just stored.
    return { ok: true, orderId, orderNumber, replay: false, credentialAvailable: true };
  }
  if (res.status === 200 && isRecord(payload.data)) {
    // Same-key replay: order exists; credential stays keep-same (no token reissued by contract).
    const data = payload.data;
    const order = isRecord(data.order) ? data.order : null;
    const orderId = typeof data.orderId === "string" ? data.orderId : typeof order?.id === "string" ? order.id : null;
    const orderNumber =
      typeof data.orderNumber === "string" ? data.orderNumber : typeof order?.orderNumber === "string" ? order.orderNumber : "";
    if (orderId && UUID_RE.test(orderId)) {
      const jar = await cookies();
      const hasGuestCredential = jar.get(guestOrderCookieName(orderId)) != null;
      const hasSessionCookie = jar
        .getAll()
        .some((c) => (CUSTOMER_SESSION_COOKIE_NAMES as readonly string[]).includes(c.name));
      // `meta.recoveryAvailable` is the SERVER's check of a live credential or
      // a live checkout session bound to this order. Trust it over local
      // cookie names: the checkout cookie is HttpOnly but is not itself proof
      // (it can be expired/unbound/for another order).
      const meta = isRecord(payload.meta) ? payload.meta : null;
      const recoveryAvailable = meta?.recoveryAvailable === true;
      return {
        ok: true,
        orderId,
        orderNumber,
        replay: true,
        credentialAvailable: recoveryAvailable || hasGuestCredential || hasSessionCookie,
      };
    }
  }
  if (isRecord(payload.error) && typeof payload.error.code === "string") {
    const message = typeof payload.error.message === "string" ? payload.error.message : "تعذّر إنشاء الطلب.";
    const details = isRecord(payload.error.details) ? payload.error.details : undefined;
    return { ok: false, code: payload.error.code, message, ...(details ? { details } : {}) };
  }
  return { ok: false, code: "TRANSPORT", message: "تعذّر إنشاء الطلب.", ambiguous: true };
}

export type MutateResult =
  | { ok: true; reconciled?: boolean }
  | { ok: false; code: string; message: string; ambiguous?: boolean };

/**
 * Identity headers for a storefront call. Session cookies are forwarded
 * (guest-order cookies excluded); the order-scoped guest credential is attached
 * only for the requested order. Never logged, never returned.
 */
async function storeIdentityHeaders(orderId?: string): Promise<Record<string, string>> {
  const jar = await cookies();
  const all = jar.getAll();
  const session = all
    .filter((c) => !isGuestOrderCookieName(c.name) && !ADMIN_SESSION_COOKIES.has(c.name))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const outbound: Record<string, string> = {};
  if (session !== "") outbound.Cookie = session;
  if (orderId) {
    const credential = jar.get(guestOrderCookieName(orderId));
    if (credential) outbound["x-guest-order-token"] = credential.value;
  }
  return outbound;
}

async function mutateOrder(
  orderId: string,
  path: string,
  method: "POST",
  body?: Record<string, unknown>,
): Promise<MutateResult> {
  if (!(await assertSameOrigin())) {
    return { ok: false, code: "FORBIDDEN", message: "طلب مرفوض." };
  }
  const base = await backendBase();
  if (!base) {
    return {
      ok: false,
      code: "TRANSPORT",
      message: "لم نتمكن من تأكيد نتيجة الإجراء بعد. جارٍ التحقق من الحالة.",
      ambiguous: true,
    };
  }
  const outbound: Record<string, string> = {
    "Content-Type": "application/json",
    ...(await storeIdentityHeaders(orderId)),
  };
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: outbound,
      body: body ? JSON.stringify(body) : undefined,
      redirect: "error",
      signal: AbortSignal.timeout(ORDER_REQUEST_TIMEOUT_MS),
    });
  } catch {
    // Timeout or transport failure: the backend may already have committed the
    // mutation. Never report success or a definite failure from this signal.
    return {
      ok: false,
      code: "TRANSPORT",
      message: "لم نتمكن من تأكيد نتيجة الإجراء بعد. جارٍ التحقق من الحالة.",
      ambiguous: true,
    };
  }
  if (res.ok) return { ok: true };
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    return {
      ok: false,
      code: "TRANSPORT",
      message: "لم نتمكن من تأكيد نتيجة الإجراء بعد. جارٍ التحقق من الحالة.",
      ambiguous: true,
    };
  }
  if (isRecord(payload) && isRecord(payload.error) && typeof payload.error.code === "string") {
    const code = payload.error.code;
    return { ok: false, code, message: mutationErrorMessage(code) };
  }
  return {
    ok: false,
    code: "TRANSPORT",
    message: "لم نتمكن من تأكيد نتيجة الإجراء بعد. جارٍ التحقق من الحالة.",
    ambiguous: true,
  };
}

interface OrderReadState {
  status: string;
  replacements: Array<{ id: string; status: string }>;
}

/**
 * Read-only reconciliation after an ambiguous mutation response. Uses the same
 * storefront read endpoint (authoritative snapshot) and returns null when the
 * outcome still cannot be established — callers keep the state unknown.
 */
async function readOrderState(orderId: string): Promise<OrderReadState | null> {
  const base = await backendBase();
  if (!base) return null;
  const outbound = await storeIdentityHeaders(orderId);
  try {
    const orderRes = await fetch(`${base}/api/store/orders/${orderId}`, {
      method: "GET",
      headers: outbound,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    if (!orderRes.ok) return null;
    const orderPayload: unknown = await orderRes.json();
    if (!isRecord(orderPayload) || !isRecord(orderPayload.data) || !isRecord(orderPayload.data.order)) {
      return null;
    }
    const status = orderPayload.data.order.status;
    if (typeof status !== "string") return null;
    const replRes = await fetch(`${base}/api/store/orders/${orderId}/replacements`, {
      method: "GET",
      headers: outbound,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    let replacements: Array<{ id: string; status: string }> = [];
    if (replRes.ok) {
      const replPayload: unknown = await replRes.json();
      if (isRecord(replPayload) && Array.isArray(replPayload.data)) {
        replacements = replPayload.data
          .filter(
            (row): row is { id: string; status: string } =>
              isRecord(row) && typeof row.id === "string" && typeof row.status === "string",
          )
          .map((row) => ({ id: row.id, status: row.status }));
      }
    }
    return { status, replacements };
  } catch {
    return null;
  }
}

const RECONCILE_DELAY_MS = 350;

export async function cancelOrderAction(orderId: string): Promise<MutateResult> {
  if (!UUID_RE.test(orderId)) return { ok: false, code: "VALIDATION", message: "معرف طلب غير صالح." };
  const res = await mutateOrder(orderId, `/api/store/orders/${orderId}/cancel`, "POST", {});
  if (res.ok || !res.ambiguous) return res;
  await new Promise((resolve) => setTimeout(resolve, RECONCILE_DELAY_MS));
  const state = await readOrderState(orderId);
  if (state?.status === "CANCELLED") return { ok: true, reconciled: true };
  return {
    ok: false,
    code: "TRANSPORT",
    message: "لم نتمكن من تأكيد نتيجة الإلغاء بعد. حدّث الحالة للتحقق.",
    ambiguous: true,
  };
}

export async function decideReplacementAction(
  orderId: string,
  replacementId: string,
  decision: "approve" | "reject",
): Promise<MutateResult> {
  if (!UUID_RE.test(orderId) || !UUID_RE.test(replacementId)) {
    return { ok: false, code: "VALIDATION", message: "معرف غير صالح." };
  }
  if (decision !== "approve" && decision !== "reject") {
    return { ok: false, code: "VALIDATION", message: "قرار غير صالح." };
  }
  const res = await mutateOrder(
    orderId,
    `/api/store/orders/${orderId}/replacements/${replacementId}/decide`,
    "POST",
    { action: decision },
  );
  if (res.ok || !res.ambiguous) return res;
  await new Promise((resolve) => setTimeout(resolve, RECONCILE_DELAY_MS));
  const state = await readOrderState(orderId);
  const replacement = state?.replacements.find((row) => row.id === replacementId);
  if (!replacement) {
    return {
      ok: false,
      code: "TRANSPORT",
      message: "لم نتمكن من تأكيد نتيجة القرار بعد. حدّث الحالة للتحقق.",
      ambiguous: true,
    };
  }
  if (
    (decision === "approve" &&
      (replacement.status === "CUSTOMER_APPROVED" || replacement.status === "AUTO_ACCEPTED")) ||
    (decision === "reject" && replacement.status === "CUSTOMER_REJECTED")
  ) {
    return { ok: true, reconciled: true };
  }
  if (replacement.status !== "PROPOSED") {
    return {
      ok: false,
      code: "CONFLICT",
      message: "تم تسجيل قرار مختلف على هذا الاقتراح. حدّث الحالة للتحقق.",
    };
  }
  return {
    ok: false,
    code: "TRANSPORT",
    message: "لم نتمكن من تأكيد نتيجة القرار بعد. حدّث الحالة للتحقق.",
    ambiguous: true,
  };
}
