// Shared HTTP status mapping (BA-1 foundation).
//
// Extends the existing convention (400 malformed, 401 generic auth failure,
// 403 forbidden) without changing it. 422 marks semantically valid but
// business-rejected input (weight-step violation, envelope breach, cap
// exceeded); 409 marks write-write races and idempotency-key conflicts;
// 429 marks throttles. 500 carries only the generic message.
import type { ApiErrorCode } from "./errors";

export function statusForCode(code: ApiErrorCode): number {
  switch (code) {
    case "VALIDATION":
      return 400;
    case "UNAUTHENTICATED":
      return 401;
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
      return 409;
    case "BUSINESS_RULE":
      return 422;
    case "RATE_LIMITED":
      return 429;
    case "INTERNAL":
      return 500;
  }
}
