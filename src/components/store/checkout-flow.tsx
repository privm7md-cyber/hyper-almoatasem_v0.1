// FE-7 checkout flow island ("use client"): review → address → coupon/fee preview → place.
//
// Safety model (Phase 10):
//  • Identity is resolved ONCE at load (session probe → me + addresses, else the
//    guest inline form). The session can still expire later; that is surfaced as
//    a login link, never silently retried as a guest.
//  • Every money figure shown comes from the estimate/create responses — local
//    math is never an authority. The estimate is keyed by a canonical JSON
//    fingerprint of the CURRENT terms; any mismatch marks the preview STALE
//    (visible label + disabled confirm), and an out-of-order response can never
//    replace a newer one (monotonic request sequence + abort).
//  • The idempotency key identifies the intent (address + guest identity +
//    coupon + variant/quantity set). It is rotated when those terms change, but
//    NEVER while an unresolved attempt is pending.
//  • An ambiguous outcome (transport, timeout, unreadable body, 5xx) is treated
//    as "the order MAY exist": the key is kept, persisted (key + timestamp only,
//    no PII) in sessionStorage, the form is locked, and only an explicit
//    same-key verification or an explicit new attempt can move forward.
//  • A definite rejection (4xx business/validation/auth) never created an order
//    for that key, so the lock is released after the error is explained.
//  • No payment UI is invented: the backend contract is order creation only.

"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, MapPin, Receipt, ShieldCheck, ShoppingBag } from "lucide-react";
import { AppError, apiRequest } from "@/lib/frontend/api-client";
import { STORE_CONTACT_PHONE } from "@/lib/store/contact";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { readGuestCartToken } from "@/components/store/guest-cart-token";
import { resetCartStore } from "@/lib/frontend/cart-lines-store";
import { notifyCartCount } from "@/components/store/cart-badge";
import { placeOrder } from "@/app/actions/orders";

interface MeAddress {
  id: string;
  label: string | null;
  city: string;
  area: string | null;
  village: string | null;
  street: string | null;
  buildingNumber: string | null;
  landmark: string | null;
  phone: string;
  isDefault: boolean;
}

interface Me {
  customer: { id: string; firstName: string; phone: string };
  addresses: MeAddress[];
}

interface CartLine {
  productVariantId: string;
  productName: string;
  variantName: string;
  quantity: string;
  unitPriceSnapshot: string | null;
  lineTotal: string | null;
}

interface CartResponse {
  cart: { id?: string; lines: CartLine[] };
}

interface Preview {
  subtotal: string;
  discountTotal: string;
  deliveryFee: string;
  total: string;
  coupon: { applicable: boolean; reason: string | null; amount: string } | null;
  deliveryEligibility?: {
    status: "ZONE_MATCHED" | "UNCONFIGURED" | "UNMATCHED";
    reason: string;
    zoneId: string | null;
    zoneName: string | null;
    serviceable: boolean;
  };
}

type IssueKind = "general" | "login" | "price" | "stock" | "consumed" | "cart" | "rate" | "no-access";

interface SubmitIssue {
  kind: IssueKind;
  text: string;
}

interface PendingAttempt {
  key: string;
  at: number;
}

interface GuestIdentity {
  city: string;
  phone: string;
  firstName: string;
  street: string;
  area: string;
  village: string;
  buildingNumber: string;
  landmark: string;
}

const LOGIN_HREF = "/login?next=%2Fcheckout";
const CART_HREF = "/cart";
const ORDERS_HREF = "/orders";
/** sessionStorage holds ONLY the unresolved idempotency key + timestamp (no PII,
 *  no address, no cart token, no order credential). */
const PENDING_STORAGE_KEY = "hyper_checkout_pending_v1";
const PENDING_KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;

function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

/**
 * sessionStorage-backed unresolved-attempt store. It holds ONLY the idempotency
 * key + timestamp (no PII, no address, no cart token, no order credential).
 * `useSyncExternalStore` keeps the lock consistent across reloads without a
 * setState-in-effect cascade; the snapshot object is cached per raw string so
 * React sees a stable reference while the stored value is unchanged.
 */
function parsePending(raw: string | null): PendingAttempt | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.key !== "string" || !PENDING_KEY_RE.test(record.key)) return null;
    return { key: record.key, at: typeof record.at === "number" ? record.at : Date.now() };
  } catch {
    return null;
  }
}

let pendingRawCache: string | null | undefined;
let pendingValueCache: PendingAttempt | null = null;
const pendingListeners = new Set<() => void>();

function getPendingSnapshot(): PendingAttempt | null {
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(PENDING_STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === pendingRawCache) return pendingValueCache;
  pendingRawCache = raw;
  pendingValueCache = parsePending(raw);
  return pendingValueCache;
}

function getServerPendingSnapshot(): PendingAttempt | null {
  return null;
}

function subscribePending(listener: () => void): () => void {
  pendingListeners.add(listener);
  return () => {
    pendingListeners.delete(listener);
  };
}

function emitPending(): void {
  for (const listener of pendingListeners) listener();
}

function rememberPending(attempt: PendingAttempt): void {
  try {
    window.sessionStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(attempt));
  } catch {
    // Storage unavailable: the in-memory lock still protects this tab.
  }
  emitPending();
}

function forgetPending(): void {
  try {
    window.sessionStorage.removeItem(PENDING_STORAGE_KEY);
  } catch {
    // Intentionally silent.
  }
  emitPending();
}

/**
 * Canonical terms fingerprint. Explicitly ordered keys + sorted variant ids make
 * it independent of object/array insertion order; prices are deliberately absent
 * (a server price change must NOT mint a new key — it is the same intent and is
 * resolved by the backend's 409 + a cart reprice, never by a silent second key).
 */
function buildTerms(input: {
  mode: "registered" | "guest";
  customerId?: string;
  cartId?: string;
  addressId?: string;
  guest?: GuestIdentity;
  coupon: string;
  lines: CartLine[];
}): string {
  const sortedLines = input.lines
    .map((l) => [l.productVariantId.toLowerCase(), l.quantity] as const)
    .sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  return JSON.stringify({
    v: 1,
    mode: input.mode,
    customerId: input.customerId ?? "",
    cartId: input.cartId ?? "",
    addressId: input.addressId ?? "",
    guest: input.guest
      ? {
          city: input.guest.city.trim(),
          phone: input.guest.phone.trim(),
          firstName: input.guest.firstName.trim(),
          street: input.guest.street.trim(),
          area: input.guest.area.trim(),
          village: input.guest.village.trim(),
          buildingNumber: input.guest.buildingNumber.trim(),
          landmark: input.guest.landmark.trim(),
        }
      : null,
    coupon: input.coupon.trim(),
    lines: sortedLines,
  });
}

function estimateMessage(error: unknown): string {
  if (error instanceof AppError) {
    switch (error.code) {
      case "NOT_FOUND":
        return "كود الكوبون غير موجود أو لم يعد صالحًا.";
      case "VALIDATION":
        return "تعذّرت المعاينة — تحقق من بيانات السلة.";
      case "RATE_LIMITED":
        return "محاولات كثيرة — انتظر قليلًا ثم أعد المعاينة.";
      default:
        return "تعذّرت المعاينة — تحقق من اتصالك ثم أعد المحاولة.";
    }
  }
  return "تعذّرت المعاينة — تحقق من اتصالك ثم أعد المحاولة.";
}

/**
 * Establish the guest checkout recovery session. Single-flight per page life:
 * a second call while one is in flight (or after success) reuses it, so an
 * older response can never overwrite the cookie AFTER a create bound it.
 * Failure is retried once by the submit path; it never blocks checkout (the
 * one-time 201 credential path still works, just without lost-response
 * recovery for that attempt).
 */
function primeGuestCheckoutSession(tracker: { current: Promise<boolean> | null }): Promise<boolean> {
  if (tracker.current) return tracker.current;
  const run = (async () => {
    const token = readGuestCartToken();
    if (!token) return false;
    try {
      await apiRequest<{ expiresAt: string; ttlHours: number }>("/api/store/orders/checkout-session", {
        method: "POST",
        headers: { "x-guest-token": token },
      });
      return true;
    } catch {
      return false;
    }
  })();
  tracker.current = run;
  void run.then((ok) => {
    if (!ok) tracker.current = null;
  });
  return run;
}

export function CheckoutFlow({
  initialCoupon = "",
  initialEmpty = false,
}: {
  initialCoupon?: string;
  initialEmpty?: boolean;
}) {
  const router = useRouter();
  const { notify } = useToast();
  const [phase, setPhase] = useState<"loading" | "ready" | "failed">(() => (initialEmpty ? "ready" : "loading"));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [cartId, setCartId] = useState<string>("");
  const [addressId, setAddressId] = useState<string>("");
  const [guest, setGuest] = useState<GuestIdentity>({
    city: "",
    phone: "",
    firstName: "",
    street: "",
    area: "",
    village: "",
    buildingNumber: "",
    landmark: "",
  });
  const [coupon, setCoupon] = useState(initialCoupon);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewNote, setPreviewNote] = useState<string | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [freshTerms, setFreshTerms] = useState<string | null>(null);
  const [issue, setIssue] = useState<SubmitIssue | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [repricePending, setRepricePending] = useState(false);
  const pending = useSyncExternalStore(subscribePending, getPendingSnapshot, getServerPendingSnapshot);
  const [key, setKey] = useState<string>(newIdempotencyKey);
  const inFlight = useRef(false);
  const lastFingerprint = useRef<string>("");
  const estimateSeq = useRef(0);
  const estimateAbort = useRef<AbortController | null>(null);
  // Guest recovery session (single-flight): established BEFORE the create so a
  // lost 201 can still be opened. Never minted for registered customers and
  // never minted on the resolve path (a consumed cart cannot bind a session).
  const recoveryPrime = useRef<Promise<boolean> | null>(null);

  // Load the review (cart lines + optional session identity). A fresh visitor has
  // no owner at all: the cart endpoint answers VALIDATION and this is an honest
  // empty review, not a dead error.
  useEffect(() => {
    let alive = true;
    if (initialEmpty) {
      const token = readGuestCartToken();
      if (!token) {
        // Confirmed empty cart for fresh visitor: remain in ready empty state without redundant network fetch
        return;
      }
    }
    (async () => {
      try {
        const token = readGuestCartToken();
        // Third-Agent perf: cart + session identity are independent reads.
        // Sequential awaits created a waterfall (2× RTT under throttling).
        // Run concurrently; session failure still resolves to null (guest).
        const [cartRes, meRes] = await Promise.all([
          apiRequest<CartResponse>("/api/store/cart", {
            headers: token ? { "x-guest-token": token } : {},
          }),
          apiRequest<Me>("/api/store/customers/session").catch(() => null),
        ]);
        if (!alive) return;
        setLines(cartRes.data.cart.lines);
        setCartId(cartRes.data.cart.id ?? "");
        if (meRes) {
          setMe(meRes.data);
          const def = meRes.data.addresses.find((a) => a.isDefault) ?? meRes.data.addresses[0] ?? null;
          setAddressId(def ? def.id : "");
        } else if (token) {
          // Guest: prime the recovery session while the review renders. Failures
          // are retried once at submit; checkout itself never depends on it.
          void primeGuestCheckoutSession(recoveryPrime);
        }
        setPhase("ready");
      } catch (error) {
        if (!alive) return;
        // No identity / no cart yet (fresh visitor): honest empty, not a dead error.
        if (
          error instanceof AppError &&
          (error.code === "VALIDATION" || error.code === "NOT_FOUND" || error.code === "UNAUTHENTICATED")
        ) {
          setLines([]);
          setPhase("ready");
          return;
        }
        setLoadError(error instanceof AppError ? error.message : "تعذّر تحميل بيانات المراجعة.");
        setPhase("failed");
      }
    })();
    return () => {
      alive = false;
    };
  }, [initialEmpty]);

  // Recover an unresolved attempt recorded by a previous page life (reload/close
  // while a create request was in flight) through the external store above.

  const terms = useMemo(
    () =>
      buildTerms({
        mode: me ? "registered" : "guest",
        customerId: me?.customer.id,
        cartId,
        addressId: me ? addressId : undefined,
        guest: me ? undefined : guest,
        coupon,
        lines,
      }),
    [me, cartId, addressId, guest, coupon, lines],
  );

  // D02/D10: the estimate must reflect the CURRENT terms before submit is possible.
  // Staleness is derived against the terms of the last CONFIRMED estimate response
  // (set only from async request callbacks, never during render).
  const previewStale = preview === null || freshTerms !== terms;

  // Terms changed after (or before) an attempt → fresh key. An unresolved attempt
  // freezes the key: rotating it would make the previous order impossible to
  // replay and could allow a second order.
  useEffect(() => {
    if (pending) return;
    if (lastFingerprint.current !== "" && lastFingerprint.current !== terms) {
      setKey(newIdempotencyKey());
    }
    lastFingerprint.current = terms;
  }, [terms, pending]);

  function beginEstimate(): AbortController {
    estimateAbort.current?.abort();
    const controller = new AbortController();
    estimateAbort.current = controller;
    return controller;
  }

  async function fetchEstimate(ls: CartLine[], couponCode: string, signal: AbortSignal) {
    const token = readGuestCartToken();
    // Address context feeds the SAME zone resolver the create uses. Registered:
    // owned address id (resolved server-side). Guest: explicit locality only.
    const addressContext: Record<string, unknown> = me
      ? addressId === ""
        ? {}
        : { addressId }
      : guest.city.trim() === ""
        ? {}
        : {
            deliveryAddress: {
              city: guest.city.trim(),
              ...(guest.area.trim() === "" ? {} : { area: guest.area.trim() }),
              ...(guest.village.trim() === "" ? {} : { village: guest.village.trim() }),
            },
          };
    return apiRequest<Preview>("/api/store/orders/estimate", {
      method: "POST",
      body: {
        lines: ls.map((l) => ({ productVariantId: l.productVariantId, quantity: l.quantity })),
        ...(couponCode === "" ? {} : { couponCode }),
        ...addressContext,
      },
      headers: token ? { "x-guest-token": token } : {},
      signal,
    });
  }

  /**
   * Fetch + apply an estimate for an exact terms snapshot. Sequence-guarded: a
   * slower response for older terms can never overwrite a newer one. A failed
   * refresh invalidates the preview (never leaves a same-terms "fresh" lie).
   */
  async function runEstimate(
    ls: CartLine[],
    couponCode: string,
    termsAt: string,
    signal: AbortSignal,
  ): Promise<boolean> {
    const seq = ++estimateSeq.current;
    setEstimating(true);
    try {
      const res = await fetchEstimate(ls, couponCode, signal);
      if (seq !== estimateSeq.current || signal.aborted) return false;
      setPreview(res.data);
      setFreshTerms(termsAt);
      if (res.data.coupon && !res.data.coupon.applicable) {
        setPreviewNote(res.data.coupon.reason ? "الكوبون غير قابل للتطبيق على هذا الطلب." : "الكوبون غير صالح.");
      } else {
        setPreviewNote(null);
      }
      return true;
    } catch (error) {
      if (seq !== estimateSeq.current || signal.aborted) return false;
      // No stale total may remain authoritative after a failed refresh.
      setPreview(null);
      setFreshTerms(null);
      setPreviewNote(estimateMessage(error));
      return false;
    } finally {
      if (seq === estimateSeq.current) setEstimating(false);
    }
  }

  function refreshPreview() {
    if (lines.length === 0) return;
    setPreviewNote(null);
    const controller = beginEstimate();
    void runEstimate(lines, coupon.trim(), terms, controller.signal);
  }

  // D02/D10: auto-refresh the estimate whenever any order term changes
  // (debounced). The estimate comes ONLY from the estimate endpoint — no local
  // math acts as authority.
  useEffect(() => {
    if (lines.length === 0) return;
    const linesSnapshot = lines;
    const couponSnapshot = coupon.trim();
    const termsAt = terms;
    const controller = beginEstimate();
    const timer = setTimeout(() => {
      void runEstimate(linesSnapshot, couponSnapshot, termsAt, controller.signal);
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // The effect intentionally fires per-terms-change only; lines/coupon are read
    // through the snapshot taken at the terms commit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terms]);

  function guestPayload(): {
    guestAddress: {
      city: string;
      street: string | null;
      area: string | null;
      village: string | null;
      buildingNumber: string | null;
      landmark: string | null;
      phone: string;
    };
    guestContact: { firstName: string };
    cartToken: string | null;
  } | null {
    if (guest.city.trim() === "" || guest.phone.trim() === "" || guest.firstName.trim() === "") return null;
    const opt = (v: string) => (v.trim() === "" ? null : v.trim());
    return {
      guestAddress: {
        city: guest.city.trim(),
        street: opt(guest.street),
        // D33: the full optional address fields from FP-00-D015 (label/isDefault
        // are an address-book concept and stay out of the inline guest payload).
        area: opt(guest.area),
        village: opt(guest.village),
        buildingNumber: opt(guest.buildingNumber),
        landmark: opt(guest.landmark),
        phone: guest.phone.trim(),
      },
      guestContact: { firstName: guest.firstName.trim() },
      cartToken: readGuestCartToken(),
    };
  }

  function currentPayload(
    attemptKey: string,
    reviewedFee: string | null,
  ): Parameters<typeof placeOrder>[0] | null {
    // The reviewed fee is an ASSERTION, never an amount the server charges: if
    // the backend fee moved since this preview, create rejects 409 and the
    // customer re-confirms the new total.
    const fee = { expectedDeliveryFee: reviewedFee };
    if (me) {
      if (addressId === "") return null;
      return {
        addressId,
        couponCode: coupon.trim() === "" ? null : coupon.trim(),
        idempotencyKey: attemptKey,
        cartToken: null,
        ...fee,
      };
    }
    const guestPart = guestPayload();
    if (!guestPart) return null;
    return {
      ...guestPart,
      couponCode: coupon.trim() === "" ? null : coupon.trim(),
      idempotencyKey: attemptKey,
      ...fee,
    };
  }

  /**
   * The delivery fee the server quotes for the CURRENT terms. The create
   * contract asserts it (a mismatch → 409 DELIVERY_FEE_CHANGED), so a
   * dispatched request always carries a server-quoted value:
   *  • a fresh preview in hand → its deliveryFee (no extra request);
   *  • a stale/absent preview while the cart still has lines → a dedicated
   *    read-only estimate for the current terms (NOT the shared debounced
   *    request: it must not race the preview state);
   *  • no cart lines at all (the ambiguous attempt consumed the cart) → null:
   *    the server resolves the attempt BEFORE any pricing, so the assertion is
   *    never compared and no order can be created from it.
   * A failed estimate is NOT a rejection — the caller keeps the attempt
   * pending instead of dispatching an unpriced request.
   */
  async function quotedDeliveryFee(): Promise<{ ok: true; fee: string | null } | { ok: false }> {
    if (!previewStale && preview !== null) return { ok: true, fee: preview.deliveryFee };
    if (lines.length === 0) return { ok: true, fee: null };
    try {
      const res = await fetchEstimate(lines, coupon.trim(), AbortSignal.timeout(8_000));
      return { ok: true, fee: res.data.deliveryFee };
    } catch {
      return { ok: false };
    }
  }

  function releasePending(): void {
    forgetPending();
  }

  function handleDefiniteFailure(
    result: Extract<Awaited<ReturnType<typeof placeOrder>>, { ok: false }>,
    fromResolve: boolean,
  ): void {
    // A definite rejection proves no order exists for this key+cart (the backend
    // checks the key BEFORE any business validation). Identity/throttle failures
    // are the exception: the lookup never happened, so the unresolved attempt
    // must survive for a later same-key verification.
    const keepLock = fromResolve && (result.code === "UNAUTHENTICATED" || result.code === "RATE_LIMITED");
    if (!keepLock) releasePending();

    switch (result.code) {
      case "UNAUTHENTICATED":
        setIssue({
          kind: "login",
          text: "انتهت جلسة تسجيل الدخول. سجّل الدخول للمتابعة — سلتك محفوظة ولن يتكرر الطلب.",
        });
        return;
      case "RATE_LIMITED":
        setIssue({ kind: "rate", text: "محاولات كثيرة — انتظر قليلًا ثم أعد المحاولة." });
        return;
      case "VALIDATION":
        setIssue({ kind: "general", text: "بيانات الطلب غير مكتملة أو غير صالحة — راجع الحقول وحاول مجددًا." });
        return;
      case "NOT_FOUND":
        setIssue({
          kind: "cart",
          text: "لم يعد العنوان أو السلة متاحًا — حدّث الصفحة واختر عنوانًا صالحًا.",
        });
        return;
      case "FORBIDDEN":
        setIssue({ kind: "general", text: "طلب مرفوض. حدّث الصفحة وحاول مجددًا." });
        return;
      case "CONFLICT": {
        const details = result.details ?? {};
        if (details.reason === "DELIVERY_FEE_CHANGED") {
          // Preview/create disagreement: the backend value is authoritative but
          // is NEVER applied silently — refresh the estimate and make the
          // customer confirm the new total (the submit guard requires a fresh
          // estimate for these exact terms).
          if (lines.length > 0) {
            const controller = beginEstimate();
            void runEstimate(lines, coupon.trim(), terms, controller.signal);
          }
          setIssue({
            kind: "price",
            text: "تغيّرت رسوم التوصيل بعد المعاينة. حدّثنا التقدير — راجع الإجمالي الجديد ثم أعد التأكيد.",
          });
          return;
        }
        if (details.reason === "DELIVERY_ELIGIBILITY_CHANGED") {
          if (lines.length > 0) {
            const controller = beginEstimate();
            void runEstimate(lines, coupon.trim(), terms, controller.signal);
          }
          setIssue({
            kind: "price",
            text: "تغيّر نطاق التوصيل بعد المعاينة. حدّثنا التقدير — راجع العنوان والإجمالي ثم أعد التأكيد.",
          });
          return;
        }
        if (typeof details.key === "string") {
          // The key belongs to a different cart: it must never be reused.
          setKey(newIdempotencyKey());
          setIssue({
            kind: "cart",
            text: "تعارض في مفتاح المحاولة — أعدنا تهيئة المحاولة. راجع السلة ثم أعد التأكيد.",
          });
          return;
        }
        if (typeof details.cartId === "string") {
          setIssue({
            kind: "consumed",
            text: "هذه السلة استُهلكت بالفعل — ربما أُنشئ الطلب من نافذة أخرى. راجع طلباتك قبل أي محاولة جديدة.",
          });
          return;
        }
        // Price drift / availability: re-estimate (read-only) and point to the
        // cart; a reprice is offered explicitly, never applied silently.
        if (lines.length > 0) {
          const controller = beginEstimate();
          void runEstimate(lines, coupon.trim(), terms, controller.signal);
        }
        if (typeof details.productVariantId === "string") {
          setIssue({
            kind: "stock",
            text: "الكمية المطلوبة لم تعد متاحة — راجع السلة وقلّل الكمية ثم أعد المحاولة.",
          });
        } else {
          setIssue({
            kind: "price",
            text: "تغيّرت أسعار أو شروط الطلب بعد المعاينة. حدّثنا التقدير — راجع السلة وحدّث الأسعار قبل التأكيد.",
          });
        }
        return;
      }
      case "BUSINESS_RULE": {
        const message = result.message.toLowerCase();
        if (
          result.details?.deliveryEligibility === "UNMATCHED" ||
          message.includes("delivery areas")
        ) {
          setIssue({
            kind: "general",
            text: "العنوان خارج مناطق التوصيل المفعّلة حاليًا — راجع العنوان أو اختر منطقة مخدومة.",
          });
          return;
        }
        if (message.includes("coupon")) {
          setIssue({
            kind: "general",
            text: "تعذّر تطبيق الكوبون — أزل الكوبون أو جرّب كوبونًا آخر ثم أعد المحاولة.",
          });
          return;
        }
        if (message.includes("inactive") || message.includes("not active")) {
          setIssue({
            kind: "general",
            text: `الحساب غير نشط — تواصل مع المتجر على ${STORE_CONTACT_PHONE} لإتمام الطلب.`,
          });
          return;
        }
        setIssue({
          kind: "general",
          text: "الطلب غير مقبول حاليًا وفق قواعد المتجر. راجع السلة والكوبون ثم أعد المحاولة.",
        });
        return;
      }
      default:
        setIssue({ kind: "general", text: "تعذّر إنشاء الطلب — راجع السلة وحاول مجددًا." });
    }
  }

  /**
   * Pre-submit cart preflight. The review (and its estimate) was loaded in this
   * tab, but the cart is server-owned: another tab/device may have changed a
   * line while this page stayed open. Variant + quantity are compared against
   * the live cart and any drift blocks the submit, refreshes the review and
   * forces a new estimate — the backend can never receive terms the customer
   * did not see. (Prices are intentionally NOT part of this check: a price move
   * is the same intent and is surfaced by the create-time 409 + reprice.)
   */
  async function fetchLiveCart(): Promise<
    { cartId: string; lines: CartLine[] } | "no-cart" | "session-expired" | null
  > {
    try {
      const token = readGuestCartToken();
      const res = await apiRequest<CartResponse>("/api/store/cart", {
        headers: token ? { "x-guest-token": token } : {},
        signal: AbortSignal.timeout(8_000),
      });
      return { cartId: res.data.cart.id ?? "", lines: res.data.cart.lines };
    } catch (error) {
      if (error instanceof AppError) {
        // A registered review that suddenly has NO identity means the session
        // expired (the cart route answers 400/401 when neither side is
        // presented) — that must never be misreported as a consumed cart.
        if (error.code === "UNAUTHENTICATED" || (me && error.code === "VALIDATION")) {
          return me ? "session-expired" : "no-cart";
        }
        if (error.code === "NOT_FOUND") return "no-cart";
      }
      return null;
    }
  }

  function sameLineSet(a: CartLine[], b: CartLine[]): boolean {
    if (a.length !== b.length) return false;
    const key = (l: CartLine) => `${l.productVariantId.toLowerCase()}|${l.quantity}`;
    const left = a.map(key).sort();
    const right = b.map(key).sort();
    return left.every((v, i) => v === right[i]);
  }

  async function submit(mode: "new" | "resolve"): Promise<void> {
    if (inFlight.current || submitting || repricePending) return;
    if (mode === "new" && pending) {
      setIssue({ kind: "general", text: "توجد محاولة غير مؤكدة — تحقق منها أو ابدأ طلبًا جديدًا أولًا." });
      return;
    }
    setIssue(null);
    // The preview in hand at submit time. Captured before any await so the
    // asserted fee is the one that was fresh for these terms.
    const livePreview = preview;
    if (mode === "new") {
      if (lines.length === 0) {
        setIssue({ kind: "general", text: "السلة فارغة — لا يمكن إنشاء الطلب." });
        return;
      }
      // D10: an order is never created without a live estimate of ITS terms.
      if (previewStale || livePreview === null) {
        setIssue({ kind: "general", text: "قدّر الإجمالي أولًا — انتظر اكتمال المعاينة ثم أعد المحاولة." });
        return;
      }
    }
    if (mode === "resolve" && !pending) {
      setIssue({ kind: "general", text: "لا توجد محاولة سابقة للتحقق منها." });
      return;
    }
    const attemptKey = mode === "resolve" ? pending!.key : key;

    inFlight.current = true;
    setSubmitting(true);
    const attempt: PendingAttempt = { key: attemptKey, at: Date.now() };
    try {
      // D2: the request asserts the fee the server quotes for the CURRENT
      // terms. A new order always has one (the guard above); a verification
      // reads a live quote first so it is never built without a price.
      let reviewedFee: string | null;
      if (mode === "new") {
        reviewedFee = livePreview === null ? null : livePreview.deliveryFee;
      } else {
        const quoted = await quotedDeliveryFee();
        if (!quoted.ok) {
          // A failed quote is NOT a rejection: the attempt stays pending.
          setIssue({
            kind: "general",
            text: "تعذّر التحقق من رسوم التوصيل قبل التحقق من المحاولة السابقة — تحقق من اتصالك ثم أعد المحاولة.",
          });
          return;
        }
        reviewedFee = quoted.fee;
      }
      const payload = currentPayload(attemptKey, reviewedFee);
      if (payload === null) {
        setIssue(
          me
            ? { kind: "general", text: "اختر عنوان التوصيل." }
            : { kind: "general", text: "أكمل المدينة والهاتف والاسم الأول." },
        );
        return;
      }

      if (mode === "new") {
        const live = await fetchLiveCart();
        if (live === "session-expired") {
          setIssue({
            kind: "login",
            text: "انتهت جلسة تسجيل الدخول قبل إرسال الطلب — سجّل الدخول للمتابعة. لم يُنشأ أي طلب.",
          });
          return;
        }
        if (live === "no-cart") {
          setIssue({
            kind: "consumed",
            text: "السلة لم تعد متاحة — ربما أُنشئ الطلب من نافذة أخرى. راجع طلباتك قبل أي محاولة جديدة.",
          });
          return;
        }
        if (live === null) {
          setIssue({ kind: "general", text: "تعذّر التحقق من السلة قبل الإرسال — تحقق من اتصالك ثم أعد المحاولة." });
          return;
        }
        if (!sameLineSet(live.lines, lines)) {
          setLines(live.lines);
          setCartId(live.cartId);
          setIssue({
            kind: "cart",
            text: "تغيّرت عناصر السلة في نافذة أو جهاز آخر — حدّثنا المراجعة ولم يُرسل الطلب. راجع الكميات ثم أعد التأكيد.",
          });
          return;
        }
      }
      if (mode === "new" && !me) {
        // Establish the recovery session BEFORE the create request: if the 201
        // is lost in transit, this cookie is how the order gets opened. It is
        // single-flight with the load-time mint (no overwrite race).
        await primeGuestCheckoutSession(recoveryPrime);
      }
      const result = await placeOrder(payload);
      if (result.ok) {
        releasePending();
        // The ACTIVE cart was consumed server-side (BA-6): the shared cart-lines
        // store must stop showing IN_CART quantities for a cart that no longer
        // exists (Phase 07 §12 — old cache never outlives a confirmed success).
        resetCartStore();
        notifyCartCount(0);
        if (result.replay) {
          if (!result.credentialAvailable) {
            // Keep-same contract: a lost 201 credential is never reissued. The
            // order is real and singular; do not pretend this device can open it.
            setIssue({
              kind: "no-access",
              text: `تم تأكيد أن الطلب السابق (${result.orderNumber || "بدون رقم ظاهر"}) موجود ولم يُنشأ طلب جديد. رمز الوصول الأصلي غير متاح على هذا الجهاز — تواصل مع المتجر على ${STORE_CONTACT_PHONE} مع رقم الطلب.`,
            });
            return;
          }
          notify("success", "تم تأكيد الطلب السابق — لم يُنشأ طلب جديد.");
        } else {
          notify("success", "تم إنشاء الطلب.");
        }
        router.push(`/order-confirmation/${result.orderId}`);
        return;
      }

      const uncertain =
        result.ambiguous === true || result.code === "TRANSPORT" || result.code === "INTERNAL";
      if (uncertain) {
        // The server may have committed. Freeze the attempt; same-key verification
        // is the only safe way forward.
        rememberPending(attempt);
        setIssue({
          kind: "general",
          text: "لم نستلم تأكيدًا نهائيًا من الخادم — قد يكون الطلب قد أُنشئ. لا تُرسل طلبًا جديدًا قبل التحقق من النتيجة.",
        });
        return;
      }
      handleDefiniteFailure(result, mode === "resolve");
    } catch {
      // The server action itself threw (transport/abort): same ambiguity policy.
      rememberPending(attempt);
      setIssue({
        kind: "general",
        text: "انقطع الاتصال بعد الإرسال — النتيجة غير مؤكدة. لا تُعد الإرسال بمفتاح جديد قبل التحقق.",
      });
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  function startNewAttempt(): void {
    if (inFlight.current) return;
    releasePending();
    setKey(newIdempotencyKey());
    setIssue({
      kind: "general",
      text: "بدأت محاولة جديدة بمفتاح جديد. إن كان الطلب السابق قد أُنشئ فعليًا فقد ترفض السلة إنشاء طلب آخر — راجع طلباتك أولًا.",
    });
  }

  async function repriceCart(): Promise<void> {
    if (repricePending) return;
    setRepricePending(true);
    try {
      const token = readGuestCartToken();
      const res = await apiRequest<CartResponse>("/api/store/cart/reprice", {
        method: "POST",
        body: {},
        headers: token ? { "x-guest-token": token } : {},
      });
      const nextLines = res.data.cart.lines;
      setLines(nextLines);
      setCartId(res.data.cart.id ?? cartId);
      setIssue(null);
      const nextTerms = buildTerms({
        mode: me ? "registered" : "guest",
        customerId: me?.customer.id,
        cartId: res.data.cart.id ?? cartId,
        addressId: me ? addressId : undefined,
        guest: me ? undefined : guest,
        coupon,
        lines: nextLines,
      });
      const controller = beginEstimate();
      await runEstimate(nextLines, coupon.trim(), nextTerms, controller.signal);
    } catch (error) {
      if (error instanceof AppError && error.code === "NOT_FOUND") {
        setIssue({
          kind: "consumed",
          text: "السلة لم تعد متاحة — ربما أُنشئ الطلب بالفعل. راجع طلباتك قبل أي محاولة جديدة.",
        });
      } else {
        setIssue({ kind: "general", text: "تعذّر تحديث الأسعار — تحقق من اتصالك ثم أعد المحاولة." });
      }
    } finally {
      setRepricePending(false);
    }
  }

  const canResolve = me ? addressId !== "" : guest.city.trim() !== "" && guest.phone.trim() !== "" && guest.firstName.trim() !== "";

  if (phase === "loading") {
    return (
      <div
        key="co-loading"
        className="mt-6 grid content-start gap-6"
        aria-busy="true"
        data-checkout-phase="loading"
      >
        <p className="sr-only">جارٍ تحميل المراجعة…</p>
        {/* P12-03 R3: 1:1 geometry-matched loading skeleton replacing arbitrary fixed min-height wrappers. */}
        <div
          aria-hidden="true"
          className="h-[74px] animate-pulse rounded-card border border-line bg-purple-surface/55 sm:h-[54px]"
        />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
          <div className="grid gap-6">
            <div className="rounded-card border border-line bg-white p-5">
              <div className="mb-4 h-6 w-40 animate-pulse rounded-control bg-purple-surface" />
              <div className="grid gap-2.5">
                {[0, 1].map((row) => (
                  <div
                    key={row}
                    className="h-[58px] animate-pulse rounded-control bg-purple-surface/75"
                  />
                ))}
              </div>
            </div>
            <div className="rounded-card border border-line bg-white p-5">
              <div className="mb-2 h-6 w-36 animate-pulse rounded-control bg-purple-surface" />
              <div className="mb-4 h-4 w-56 animate-pulse rounded bg-purple-surface/65" />
              <div className="grid gap-3 sm:grid-cols-2">
                {Array.from({ length: 8 }, (_, i) => (
                  <div
                    key={i}
                    className="h-[66px] animate-pulse rounded-control bg-purple-surface/75"
                  />
                ))}
              </div>
              <div className="mt-3 h-[76px] animate-pulse rounded-control bg-purple-surface/65" />
            </div>
          </div>
          <aside className="rounded-card border border-line bg-white p-5 lg:sticky lg:top-24">
            <div className="mb-3 h-6 w-32 animate-pulse rounded-control bg-purple-surface" />
            <div className="grid gap-3">
              <div className="h-[44px] animate-pulse rounded-control bg-purple-surface/80" />
              <div className="h-[44px] animate-pulse rounded-control bg-purple-surface/75" />
            </div>
            <div className="mt-3 h-[168px] animate-pulse rounded-card bg-purple-surface/55" />
            <div className="mt-4 h-[48px] animate-pulse rounded-control bg-purple-surface" />
            <div className="mt-3 h-4 w-48 animate-pulse rounded bg-purple-surface/70" />
            <div className="mt-2.5 h-10 animate-pulse rounded-control bg-purple-surface/55" />
          </aside>
        </div>
      </div>
    );
  }

  if (phase === "failed") {
    return (
      <div key="co-failed" data-checkout-phase="failed" className="mt-6 py-4">
        <ErrorState
          title="تعذّر تحميل المراجعة"
          text={loadError ?? "حاول مجددًا."}
          onRetry={() => window.location.reload()}
        />
      </div>
    );
  }

  if (lines.length === 0 && !pending) {
    return (
      <div key="co-empty" data-checkout-phase="empty" className="mt-6 py-4">
        <EmptyState
          title="السلة فارغة"
          hint="أضف منتجات قبل إتمام الطلب."
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Link
                href={CART_HREF}
                className="vxp-primary-btn inline-flex min-h-[44px] items-center justify-center rounded-control bg-brand px-5 font-semibold text-white"
              >
                راجع السلة
              </Link>
              <Link
                href="/categories"
                className="inline-flex min-h-[44px] items-center justify-center rounded-control border border-line-strong px-5 font-semibold text-ink"
              >
                تصفّح الأقسام
              </Link>
            </div>
          }
        />
      </div>
    );
  }

  const deliveryBlocked =
    !previewStale && Boolean(preview?.deliveryEligibility && !preview.deliveryEligibility.serviceable);
  const activeStep = lines.length === 0 ? 1 : !canResolve || deliveryBlocked ? 2 : 3;
  const estimateState = estimating
    ? "estimating"
    : previewStale
      ? "stale"
      : preview
        ? "ready"
        : "idle";

  const stepperItems = [
    {
      step: 1,
      title: "مراجعة السلة",
      fullLabel: "مراجعة السلة والمنتجات",
      complete: lines.length > 0 && activeStep > 1,
      Icon: ShoppingBag,
    },
    {
      step: 2,
      title: "العنوان والتوصيل",
      fullLabel: "بيانات العميل والعنوان والتوصيل",
      complete: canResolve && !deliveryBlocked && activeStep > 2,
      Icon: MapPin,
    },
    {
      step: 3,
      title: "المعاينة والتأكيد",
      fullLabel: "الدفع ومراجعة الفاتورة والتأكيد",
      complete: false,
      Icon: Receipt,
    },
  ] as const;

  const inputClass =
    "min-h-[44px] w-full rounded-control border border-line bg-white px-3 text-sm text-ink transition-[border-color,box-shadow] duration-[var(--motion-fast,170ms)] focus-visible:border-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand focus-visible:ring-2 focus-visible:ring-brand/15";

  return (
    <div
      key="co-ready"
      data-checkout-phase="ready"
      className="mt-6 grid content-start gap-6"
      data-checkout-step={activeStep}
    >
      <nav aria-label="خطوات إتمام الطلب" data-testid="checkout-stepper">
        <ol className="grid grid-cols-3 gap-1.5 rounded-card border border-line bg-white p-2.5 shadow-xs sm:gap-4 sm:px-5 sm:py-3">
          {stepperItems.map((item) => {
            const isCurrent = activeStep === item.step;
            const stateText = item.complete ? "مكتمل" : isCurrent ? "الخطوة الحالية" : "قادم";
            const StepIcon = item.Icon;
            return (
              <li
                key={item.step}
                aria-current={isCurrent ? "step" : undefined}
                className="flex min-w-0 flex-col items-center justify-center gap-1 rounded-control px-1 py-0.5 text-center sm:flex-row sm:justify-start sm:gap-2.5 sm:px-0 sm:py-0 sm:text-start"
              >
                <span
                  aria-hidden="true"
                  className={
                    item.complete
                      ? "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white"
                      : isCurrent
                        ? "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-white ring-4 ring-brand/15"
                        : "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line-strong bg-purple-surface/60 text-xs font-bold text-secondary"
                  }
                >
                  {item.complete ? <Check size={14} strokeWidth={2.5} /> : <StepIcon size={14} />}
                </span>
                <span
                  className={`w-full text-[11px] leading-[1.35] break-words sm:w-auto sm:text-sm sm:leading-snug ${
                    isCurrent
                      ? "font-bold text-brand-deep"
                      : item.complete
                        ? "font-semibold text-ink"
                        : "font-medium text-secondary"
                  }`}
                >
                  {item.title}
                </span>
                <span className="sr-only">{`${item.fullLabel} (${stateText})`}</span>
              </li>
            );
          })}
        </ol>
      </nav>

      {pending ? (
        <section
          role="alert"
          aria-labelledby="co-pending"
          className="rounded-card border border-warning-fg bg-white p-5 shadow-xs"
        >
          <h2 id="co-pending" className="font-bold">
            محاولة طلب غير مؤكدة
          </h2>
          <p className="mt-2 text-sm">
            لم نستلم تأكيدًا نهائيًا من الخادم. قد يكون الطلب قد أُنشئ فعلًا. لا تُرسل طلبًا جديدًا قبل التحقق —
            التحقق يستخدم نفس مفتاح المحاولة، لذلك لا يمكن أن يُنشئ طلبًا ثانيًا لنفس السلة.
          </p>
          {issue && issue.kind === "login" ? (
            <p className="mt-2 text-sm">
              <Link href={LOGIN_HREF} className="font-semibold text-brand">
                سجّل الدخول للتحقق من الطلب
              </Link>
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void submit("resolve")}
              disabled={submitting || !canResolve}
              className="min-h-[44px] rounded-control bg-brand px-4 font-semibold text-white disabled:opacity-55"
            >
              {submitting ? "جارٍ التحقق…" : "تحقق من نتيجة الطلب السابق"}
            </button>
            <button
              type="button"
              onClick={startNewAttempt}
              disabled={submitting}
              className="min-h-[44px] rounded-control border border-line-strong bg-white px-4 font-semibold disabled:opacity-55"
            >
              بدء طلب جديد
            </button>
            <Link href={ORDERS_HREF} className="inline-flex min-h-[44px] min-w-[44px] items-center font-semibold text-brand">
              طلباتي
            </Link>
          </div>
          {!canResolve ? (
            <p className="mt-2 text-xs text-secondary">
              {me
                ? "اختر عنوان التوصيل بالأسفل ثم اضغط «تحقق من نتيجة الطلب السابق»."
                : "أدخل المدينة والهاتف والاسم الأول بالأسفل ثم اضغط «تحقق من نتيجة الطلب السابق»."}
            </p>
          ) : null}
          <p className="mt-2 text-xs text-secondary">
            «بدء طلب جديد» يتخلى عن التحقق وقد يؤدي إلى طلب منفصل إن كان السابق قد أُنشئ — استخدمه فقط إذا تأكدت.
          </p>
        </section>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
        <div className="grid min-w-0 gap-6">
          <section
            aria-labelledby="co-lines"
            className="min-w-0 rounded-card border border-line bg-white p-5 shadow-xs"
          >
            <div className="flex items-center justify-between gap-2 border-b border-line/70 pb-3">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-control bg-purple-surface text-brand" aria-hidden="true">
                  <ShoppingBag size={16} />
                </span>
                <h2 id="co-lines" className="text-base font-bold text-brand-deep">
                  عناصر السلة ({lines.length})
                </h2>
              </div>
              <Link
                href={CART_HREF}
                className="inline-flex min-h-[32px] items-center rounded-control px-1.5 text-xs font-semibold text-brand hover:underline"
              >
                تعديل السلة
              </Link>
            </div>
            {lines.length === 0 ? (
              <p className="mt-3 text-sm text-secondary">لا توجد عناصر في السلة حاليًا.</p>
            ) : (
              <ul className="mt-3 grid gap-2.5">
                {lines.map((l) => (
                  <li
                    key={l.productVariantId}
                    className="flex items-start justify-between gap-3 rounded-control border border-line/80 bg-purple-surface/20 p-3 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-bold text-ink">{l.productName}</p>
                      <p className="mt-0.5 text-xs text-secondary">
                        {l.variantName} · الكمية: <bdi>{l.quantity}</bdi>
                      </p>
                    </div>
                    {l.lineTotal !== null ? (
                      <p className="shrink-0 font-bold tabular-nums text-brand-deep">
                        <bdi>{l.lineTotal} ج.م</bdi>
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section
            aria-labelledby="co-address"
            data-step-active={activeStep === 2 ? "true" : "false"}
            className="min-w-0 rounded-card border border-line bg-white p-5 shadow-xs"
          >
            <div className="flex items-center gap-2 border-b border-line/70 pb-3">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-control bg-purple-surface text-brand" aria-hidden="true">
                <MapPin size={16} />
              </span>
              <h2 id="co-address" className="text-base font-bold text-brand-deep">
                عنوان التوصيل
              </h2>
            </div>
            {me ? (
              me.addresses.length === 0 ? (
                <p className="mt-3 text-sm text-secondary">
                  لا توجد عناوين محفوظة —{" "}
                  <a href="/account/addresses" className="font-semibold text-brand">
                    أضف عنوانًا
                  </a>{" "}
                  ثم عُد.
                </p>
              ) : (
                <label className="mt-4 grid gap-1.5 text-sm font-semibold">
                  اختر عنوانًا
                  <select
                    value={addressId}
                    onChange={(e) => setAddressId(e.target.value)}
                    className={inputClass}
                  >
                    <option value="">— اختر —</option>
                    {me.addresses.map((a) => (
                      <option key={a.id} value={a.id}>
                        {(a.label ?? a.city) + (a.isDefault ? " (افتراضي)" : "")}
                      </option>
                    ))}
                  </select>
                </label>
              )
            ) : (
              <div className="mt-4 grid gap-3.5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1.5 text-sm font-semibold">
                    المدينة *
                    <input
                      value={guest.city}
                      onChange={(e) => setGuest((g) => ({ ...g, city: e.target.value }))}
                      maxLength={80}
                      className={inputClass}
                    />
                  </label>
                  <label className="grid gap-1.5 text-sm font-semibold">
                    الهاتف *
                    <input
                      value={guest.phone}
                      onChange={(e) => setGuest((g) => ({ ...g, phone: e.target.value }))}
                      inputMode="tel"
                      maxLength={32}
                      className={inputClass}
                    />
                  </label>
                  <label className="grid gap-1.5 text-sm font-semibold">
                    الاسم الأول *
                    <input
                      value={guest.firstName}
                      onChange={(e) => setGuest((g) => ({ ...g, firstName: e.target.value }))}
                      maxLength={80}
                      className={inputClass}
                    />
                  </label>
                  <label className="grid gap-1.5 text-sm font-semibold">
                    الشارع (اختياري)
                    <input
                      value={guest.street}
                      onChange={(e) => setGuest((g) => ({ ...g, street: e.target.value }))}
                      maxLength={120}
                      className={inputClass}
                    />
                  </label>
                </div>
                {/* D33: optional address fields per the approved FP-00-D015 field list. */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1.5 text-sm font-semibold">
                    المنطقة / الحي (اختياري)
                    <input
                      value={guest.area}
                      onChange={(e) => setGuest((g) => ({ ...g, area: e.target.value }))}
                      maxLength={80}
                      className={inputClass}
                    />
                  </label>
                  <label className="grid gap-1.5 text-sm font-semibold">
                    القرية (اختياري)
                    <input
                      value={guest.village}
                      onChange={(e) => setGuest((g) => ({ ...g, village: e.target.value }))}
                      maxLength={80}
                      className={inputClass}
                    />
                  </label>
                  <label className="grid gap-1.5 text-sm font-semibold">
                    رقم العمارة (اختياري)
                    <input
                      value={guest.buildingNumber}
                      onChange={(e) => setGuest((g) => ({ ...g, buildingNumber: e.target.value }))}
                      maxLength={30}
                      className={inputClass}
                    />
                  </label>
                  <label className="grid gap-1.5 text-sm font-semibold">
                    علامة مميزة (اختياري)
                    <input
                      value={guest.landmark}
                      onChange={(e) => setGuest((g) => ({ ...g, landmark: e.target.value }))}
                      maxLength={160}
                      className={inputClass}
                    />
                  </label>
                </div>
                <p className="text-xs text-secondary">تُستخدم هذه البيانات لهذا الطلب فقط — لا يُنشأ حساب.</p>
              </div>
            )}
          </section>
        </div>

        <aside className="min-w-0 lg:sticky lg:top-24">
          <section
            aria-labelledby="co-summary"
            data-step-active={activeStep === 3 ? "true" : "false"}
            className="grid gap-3 rounded-card border border-line bg-white p-5 shadow-xs"
          >
            <div className="flex items-center gap-2 border-b border-line/70 pb-3">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-control bg-purple-surface text-brand" aria-hidden="true">
                <Receipt size={16} />
              </span>
              <h2 id="co-summary" className="text-base font-bold text-brand-deep">
                الملخص والدفع
              </h2>
            </div>

            <div className="flex gap-2">
              <label className="sr-only" htmlFor="co-coupon">
                كود الكوبون
              </label>
              <input
                id="co-coupon"
                value={coupon}
                onChange={(e) => setCoupon(e.target.value)}
                placeholder="كوبون (اختياري)"
                maxLength={64}
                autoComplete="off"
                className="min-h-[44px] min-w-0 flex-1 rounded-control border border-line bg-white px-3 text-sm transition-colors duration-[var(--motion-fast,170ms)] focus-visible:border-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand focus-visible:ring-2 focus-visible:ring-brand/15"
              />
              <button
                type="button"
                onClick={() => refreshPreview()}
                disabled={estimating || lines.length === 0}
                className="min-h-[44px] shrink-0 rounded-control border border-line-strong bg-white px-4 text-sm font-semibold transition-[transform,colors,border-color,background-color,opacity] duration-[var(--motion-fast,170ms)] hover:border-brand hover:bg-purple-surface active:scale-[0.98] disabled:opacity-55 disabled:active:scale-100"
              >
                معاينة
              </button>
            </div>

            {previewNote ? (
              <p role="alert" className="text-sm text-secondary">
                {previewNote}
              </p>
            ) : null}

            {/* P12-03 S1 Option C: Always-mounted fixed-min-height summary box prevents async estimate CLS. */}
            <div
              data-estimate-state={estimateState}
              className="grid min-h-[152px] content-start gap-2 rounded-card border border-line bg-purple-surface/35 p-3.5 text-sm transition-[opacity,border-color,background-color] duration-[var(--motion-short,200ms)]"
            >
              {preview ? (
                <>
                  {previewStale ? (
                    <p role="status" className="rounded-control bg-warning-fg/10 px-2.5 py-1.5 text-xs font-semibold">
                      تقدير سابق — تغيّرت شروط الطلب، ولا يُستخدم هذا الإجمالي للتأكيد.
                    </p>
                  ) : null}
                  {!previewStale && preview.deliveryEligibility && !preview.deliveryEligibility.serviceable ? (
                    <p role="alert" className="rounded-control bg-error/10 px-2.5 py-1.5 text-xs font-semibold text-error">
                      العنوان خارج مناطق التوصيل المفعّلة حاليًا — اختر منطقة مخدومة لإتمام الطلب.
                    </p>
                  ) : null}
                  <div
                    className={
                      previewStale
                        ? "grid gap-1.5 opacity-60 transition-opacity duration-[var(--motion-short,200ms)]"
                        : "grid gap-1.5 transition-opacity duration-[var(--motion-short,200ms)]"
                    }
                  >
                    <p className="flex items-center justify-between gap-2 text-secondary">
                      <span>المجموع الفرعي:</span>
                      <bdi className="font-semibold tabular-nums text-ink">{preview.subtotal} ج.م</bdi>
                    </p>
                    <p className="flex items-center justify-between gap-2 text-secondary">
                      <span>الخصم:</span>
                      <bdi className="font-semibold tabular-nums text-ink">{preview.discountTotal} ج.م</bdi>
                    </p>
                    <p className="flex items-center justify-between gap-2 text-secondary">
                      <span>التوصيل:</span>
                      <bdi className="font-semibold tabular-nums text-ink">{preview.deliveryFee} ج.م</bdi>
                    </p>
                    <p className="mt-1 flex items-center justify-between gap-2 border-t border-line pt-2 font-bold text-brand-deep">
                      <span>الإجمالي التقديري (قبل الإنشاء):</span>
                      <bdi className="text-base tabular-nums">{preview.total} ج.م</bdi>
                    </p>
                  </div>
                </>
              ) : (
                <div className="grid gap-2 text-xs text-secondary" aria-hidden="true">
                  <div className="flex items-center justify-between">
                    <span>المجموع الفرعي</span>
                    <span className="h-4 w-16 animate-pulse rounded bg-purple-surface" />
                  </div>
                  <div className="flex items-center justify-between">
                    <span>الخصم</span>
                    <span className="h-4 w-12 animate-pulse rounded bg-purple-surface" />
                  </div>
                  <div className="flex items-center justify-between">
                    <span>التوصيل</span>
                    <span className="h-4 w-14 animate-pulse rounded bg-purple-surface" />
                  </div>
                  <div className="mt-1 flex items-center justify-between border-t border-line pt-2 font-semibold text-ink">
                    <span>احتساب الإجمالي</span>
                    <span className="h-4 w-20 animate-pulse rounded bg-purple-surface" />
                  </div>
                </div>
              )}
            </div>

            {issue ? (
              <div role="alert" className="rounded-card border border-error bg-error/5 p-3 text-sm">
                <p>{issue.text}</p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  {issue.kind === "login" ? (
                    <Link href={LOGIN_HREF} className="font-semibold text-brand">
                      تسجيل الدخول
                    </Link>
                  ) : null}
                  {issue.kind === "price" || issue.kind === "stock" || issue.kind === "consumed" || issue.kind === "cart" ? (
                    <Link href={CART_HREF} className="font-semibold text-brand">
                      مراجعة السلة
                    </Link>
                  ) : null}
                  {issue.kind === "price" ? (
                    <button
                      type="button"
                      onClick={() => void repriceCart()}
                      disabled={repricePending || submitting}
                      className="min-h-[44px] rounded-control border border-line-strong bg-white px-4 font-semibold disabled:opacity-55"
                    >
                      {repricePending ? "جارٍ تحديث الأسعار…" : "تحديث الأسعار"}
                    </button>
                  ) : null}
                  {issue.kind === "consumed" && me ? (
                    <Link href={ORDERS_HREF} className="font-semibold text-brand">
                      طلباتي
                    </Link>
                  ) : null}
                </div>
              </div>
            ) : null}

            {/* D02/D10: live status for the estimate freshness (reserved min-height prevents button nudge). */}
            <p className="min-h-[2.75rem] text-xs leading-relaxed text-secondary" role="status" aria-live="polite">
              {pending
                ? "علّقت المحاولة غير المؤكدة — تحقق من نتيجتها أو ابدأ طلبًا جديدًا."
                : previewStale || preview === null
                  ? "بانتظار تقدير الإجمالي — يُتاح التأكيد بعد اكتمال المعاينة أو اضغط «معاينة»."
                  : estimating
                    ? "جارٍ تحديث التقدير…"
                    : "الإجمالي التقديري محدث وفق الكوبون والتوصيل — يمكنك التأكيد."}
            </p>

            <button
              type="button"
              onClick={() => void submit("new")}
              disabled={submitting || repricePending || pending !== null || previewStale || preview === null}
              className="vxp-primary-btn min-h-[46px] w-full rounded-control bg-brand px-6 font-semibold text-white transition-[transform,colors,background-color,opacity] duration-[var(--motion-fast,170ms)] active:scale-[0.985] disabled:opacity-55 disabled:active:scale-100"
            >
              {submitting ? "جارٍ إنشاء الطلب…" : "تأكيد إنشاء الطلب"}
            </button>

            <p className="flex items-start gap-1.5 text-xs text-secondary">
              <ShieldCheck size={14} className="mt-0.5 shrink-0 text-brand" aria-hidden="true" />
              <span>لا توجد خطوة دفع في هذه النسخة — يُنشأ الطلب مباشرة وفق العقد.</span>
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
