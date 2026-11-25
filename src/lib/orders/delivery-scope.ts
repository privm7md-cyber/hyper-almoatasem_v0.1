import { z } from "zod";
import { normalizeDeliveryLocality, type DeliveryLocalityField } from "@/lib/orders/delivery-zone";
export const deliveryScopeSchema=z.object({city:z.string().trim().min(1).max(32),locality:z.string().trim().min(1).max(32),field:z.enum(["area","village","city"]),eligible:z.boolean()}).strict();
export type DeliveryScope=z.infer<typeof deliveryScopeSchema>;
export function deliveryScopeKey(city:string,locality:string,field:DeliveryLocalityField):string {
  const c=normalizeDeliveryLocality(city),l=normalizeDeliveryLocality(locality);
  if(!c || !l || c.includes("|") || l.includes("|") || c.includes(":") || l.includes(":"))throw Error("Invalid delivery locality.");
  const key=`scope:${field}:${c}|${field==="city" ? c : l}`;
  if(key.length>80)throw Error("Delivery locality is too long.");
  return key;
}
export function parseDeliveryScope(raw:string|null|undefined):DeliveryScope|null {
  if(!raw)return null;
  const parsed=deliveryScopeSchema.safeParse(JSON.parse(raw));
  if(!parsed.success)throw Error("Invalid delivery scope configuration.");
  return parsed.data;
}
