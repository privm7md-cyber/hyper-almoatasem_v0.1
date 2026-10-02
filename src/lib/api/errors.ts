// Shared API error architecture (BA-1 foundation).
//
// Stable snake_case codes for every route (BA-A locked taxonomy — see
// docs/backend-application-contract.md §13/§15). Transport mapping lives in
// http-status.ts. This module never touches the network, the database, or
// secrets: messages are fixed strings and details carry only caller-supplied,
// already-sanitized data. All routes including /api/admin/session use these
// codes (session migrated in BA-A).
//
// Deliberately absent: no LOCKED code (lockout stays 401-generic per the
// frozen login behavior — never distinguish locked accounts) and no separate
// checkout code (checkout failures are BUSINESS_RULE).

export type ApiErrorCode =
  | "VALIDATION"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "BUSINESS_RULE"
  | "RATE_LIMITED"
  | "INTERNAL";

export interface ApiErrorDetails {
  [key: string]: unknown;
}

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly details: ApiErrorDetails | null;
  readonly retryable: boolean;

  constructor(code: ApiErrorCode, message: string, details: ApiErrorDetails | null = null, retryable = false) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.details = details;
    this.retryable = retryable;
  }
}

/** Business-rule failure (422 class). Never carries SQL, stacks, or secrets. */
export function businessRule(message: string, details: ApiErrorDetails | null = null): ApiError {
  return new ApiError("BUSINESS_RULE", message, details, false);
}

/** Write-write race loser: caller must re-read and replay (never auto-retry blindly). */
export function conflict(message: string, details: ApiErrorDetails | null = null): ApiError {
  return new ApiError("CONFLICT", message, details, true);
}

/** Normalize anything thrown inside a handler into a safe ApiError. */
export function normalizeError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError("INTERNAL", "Unexpected error.", null, false);
}
