// ADMIN ORDERS QUEUE — the read model behind the admin orders screen.
//
// Order ids are DB-default random UUIDs, so "ORDER BY id" is NOT a time
// order: the queue used to walk a random slice of the table and its pages
// skipped and repeated rows. The queue is now a total, deterministic keyset
// — (created_at DESC, id ASC) — and the cursor stays the row id (the wire
// contract the admin API already speaks): the cursor position resolves
// through that row's stored created_at, which only SQL can read exactly
// (Postgres keeps microseconds, a JS Date truncates them and would drop
// rows created in the same millisecond).

import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api/errors";
import { uuidSchema } from "@/lib/api/validation";

export interface OrderQueueFilter {
  limit: number;
  /** Row id of the last row of the previous page (the keyset cursor). */
  cursor: string | null;
  status: string | null;
  /** Order number, customer phone or customer name. */
  search: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  dateBefore?: string | null;
}

export interface OrderQueueRow {
  id: string;
  orderNumber: string;
  status: string;
  customerName: string;
  customerPhone: string;
  /** Null until preparation finalizes the money. */
  totalFinal: string | null;
  totalEstimated: string;
  createdAt: Date;
}

export interface OrderQueuePage {
  rows: OrderQueueRow[];
  /** Row id of the last displayed row — the cursor of the next page. */
  nextCursor: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One page of the admin queue, newest first. The page reads limit + 1 rows
 * so the caller knows whether another page exists without a second count.
 */
export async function listOrderQueue(filter: OrderQueueFilter): Promise<OrderQueuePage> {
  const limit = Math.min(Math.max(Math.trunc(filter.limit), 1), 100);
  const conds: Prisma.Sql[] = [];

  if (filter.cursor !== null && !uuidSchema.safeParse(filter.cursor).success) {
    throw new ApiError("VALIDATION", "Invalid order queue cursor.");
  }
  if (filter.status) conds.push(Prisma.sql`o.status = ${filter.status}`);

  // Wildcards are dropped from the term: the search box looks for a number,
  // a phone or a name, never for a pattern.
  const term = (filter.search ?? "").replace(/[%_]/g, "").trim();
  if (term) {
    const like = `%${term}%`;
    conds.push(Prisma.sql`
      (o.order_number ILIKE ${like}
       OR o.customer_name_snapshot ILIKE ${like}
       OR o.customer_phone_snapshot ILIKE ${like})
    `);
  }
  if (filter.dateFrom) conds.push(Prisma.sql`o.created_at >= ${filter.dateFrom}::timestamptz`);
  if (filter.dateTo) conds.push(Prisma.sql`o.created_at <= ${filter.dateTo}::timestamptz`);
  if (filter.dateBefore) conds.push(Prisma.sql`o.created_at < ${filter.dateBefore}::timestamptz`);

  if (filter.cursor !== null) {
    // Validate the anchor against the SAME filters before applying the cursor.
    // Timestamps never cross a JS Date boundary (Postgres microseconds matter).
    const anchor = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT o.id::text AS id FROM orders o
      WHERE ${Prisma.join([...conds, Prisma.sql`o.id = ${filter.cursor}::uuid`], " AND ")}
      LIMIT 1`.catch(() => { throw new ApiError("VALIDATION", "Unable to resolve order queue cursor."); });
    if (anchor.length === 0) throw new ApiError("VALIDATION", "Order queue cursor no longer matches these filters.");
    conds.push(Prisma.sql`
      (o.created_at < (SELECT created_at FROM orders WHERE id = ${filter.cursor}::uuid)
       OR (o.created_at = (SELECT created_at FROM orders WHERE id = ${filter.cursor}::uuid)
           AND o.id > ${filter.cursor}::uuid))
    `);
  }

  const where = conds.length === 0 ? Prisma.empty : Prisma.sql`WHERE ${Prisma.join(conds, " AND ")}`;
  const rows = await prisma.$queryRaw<OrderQueueRow[]>`
    SELECT o.id::text AS "id",
           o.order_number AS "orderNumber",
           o.status AS "status",
           o.customer_name_snapshot AS "customerName",
           o.customer_phone_snapshot AS "customerPhone",
           o.total_final::text AS "totalFinal",
           o.total_estimated::text AS "totalEstimated",
           o.created_at AS "createdAt"
    FROM orders o
    ${where}
    ORDER BY o.created_at DESC, o.id ASC
    LIMIT ${limit + 1}`;

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return { rows: page, nextCursor: hasMore ? page[page.length - 1].id : null };
}

/** Names of the staff members behind the recorded steps (for the timeline). */
export async function listOrderActorNames(ids: readonly string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id) => UUID_RE.test(id)))];
  if (!wanted.length) return new Map();
  const rows = await prisma.user.findMany({
    where: { id: { in: wanted } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((row) => [row.id, row.name]));
}
