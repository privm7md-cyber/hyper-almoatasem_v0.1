// FE-7 order adapter (server actions ONLY — the FP03-G1 planned adapter, minimal scope).
// Why server-side: the guest creation response carries the one-time raw credential, which must
// never reach client JS/URL/storage (FP-04 §14, FP03-G1 §7b). These actions call the EXISTING
// backend endpoints over same-origin HTTP (never direct lib writes — contract parity), attach
// identity server-side (session cookie passthrough / order cookie → header), and persist the
// guest credential solely as an HttpOnly order cookie. No backend change. No logging of secrets.

"use server";

import { cookies, headers } from "next/headers";
import { z } from "zod";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GUEST_COOKIE_PREFIX = "__Host-guest-order-";
const GUEST_TTL_SECONDS = 90 * 24 * 3600;

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
  | { ok: true; orderId: string; orderNumber: string; replay: boolean }
  | { ok: false; code: string; message: string; ambiguous?: boolean };

async function assertSameOrigin(): Promise<boolean> {
  const h = await headers();
  const host = h.get("host");
  const origin = h.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

async function backendBase(): Promise<string | null> {
  const h = await headers();
  const host = h.get("host");
  if (!host) return null;
  const proto = h.get("x-forwarded-proto") ?? (process.env.NODE_ENV === "production" ? "https" : "http");
  return `${proto}://${host}`;
}

async function forwardedCookie(): Promise<string> {
  const jar = await cookies();
  return jar
    .getAll()
    .filter((c) => !c.name.startsWith(GUEST_COOKIE_PREFIX))
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

  const outbound: Record<string, string> = { "Content-Type": "application/json" };
  const cookie = await forwardedCookie();
  if (cookie !== "") outbound.Cookie = cookie;
  if (parsed.data.cartToken) outbound["x-guest-token"] = parsed.data.cartToken;

  let res: Response;
  try {
    res = await fetch(`${base}/api/store/orders`, { method: "POST", headers: outbound, body: JSON.stringify(body) });
  } catch {
    return { ok: false, code: "TRANSPORT", message: "تعذّر الاتصال بالخادم.", ambiguous: true };
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
      jar.set(`${GUEST_COOKIE_PREFIX}${orderId}`, data.guestOrderToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: GUEST_TTL_SECONDS,
      });
    }
    return { ok: true, orderId, orderNumber, replay: false };
  }
  if (res.status === 200 && isRecord(payload.data)) {
    // Same-key replay: order exists; credential stays keep-same (no token reissued by contract).
    const data = payload.data;
    const order = isRecord(data.order) ? data.order : null;
    const orderId = typeof data.orderId === "string" ? data.orderId : typeof order?.id === "string" ? order.id : null;
    const orderNumber =
      typeof data.orderNumber === "string" ? data.orderNumber : typeof order?.orderNumber === "string" ? order.orderNumber : "";
    if (orderId && UUID_RE.test(orderId)) {
      return { ok: true, orderId, orderNumber, replay: true };
    }
  }
  if (isRecord(payload.error) && typeof payload.error.code === "string") {
    const message = typeof payload.error.message === "string" ? payload.error.message : "تعذّر إنشاء الطلب.";
    return { ok: false, code: payload.error.code, message };
  }
  return { ok: false, code: "TRANSPORT", message: "تعذّر إنشاء الطلب.", ambiguous: true };
}

export type MutateResult = { ok: true } | { ok: false; code: string; message: string };

async function mutateOrder(path: string, method: "POST", body?: Record<string, unknown>): Promise<MutateResult> {
  if (!(await assertSameOrigin())) {
    return { ok: false, code: "FORBIDDEN", message: "طلب مرفوض." };
  }
  const base = await backendBase();
  if (!base) return { ok: false, code: "TRANSPORT", message: "تعذّر الاتصال بالخادم." };
  const outbound: Record<string, string> = { "Content-Type": "application/json" };
  const jar = await cookies();
  const all = jar.getAll();
  const session = all
    .filter((c) => !c.name.startsWith(GUEST_COOKIE_PREFIX))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  if (session !== "") outbound.Cookie = session;
  // Order-scoped credential: the adapter attaches the matching order's cookie as the header.
  // Callers pass orderId via path; the cookie name binds it (validated UUID segment).
  const match = path.match(/\/orders\/([0-9a-f-]{36})(?:\/|$)/i);
  if (match) {
    const credential = jar.get(`${GUEST_COOKIE_PREFIX}${match[1].toLowerCase()}`);
    if (credential) outbound["x-guest-order-token"] = credential.value;
  }
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: outbound,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    return { ok: false, code: "TRANSPORT", message: "تعذّر الاتصال بالخادم." };
  }
  if (res.ok) return { ok: true };
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    return { ok: false, code: "TRANSPORT", message: "استجابة غير صالحة." };
  }
  if (isRecord(payload) && isRecord(payload.error) && typeof payload.error.code === "string") {
    const message = typeof payload.error.message === "string" ? payload.error.message : "تعذّرت العملية.";
    return { ok: false, code: payload.error.code, message };
  }
  return { ok: false, code: "TRANSPORT", message: "تعذّرت العملية." };
}

export async function cancelOrderAction(orderId: string): Promise<MutateResult> {
  if (!UUID_RE.test(orderId)) return { ok: false, code: "VALIDATION", message: "معرف طلب غير صالح." };
  return mutateOrder(`/api/store/orders/${orderId}/cancel`, "POST", {});
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
  return mutateOrder(`/api/store/orders/${orderId}/replacements/${replacementId}/decide`, "POST", { action: decision });
}
