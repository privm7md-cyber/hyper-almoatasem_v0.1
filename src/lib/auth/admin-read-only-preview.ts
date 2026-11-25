import "server-only";
import { ApiError } from "@/lib/api/errors";

// Internal process-startup switch only. Never accept request-supplied toggles.
// A configured process stays write-blocked even outside development/loopback:
// an invalid preview context must NOT fall back to ordinary admin writes.
const configured = process.env.ADMIN_READ_ONLY_PREVIEW === "1";

export function isAdminReadOnlyPreviewConfigured(): boolean {
  return configured;
}

/** Strict Host authority, not a URL and never X-Forwarded-Host. No DNS lookup. */
export function isAdminPreviewLocalHost(host: string | null | undefined): boolean {
  if (process.env.NODE_ENV !== "development" || !host) return false;
  const match = /^(localhost|127\.0\.0\.1|\[::1\])(?::([0-9]{1,5}))?$/i.exec(host);
  // JS $ can match before a final newline; require the entire raw authority.
  if (!match || match[0] !== host) return false;
  return match[2] === undefined || (Number(match[2]) >= 1 && Number(match[2]) <= 65535);
}

/** This only narrows capabilities; a .view key still needs its real RBAC grant. */
export function isAdminPreviewPermissionAllowed(permission: string): boolean {
  return !configured || permission.endsWith(".view");
}

/** Core write entry points fail closed even without an HTTP request scope. */
export function assertAdminPreviewWritesAllowed(): void {
  if (configured) throw new ApiError("FORBIDDEN", "Admin read-only preview.");
}
