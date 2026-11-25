// Admin delivery-zone domain (residual Phase-10 closure, P10-L-02).
//
// Zones are explicit fee overrides keyed by the SAME normalization applied at
// checkout (`normalizeDeliveryLocality`). The admin write path is the sole
// producer of zone keys: the resolver never guesses, never fuzzes, never uses
// distance/GPS.
//
// Concurrency: updates/deletes carry the row `version` the admin read. The
// guarded UPDATE/DELETE returns rowcount 0 when someone else changed the row
// first → 409 (never a silent last-write-wins). A timestamp would be unsafe at
// JS millisecond precision.
//
// Every mutation pairs its audit row in the same transaction. Only
// `settings.manage` (SUPER_ADMIN) reaches these functions — enforced at the
// route boundary, mirroring store settings.
import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { businessRule, conflict } from "@/lib/api/errors";
import { auditInTx } from "@/lib/api/audit";
import { normalizeDeliveryLocality } from "@/lib/orders/delivery-zone";
import { deliveryScopeKey, parseDeliveryScope, deliveryScopeSchema, type DeliveryScope } from "@/lib/orders/delivery-scope";
import { assertAdminPreviewWritesAllowed } from "@/lib/auth/admin-read-only-preview";

export interface DeliveryZoneInput {
  name: string;
  fee: string;
  isActive?: boolean | null;
  scope?: DeliveryScope;
}

export interface DeliveryZonePatchInput {
  name?: string | null;
  fee?: string | null;
  isActive?: boolean | null;
  version: number;
  scope?: DeliveryScope;
}

function normalizedNameOrThrow(name: string): string {
  const normalized = normalizeDeliveryLocality(name);
  if (normalized === null) {
    throw businessRule("Delivery zone name is empty after normalization.", null);
  }
  return normalized;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function listDeliveryZones(active?: boolean | null) {
  const rows=await prisma.deliveryZone.findMany({
    where: active === undefined || active === null ? undefined : { isActive: active },
    orderBy: [{ name: "asc" as const }],
  });
  const scopes=await loadDeliveryScopes(rows.map(row=>row.id));
  return rows.map(row=>({...row,scope:scopes.get(row.id) ?? null}));
}

export async function loadDeliveryScopes(ids:string[]) {
  if(!ids.length)return new Map<string,DeliveryScope>();
  const settings=await prisma.storeSetting.findMany({where:{key:{in:ids.map(id=>`delivery.zone.${id}`)}}});
  return new Map(settings.map(s=>[s.key.slice("delivery.zone.".length),parseDeliveryScope(s.valueText)!]));
}

async function saveScope(tx:Prisma.TransactionClient,id:string,scope:DeliveryScope,actorId:string) {
  const key=`delivery.zone.${id}`,valueText=JSON.stringify(scope);
  await tx.storeSetting.upsert({where:{key},create:{key,valueText,valueType:"JSON",updatedBy:actorId},update:{valueText,updatedBy:actorId}});
}

function scopeKey(scope:DeliveryScope):string {
  if(!deliveryScopeSchema.safeParse(scope).success)throw businessRule("Invalid delivery scope.");
  try{return deliveryScopeKey(scope.city,scope.locality,scope.field);}catch{throw businessRule("Invalid delivery locality.");}
}

export function countDeliveryZones() {
  return prisma.deliveryZone.count();
}

export async function createDeliveryZone(input: DeliveryZoneInput, actorId: string) {
  assertAdminPreviewWritesAllowed();
  const normalizedName = input.scope ? scopeKey(input.scope) : normalizedNameOrThrow(input.name);
  try {
    return await prisma.$transaction(async (tx) => {
      const zone = await tx.deliveryZone.create({
        data: {
          name: input.name,
          normalizedName,
          fee: new Prisma.Decimal(input.fee),
          isActive: input.isActive ?? true,
        },
      });
      if(input.scope)await saveScope(tx,zone.id,input.scope,actorId);
      await auditInTx(tx, {
        action: "delivery_zones.create",
        userId: actorId,
        entityType: "delivery_zones",
        entityId: zone.id,
        oldValues: null,
        newValues: {
          name: zone.name,
          normalizedName: zone.normalizedName,
          fee: zone.fee.toString(),
          isActive: zone.isActive,
          scope:input.scope ?? null,
        },
      });
      return {...zone,scope:input.scope ?? null};
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict("A delivery zone with this name already exists.", { normalizedName });
    }
    throw error;
  }
}

/** Null when the zone does not exist (route answers 404). */
export async function updateDeliveryZone(
  id: string,
  input: DeliveryZonePatchInput,
  actorId: string,
) {
  assertAdminPreviewWritesAllowed();
  const data: Prisma.DeliveryZoneUpdateManyMutationInput = {};
  if (input.name != null) {
    data.name = input.name;
  }
  if (input.fee != null) data.fee = new Prisma.Decimal(input.fee);
  if (input.isActive != null) data.isActive = input.isActive;
  data.version = { increment: 1 };
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM delivery_zones WHERE id=${id}::uuid FOR UPDATE`;
      const existing=await tx.deliveryZone.findUnique({where:{id}});
      if(!existing)return null;
      const setting=await tx.storeSetting.findUnique({where:{key:`delivery.zone.${id}`}});
      const oldScope=parseDeliveryScope(setting?.valueText),scope=input.scope ?? oldScope;
      if(existing.normalizedName.startsWith("scope:") && !scope)throw businessRule("Missing delivery scope configuration.");
      if(scope)data.normalizedName=scopeKey(scope);
      else if(input.name!=null)data.normalizedName=normalizedNameOrThrow(input.name);
      const updated = await tx.deliveryZone.updateMany({
        where: { id, version: input.version },
        data,
      });
      if (updated.count === 0) {
        throw conflict("Delivery zone changed concurrently; reload and retry.", { zoneId: id });
      }
      const zone = await tx.deliveryZone.findUniqueOrThrow({ where: { id } });
      if(input.scope)await saveScope(tx,id,input.scope,actorId);
      await auditInTx(tx, {
        action: "delivery_zones.update",
        userId: actorId,
        entityType: "delivery_zones",
        entityId: id,
        oldValues: {
          name: existing.name,
          normalizedName: existing.normalizedName,
          fee: existing.fee.toString(),
          isActive: existing.isActive,
          version: existing.version,
          scope:oldScope,
        },
        newValues: {
          name: zone.name,
          normalizedName: zone.normalizedName,
          fee: zone.fee.toString(),
          isActive: zone.isActive,
          version: zone.version,
          scope,
        },
      });
      return {...zone,scope};
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict("A delivery zone with this name already exists.", null);
    }
    throw error;
  }
}
