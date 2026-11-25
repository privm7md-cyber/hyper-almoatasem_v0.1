// CSP violation report collector (Final-Closure: Report-Only phase).
//
// Browsers POST here when the Content-Security-Policy-Report-Only header
// (next.config.ts) produces a violation in the observing browser. The mission
// posture: Report-Only ONLY — this endpoint never changes what runs, and no
// enforcement decision is made anywhere in this file.
//
// Hard guarantees (why an arbitrary POST to a public collect endpoint is safe):
//  - 204 always, for any accepted/dropped payload. A CSP report is fire-and-
//    forget for the browser; nothing here can block or corrupt the site.
//  - Console-only logging (logEvent) — NO database, NO writes to any table,
//    so spam cannot fill the production data.
//  - Per-IP fixed-window cap (CSP_REPORTS_MAX per CSP_REPORTS_WINDOW_MS) with
//    a silent drop beyond it — worst case memory is tiny and bounded.
//  - Allowlisted body fields only; the raw pending-report object is never
//    echoed. No cookies, no tokens, no PII beyond the coarse client IP + UA.
import { NextResponse } from "next/server";
import { resolveClientIp } from "@/lib/api/client-ip";
import { logEvent } from "@/lib/api/log";

const BODY_LIMIT_BYTES = 4096;
const CSP_REPORTS_MAX = 20;
const CSP_REPORTS_WINDOW_MS = 60_000;
const MAX_TRACKED_KEYS = 4096;

/** Fixed-window counters (per process; bounded to MAX_TRACKED_KEYS). */
const hits = new Map<string, { count: number; windowStart: number }>();
let droppedByLimit = 0;
let lastLimitNoteAt = 0;
let droppedByOversize = 0;
let lastOversizeNoteAt = 0;

/**
 * P12-07 SEC-06: Key strictly by resolved client IP (or "unknown"), never by
 * client-controlled User-Agent. Including User-Agent allowed an unauthenticated
 * caller to bypass CSP_REPORTS_MAX and grow `hits` unboundedly by rotating UA.
 */
function hitsKey(ip: string | null): string {
  return ip ?? "unknown";
}

function pruneAndBoundHits(now: number): void {
  if (hits.size < MAX_TRACKED_KEYS) return;
  for (const [k, v] of hits) {
    if (now - v.windowStart > CSP_REPORTS_WINDOW_MS) {
      hits.delete(k);
    }
  }
  while (hits.size >= MAX_TRACKED_KEYS) {
    const oldest = hits.keys().next().value;
    if (oldest === undefined) break;
    hits.delete(oldest);
  }
}

function allowMore(key: string): boolean {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || now - entry.windowStart > CSP_REPORTS_WINDOW_MS) {
    if (!entry) pruneAndBoundHits(now);
    hits.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= CSP_REPORTS_MAX) {
    entry.count += 1;
    return false;
  }
  entry.count += 1;
  return true;
}

/** Only allowlisted, bounded, string fields survive. */
function pickField(source: unknown, key: string): string | null {
  if (typeof source !== "object" || source === null) return null;
  const v = (source as Record<string, unknown>)[key];
  if (typeof v !== "string") return null;
  return v.slice(0, 300);
}

/** Bounded number field (CSP reports carry line/column as numbers). */
function pickNumber(source: unknown, key: string): number | null {
  if (typeof source !== "object" || source === null) return null;
  const v = (source as Record<string, unknown>)[key];
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return v;
}

export async function POST(request: Request): Promise<NextResponse> {
  const ip = resolveClientIp(request.headers).ip;
  const userAgent = request.headers.get("user-agent") ?? "";
  const key = hitsKey(ip);
  if (!allowMore(key)) {
    droppedByLimit += 1;
    if (Date.now() - lastLimitNoteAt > CSP_REPORTS_WINDOW_MS) {
      lastLimitNoteAt = Date.now();
      logEvent("csp.report.window_dropped", { ip, droppedTotal: droppedByLimit });
    }
    return new NextResponse(null, { status: 204 });
  }

  const ct = request.headers.get("content-type") ?? "";
  let body: Record<string, unknown> | null = null;
  if (ct.includes("application/csp-report") || ct.includes("application/json")) {
    // Third-Agent security fix: the body MUST be capped while reading, not
    // after. `await request.text()` buffers the WHOLE body first — on a public
    // unauthenticated endpoint that is an unbounded memory allocation per
    // request (and the old `raw.length` check counted UTF-16 code units, so a
    // 4,096-char Arabic payload is ~12 KB of real bytes that still passed).
    // The stream is now aborted as soon as the 4,096th byte arrives; the
    // response stays 204 either way (never leaks limit state to the client).
    const reader = request.body?.getReader();
    if (reader) {
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      let oversize = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        bytes += value.byteLength;
        if (bytes > BODY_LIMIT_BYTES) {
          oversize = true;
          break;
        }
        chunks.push(value);
      }
      try {
        await reader.cancel();
      } catch {
        // cancel is only a best-effort release; reading continues to work.
      }
      if (oversize) {
        droppedByOversize += 1;
        if (Date.now() - lastOversizeNoteAt > CSP_REPORTS_WINDOW_MS) {
          lastOversizeNoteAt = Date.now();
          logEvent("csp.report.oversize_dropped", { ip, droppedTotal: droppedByOversize, limit: BODY_LIMIT_BYTES });
        }
        return new NextResponse(null, { status: 204 });
      }
      const all = new Uint8Array(bytes);
      let off = 0;
      for (const c of chunks) {
        all.set(c, off);
        off += c.byteLength;
      }
      try {
        body = JSON.parse(new TextDecoder("utf-8", { fatal: false }).decode(all)) as Record<string, unknown>;
      } catch {
        body = null;
      }
    }
  }

  const report =
    typeof body === "object" && body !== null && typeof (body as { "csp-report"?: unknown })["csp-report"] === "object"
      ? ((body as { "csp-report": Record<string, unknown> })["csp-report"])
      : null;

  // The REPORT-ONLY strip (`report-to`/`report-uri` on a CSP-RO directive)
  // implies `type: "csp-report"`. Anything else (csp_cookies, other types) is
  // not this feature; it is dropped to keep the log signal pure.
  const eventType = pickField(report, "type");
  if (!report || (eventType && eventType !== "csp-report")) {
    logEvent("csp.report.unparseable", { ip, contentType: ct.slice(0, 60) });
    return new NextResponse(null, { status: 204 });
  }

  logEvent("csp.report.violation", {
    ip,
    userAgent: userAgent.slice(0, 120),
    documentUri: pickField(report, "document-uri"),
    effectiveDirective: pickField(report, "effective-directive"),
    violatedDirective: pickField(report, "violated-directive"),
    blockedUri: pickField(report, "blocked-uri"),
    originalPolicy: pickField(report, "original-policy")?.slice(0, 400) ?? null,
    disposition: pickField(report, "disposition"),
    scriptSample: pickField(report, "script-sample"), // Chrome only sends with 'report-sample' users; the sample never runs.
    sourceFile: pickField(report, "source-file")?.slice(0, 300),
    lineNumber: pickNumber(report, "line-number"),
    columnNumber: pickNumber(report, "column-number"),
  });
  return new NextResponse(null, { status: 204 });
}

export const dynamic = "force-dynamic";
