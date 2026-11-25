// Operational / security event log — the ALLOWLISTED use of `logEvent`.
//
// `logEvent` is a generic sink with a recursive sanitiser; on its own it
// proves nothing. This module defines WHICH events may be logged and WHICH
// fields each event may carry, so an operational log line can never become a
// data leak by accident:
//
//   * the event name must be in the registry below — an unknown event is
//     dropped (fail-closed), not logged;
//   * only the fields listed for that event survive — everything else is
//     dropped, including anything that looks like an address, a credential
//     or a payload;
//   * the recursive sanitiser in `./log` runs afterwards as a second,
//     independent layer.
//
// What is deliberately NOT logged anywhere in this module: IP addresses,
// phone numbers, email addresses, order identifiers, request/response
// bodies, tokens, cookies, authorization headers, connection strings or any
// secret. A rate-limit line names the BUCKET FAMILY, never the bucket key,
// because a bucket key embeds the identity it was derived from.
//
// Sink: the platform log stream (Vercel logs in production; the process
// stdout locally). No monitoring service is introduced — the limits of this
// sink are recorded in the run documentation.
import { logEvent } from "@/lib/api/log";

export interface OperationalEventDefinition {
  /** The only field names this event may carry. */
  readonly fields: readonly string[];
}

export const OPERATIONAL_EVENTS = {
  "rate_limit.exceeded": { fields: ["scope", "limit", "attempts", "table"] },
  "authz.denied": { fields: ["permission", "reason"] },
  "internal.error": { fields: ["code", "surface"] },
  "config.invalid": { fields: ["name"] },
} as const satisfies Record<string, OperationalEventDefinition>;

export type OperationalEvent = keyof typeof OPERATIONAL_EVENTS;

/**
 * Bucket FAMILY for a bucket key — never the key itself. The key embeds the
 * identity (IP, email, phone or its HMAC), which must not reach a log line.
 * Longest prefixes are matched first so a family is never truncated into
 * another one.
 */
const BUCKET_FAMILIES: ReadonlyArray<readonly [string, string]> = [
  ["guest-order:read-ip:", "guest-order-read"],
  ["guest-checkout-session:ip:", "guest-checkout-session"],
  ["guest-order:ip:", "guest-order-create"],
  ["identify:cust-ip:", "customer-identify-ip"],
  ["identify:cust-phone:", "customer-identify-phone"],
  ["pwd:cust-ip:", "customer-password-ip"],
  ["pwd:cust-acct:", "customer-password-account"],
  ["login:cust-ip:", "customer-login-ip"],
  ["login:cust-acct:", "customer-login-account"],
  ["login:ip:", "admin-login-ip"],
  ["login:acct:", "admin-login-account"],
  ["reg:cust-ip:", "customer-register-ip"],
  ["reg:cust-acct:", "customer-register-phone"],
];

export function bucketScope(bucketKey: string): string {
  for (const [prefix, scope] of BUCKET_FAMILIES) {
    if (bucketKey.startsWith(prefix)) return scope;
  }
  return "unclassified";
}

/**
 * Emit one allowlisted operational event. Unknown event names and
 * non-allowlisted fields are dropped; the call never throws.
 */
export function logOperationalEvent(
  event: OperationalEvent,
  fields: Record<string, unknown> = {},
): void {
  const definition = OPERATIONAL_EVENTS[event];
  if (!definition) return;
  const allowed: Record<string, unknown> = {};
  for (const key of definition.fields) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      allowed[key] = fields[key];
    }
  }
  logEvent(event, allowed);
}
