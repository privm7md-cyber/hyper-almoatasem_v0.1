// FE-1 API client foundation (client-safe: no secrets, no backend imports).
// Contract: envelopes {data,meta} / {error:{code,message,details}} (respond.ts),
// status mapping mirrors http-status.ts. Same-origin relative paths ONLY — the client never
// assembles absolute/backend URLs and never attaches credentials manually (cookies are
// same-origin automatic). No retry, no cache overrides, no invented codes.

import type { ApiErrorCode } from "@/lib/api/errors";

export type { ApiErrorCode };

const STATUS_FOR_CODE: Record<ApiErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  GONE: 410,
  CONFLICT: 409,
  BUSINESS_RULE: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

const KNOWN_CODES = new Set<string>(Object.keys(STATUS_FOR_CODE));

export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown> | null;
  readonly retryable: boolean;

  constructor(code: ApiErrorCode, message: string, details: Record<string, unknown> | null = null) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_FOR_CODE[code];
    this.details = details;
    // Retryable only where the contract says so (race losers re-read; throttles back off).
    this.retryable = code === "CONFLICT" || code === "RATE_LIMITED";
  }
}

export interface ApiSuccess<T> {
  data: T;
  meta: Record<string, unknown>;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  /**
   * Explicit per-request headers ONLY (e.g. `x-guest-token` cart bearer).
   * Never session secrets, never order credentials — enforced by callers, audited here.
   */
  headers?: Record<string, string>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Normalize any failure into AppError. Never echoes request bodies, headers, or secrets. */
export function normalizeFailure(error: unknown, status?: number): AppError {  if (error instanceof AppError) return error;
  if (error instanceof DOMException && error.name === "AbortError") {
    return new AppError("INTERNAL", "أُلغي الطلب.");
  }
  if (error instanceof TypeError) {
    // fetch() network-level failure (offline/DNS/refused): transport only, no internals.
    return new AppError("INTERNAL", "تعذّر الاتصال بالخادم.");
  }
  if (typeof status === "number" && !(status >= 200 && status < 300)) {
    return new AppError("INTERNAL", "حدث خطأ غير متوقع.");
  }
  return new AppError("INTERNAL", "حدث خطأ غير متوقع.");
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<ApiSuccess<T>> {
  if (!path.startsWith("/") || path.includes("://")) {
    throw new AppError("INTERNAL", "مسار طلب غير صالح.");
  }
  const { method = "GET", body, signal, headers } = options;
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(headers ?? {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    throw normalizeFailure(error);
  }
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw normalizeFailure(new TypeError("bad-json"), response.status);
  }
  if (!response.ok) {
    if (isRecord(parsed) && isRecord(parsed.error) && typeof parsed.error.code === "string") {
      const code = KNOWN_CODES.has(parsed.error.code) ? (parsed.error.code as ApiErrorCode) : "INTERNAL";
      const message = typeof parsed.error.message === "string" ? parsed.error.message : "حدث خطأ غير متوقع.";
      const details = isRecord(parsed.error.details) ? (parsed.error.details as Record<string, unknown>) : null;
      throw new AppError(code, message, details);
    }
    throw normalizeFailure(new Error("http-error"), response.status);
  }
  if (isRecord(parsed) && "data" in parsed) {
    return { data: parsed.data as T, meta: isRecord(parsed.meta) ? (parsed.meta as Record<string, unknown>) : {} };
  }
  throw new AppError("INTERNAL", "استجابة غير صالحة من الخادم.");
}

/**
 * FE-11 auth-aware display message: server message first (backend owns wording),
 * plus an actionable Arabic recovery hint for session vs permission failures.
 * Backend 401/403 bodies are generic English ("Authentication required." /
 * "Forbidden.") with no recovery path — the hint restores it without inventing
 * business semantics. Returns `fallback` for non-AppError failures.
 */
export function displayFailure(error: unknown, fallback: string): string {
  if (!(error instanceof AppError)) return fallback;
  if (error.code === "UNAUTHENTICATED") {
    return `${error.message} انتهت الجلسة أو غير موجودة — سجّل الدخول مجددًا ثم أعد المحاولة.`;
  }
  if (error.code === "FORBIDDEN") {
    return `${error.message} لا تملك الصلاحية اللازمة لهذه العملية — تواصل مع مدير النظام.`;
  }
  return error.message;
}
