// Delivery-zone READ helper (shared).
//
// The fee resolver and the eligibility resolver must see the SAME rows in the
// SAME transaction — two readers could otherwise disagree (one sees a zone the
// other does not) and produce a contradictory answer for one address. This
// module is the single reader of the active zone rows.

import type { Prisma } from "@prisma/client";
import { parseDeliveryScope, type DeliveryScope } from "@/lib/orders/delivery-scope";

export interface ActiveDeliveryZoneRow {
  id: string;
  name: string;
  normalized_name: string;
  fee: string;
  scope?: DeliveryScope | null;
  is_active?: boolean;
}

export type ZoneDb = Pick<Prisma.TransactionClient, "$queryRaw">;

/**
 * Every ACTIVE delivery zone. The zone table is small and admin-managed, so
 * reading all active rows keeps the matching rule explicit in code
 * (area > village > city) instead of hiding it in a SQL expression.
 */
export async function loadActiveDeliveryZones(db: ZoneDb): Promise<ActiveDeliveryZoneRow[]> {
  const rows=await db.$queryRaw<Array<ActiveDeliveryZoneRow & {scope_text?:string|null}>>`
    SELECT z.id::text AS id, z.name, z.normalized_name, z.fee::text AS fee, z.is_active,
      s.value_text AS scope_text
      FROM delivery_zones z LEFT JOIN store_settings s ON s.key='delivery.zone.' || z.id::text
     WHERE z.is_active = true OR z.normalized_name LIKE 'scope:%'`;
  return rows.map(row=>{
    const scope=parseDeliveryScope(row.scope_text);
    if(row.normalized_name.startsWith("scope:") && !scope)throw Error("Missing delivery scope configuration.");
    return {...row,scope};
  });
}
