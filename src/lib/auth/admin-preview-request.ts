import "server-only";
import { headers } from "next/headers";
import {
  isAdminPreviewLocalHost,
  isAdminReadOnlyPreviewConfigured,
} from "@/lib/auth/admin-read-only-preview";

/** No Host, malformed/non-loopback Host or no request scope: deny, never touch. */
export async function isAdminPreviewReadRequestAllowed(): Promise<boolean> {
  if (!isAdminReadOnlyPreviewConfigured()) return true;
  try {
    return isAdminPreviewLocalHost((await headers()).get("host"));
  } catch {
    return false;
  }
}
