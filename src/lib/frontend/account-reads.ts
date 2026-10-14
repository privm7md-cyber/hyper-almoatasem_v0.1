// FE-6 viewer reads (server-only): session-derived customer + addresses for RSC pages.
// Verified pattern (FP-13 §3): RSC → server-only lib → DB. Mutations stay on HTTP endpoints.

import "server-only";

import { cookies } from "next/headers";
import { requireCustomer } from "@/lib/customers/session";
import { getCustomer } from "@/lib/customers/queries";
import { toAddress, toCustomer } from "@/lib/customers/serialize";

export interface ViewerAddress {
  id: string;
  label: string | null;
  city: string;
  area: string | null;
  village: string | null;
  street: string | null;
  buildingNumber: string | null;
  landmark: string | null;
  phone: string;
  isDefault: boolean;
}

export interface Viewer {
  id: string;
  firstName: string;
  phone: string;
  addresses: ViewerAddress[];
}

/** Current session viewer, or null (guest/expired/invalid — callers render guest state). */
export async function getViewer(): Promise<Viewer | null> {
  const jar = await cookies();
  const cookieHeader = jar
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  if (cookieHeader === "") return null;
  const probe = new Request("http://localhost/", { headers: { cookie: cookieHeader } });
  let customerId: string;
  try {
    const me = await requireCustomer(probe);
    customerId = me.customerId;
  } catch {
    return null;
  }
  const row = await getCustomer(customerId).catch(() => null);
  if (!row) return null;
  const customer = toCustomer(row);
  return {
    id: customer.id,
    firstName: customer.firstName,
    phone: customer.phone,
    addresses: row.addresses.map((a) => {
      const shaped = toAddress(a);
      return {
        id: shaped.id,
        label: shaped.label,
        city: shaped.city,
        area: shaped.area,
        village: shaped.village,
        street: shaped.street,
        buildingNumber: shaped.buildingNumber,
        landmark: shaped.landmark,
        phone: shaped.phone,
        isDefault: shaped.isDefault,
      };
    }),
  };
}
