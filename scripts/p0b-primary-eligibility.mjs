// P0-B evidence — delivery-zone situation on PRIMARY (read-only; SELECTs only).
// - delivery_zones row count (expected: 0 — matches the directive observation)
// - existing zones (none)
// - backend-authoritative quote for a sample address: UNCONFIGURED (no zones) + default fee
import { readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
for (const m of readFileSync(".env", "utf8").matchAll(/^\s*([\w-]+)\s*=\s*"?([^"\r\n]*)"?\s*$/gm)) process.env[m[1]] ??= m[2];
registerHooks({ resolve(s,c,next){
  if(s==='server-only')return next(pathToFileURL(path.resolve('vitest.server-only-stub.cjs')).href,c);
  if(s.startsWith('@/'))return next(pathToFileURL(path.resolve('src',s.slice(2)+'.ts')).href,c);
  return next(s,c);
}});
const { prisma } = await import('@/lib/db');
const { loadActiveDeliveryZones } = await import('@/lib/orders/delivery-zones-read');
const { resolveDeliveryQuote } = await import('@/lib/orders/delivery-fee');
const { getSetting } = await import('@/lib/admin/queries');

const zones = await prisma.deliveryZone.findMany();
const defaultFee = await getSetting("delivery.default_fee").catch(() => null);
const quote = await resolveDeliveryQuote(prisma, { city: "مركز تجريبي", village: "قرية تجريبية" });
const evidence = {
  generatedAt: new Date().toISOString(),
  zoneCount: zones.length,
  activeZones: await loadActiveDeliveryZones(prisma).then((rows)=>rows.length),
  zones: zones.map((z) => ({ id: z.id, name: z.name, normalizedName: z.normalizedName, fee: z.fee.toString(), isActive: z.isActive })),
  deliveryDefaultFee: defaultFee,
  quote: { status: quote.eligibility.status, serviceable: quote.eligibility.serviceable, reason: quote.eligibility.reason, feeSource: quote.fee.source, fee: quote.fee.fee },
};
console.log(JSON.stringify(evidence, null, 2));
writeFileSync("_recovery/v1-ops/evidence/p0b-primary-eligibility.json", JSON.stringify(evidence, null, 2) + "\n");
await prisma.$disconnect();
