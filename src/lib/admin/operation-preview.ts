import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { ApiError, conflict } from "@/lib/api/errors";

export function operationDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function mac(value: string): string {
  const secret = process.env.RATE_LIMIT_HMAC_SECRET;
  if (!secret || secret.length < 32) throw new ApiError("INTERNAL", "Preview signing is not configured.");
  return createHmac("sha256", secret).update(`operations-preview:v1:${value}`).digest("hex");
}

export function signOperationPreview(purpose: string, actor: string, value: unknown): string {
  const payload = Buffer.from(JSON.stringify({ purpose, actor, digest: operationDigest(value), expires: Date.now() + 600_000 })).toString("base64url");
  return `${payload}.${mac(payload)}`;
}

export function verifyOperationPreview(receipt: string | undefined, purpose: string, actor: string, value: unknown): void {
  if (!receipt || receipt.length > 2048) throw conflict("Preview required; review the differences again.");
  const [payload, signature, extra] = receipt.split(".");
  if (extra || !signature || !/^[a-f0-9]{64}$/.test(signature) ||
      !timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(mac(payload), "hex"))) {
    throw conflict("Invalid preview confirmation.");
  }
  let decoded;
  try { decoded = JSON.parse(Buffer.from(payload, "base64url").toString()); } catch { throw conflict("Invalid preview confirmation."); }
  if (decoded.purpose !== purpose || decoded.actor !== actor || decoded.expires < Date.now() || decoded.digest !== operationDigest(value)) {
    throw conflict("Data changed or preview expired; review the differences again.");
  }
}
