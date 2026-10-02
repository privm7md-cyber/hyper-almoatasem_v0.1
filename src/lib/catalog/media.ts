// BA-B4 product media write/read domain (raw SQL only).
//
// product_images lives OUTSIDE the frozen schema (db/future/product-images.sql
// — scratch-verified, never production-applied, never in prisma/migrations to
// avoid implicit deploy). No Prisma model exists by design, so Prisma owns
// nothing here; raw SQL owns all reads/writes (same posture as inet-adjacent
// paths). Metadata/reference ONLY — never binary content, never a storage
// provider (register flow; signed upload is a documented future).
// Primary switch is one atomic UPDATE (partial UQ guards); concurrent
// switches serialize to exactly one primary. Gallery order is
// (sort_order, id) — deterministic. Fallback: primary = is_primary row,
// else first gallery row, else null (never a broken URL — url is
// https-only at the boundary + non-empty/no-spaces at the DB).
// Admin mutations pair audit rows in the same tx (BA-9 pattern).
import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { ApiError, businessRule } from "@/lib/api/errors";
import { auditInTx } from "@/lib/api/audit";

/** RFC 9562 UUIDv7 (frozen app-ID strategy; local copy — previous BA
 * modules are not modified for reuse). */
export function newUuidV7(nowMs: number = Date.now()): string {
  const rand = randomBytes(10);
  const timeHex = nowMs.toString(16).padStart(12, "0");
  const b: number[] = [
    ...[0, 1, 2, 3, 4, 5].map((i) => parseInt(timeHex.slice(i * 2, i * 2 + 2), 16)),
    0x70 | (rand[0] & 0x0f),
    rand[1],
    0x80 | (rand[2] & 0x3f),
    rand[3],
    rand[4],
    rand[5],
    rand[6],
    rand[7],
    rand[8],
    rand[9],
  ];
  const hex = b.map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface MediaRow {
  id: string;
  productId: string;
  url: string;
  altText: string | null;
  mimeType: string | null;
  byteSize: number | null;
  width: number | null;
  height: number | null;
  sortOrder: number;
  isPrimary: boolean;
  createdAt: Date;
}

async function assertProductExists(productId: string): Promise<void> {
  const row = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
  if (!row) throw new ApiError("NOT_FOUND", "Product not found.", null);
}

/** Gallery in deterministic order (sort_order, id). */
export async function listImages(productId: string): Promise<MediaRow[]> {
  await assertProductExists(productId);
  return prisma.$queryRaw<MediaRow[]>`
    SELECT id::text AS id, product_id::text AS "productId", url,
      alt_text AS "altText", mime_type AS "mimeType", byte_size AS "byteSize",
      width, height, sort_order AS "sortOrder", is_primary AS "isPrimary",
      created_at AS "createdAt"
      FROM product_images WHERE product_id = ${productId}::uuid
      ORDER BY sort_order ASC, id ASC`;
}

export interface RegisterInput {
  url: string;
  altText?: string | null;
  mimeType?: string | null;
  byteSize?: number | null;
  width?: number | null;
  height?: number | null;
  sortOrder?: number | null;
  isPrimary?: boolean | null;
}

export async function registerImage(productId: string, input: RegisterInput, actorId: string): Promise<MediaRow> {
  await assertProductExists(productId);
  if (
    (input.width === null || input.width === undefined) !==
    (input.height === null || input.height === undefined)
  ) {
    throw businessRule("Width and height must be provided together.", null);
  }
  const id = newUuidV7();
  return prisma.$transaction(async (tx) => {
    if (input.isPrimary === true) {
      // Deterministic pre-lock (id order) so concurrent primary switches
      // serialize instead of deadlocking on the same rows / partial UQ.
      await tx.$queryRaw`
        SELECT 1 FROM product_images WHERE product_id = ${productId}::uuid ORDER BY id FOR UPDATE`;
      await tx.$executeRaw`
        UPDATE product_images SET is_primary = FALSE WHERE product_id = ${productId}::uuid`;
    }
    const rows = await tx.$queryRaw<MediaRow[]>`
      INSERT INTO product_images
        (id, product_id, url, alt_text, mime_type, byte_size, width, height, sort_order, is_primary)
      VALUES (${id}::uuid, ${productId}::uuid, ${input.url}::text,
        ${input.altText ?? null}::varchar, ${input.mimeType ?? null}::varchar,
        ${input.byteSize ?? null}::integer, ${input.width ?? null}::integer,
        ${input.height ?? null}::integer, ${input.sortOrder ?? 0}::integer,
        ${(input.isPrimary ?? false) as boolean}::boolean)
      RETURNING id::text AS id, product_id::text AS "productId", url,
        alt_text AS "altText", mime_type AS "mimeType", byte_size AS "byteSize",
        width, height, sort_order AS "sortOrder", is_primary AS "isPrimary",
        created_at AS "createdAt"`;
    await auditInTx(tx, {
      action: "images.register",
      userId: actorId,
      entityType: "product_images",
      entityId: id,
      oldValues: null,
      newValues: { productId },
    });
    return rows[0];
  });
}

export interface ImagePatch {
  altText?: string | null;
  sortOrder?: number | null;
  isPrimary?: boolean | null;
}

/** Patch alt/sort and/or promote to primary (atomic switch scoped to the
 * product; partial UQ guards — concurrent switches converge). */
export async function patchImage(id: string, patch: ImagePatch, actorId: string): Promise<MediaRow | null> {
  const scoped = await prisma.$queryRaw<Array<{ id: string; product_id: string }>>`
    SELECT id::text AS id, product_id::text AS product_id FROM product_images WHERE id = ${id}::uuid`;
  if (scoped.length === 0) return null;
  const productId = scoped[0].product_id;
  return prisma.$transaction(async (tx) => {
    if (patch.isPrimary === true) {
      // Deterministic pre-lock (id order) so concurrent primary switches
      // serialize. Two-step flip (clear-all then set-one): a single-statement
      // conditional switch can hit the partial-UQ check in row-scan order
      // (deterministic 500 for the loser); clearing first removes every
      // indexed true entry, so the set-one step can never conflict.
      await tx.$queryRaw`
        SELECT 1 FROM product_images WHERE product_id = ${productId}::uuid ORDER BY id FOR UPDATE`;
      await tx.$executeRaw`
        UPDATE product_images SET is_primary = FALSE WHERE product_id = ${productId}::uuid`;
      await tx.$executeRaw`
        UPDATE product_images SET is_primary = TRUE WHERE id = ${id}::uuid`;
    } else if (patch.isPrimary === false) {
      await tx.$executeRaw`
        UPDATE product_images SET is_primary = FALSE WHERE id = ${id}::uuid`;
    }
    // Primary state was settled by the atomic switch above; this UPDATE
    // touches alt/sort only (never re-derives is_primary).
    const rows = await tx.$queryRaw<MediaRow[]>`
      UPDATE product_images
         SET alt_text = COALESCE(${patch.altText ?? null}::varchar, alt_text),
             sort_order = COALESCE(${patch.sortOrder ?? null}::integer, sort_order)
       WHERE id = ${id}::uuid
      RETURNING id::text AS id, product_id::text AS "productId", url,
        alt_text AS "altText", mime_type AS "mimeType", byte_size AS "byteSize",
        width, height, sort_order AS "sortOrder", is_primary AS "isPrimary",
        created_at AS "createdAt"`;
    await auditInTx(tx, {
      action: patch.isPrimary === true ? "images.primary" : "images.update",
      userId: actorId,
      entityType: "product_images",
      entityId: id,
      oldValues: null,
      newValues: { productId },
    });
    return rows[0] ?? null;
  });
}

/** Hard-delete one image row (physical objects belong to the future storage
 * provider — nothing outside this row is touched). */
export async function deleteImage(id: string, actorId: string): Promise<boolean> {
  const scoped = await prisma.$queryRaw<Array<{ id: string; product_id: string }>>`
    SELECT id::text AS id, product_id::text AS product_id FROM product_images WHERE id = ${id}::uuid`;
  if (scoped.length === 0) return false;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`DELETE FROM product_images WHERE id = ${id}::uuid`;
    await auditInTx(tx, {
      action: "images.delete",
      userId: actorId,
      entityType: "product_images",
      entityId: id,
      oldValues: { productId: scoped[0].product_id },
      newValues: null,
    });
  });
  return true;
}
