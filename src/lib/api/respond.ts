// Shared response envelopes (BA-1 foundation).
//
// Success: { data, meta }. Error: { error: { code, message, details } }.
// New routes adopt these from BA-2 onward. Existing routes keep their shapes
// (/api/admin/session stays { ok, ... }) — this module never rewrites them.
import { ApiError, normalizeError } from "./errors";
import { statusForCode } from "./http-status";

export interface SuccessEnvelope<T> {
  data: T;
  meta: Record<string, unknown>;
}

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown> | null;
  };
}

export function ok<T>(data: T, meta: Record<string, unknown> = {}): { status: number; body: SuccessEnvelope<T> } {
  return { status: 200, body: { data, meta } };
}

export function created<T>(data: T, meta: Record<string, unknown> = {}): { status: number; body: SuccessEnvelope<T> } {
  return { status: 201, body: { data, meta } };
}

export function fail(error: unknown): { status: number; body: ErrorEnvelope } {
  const e: ApiError = normalizeError(error);
  return {
    status: statusForCode(e.code),
    body: { error: { code: e.code, message: e.message, details: e.details } },
  };
}
