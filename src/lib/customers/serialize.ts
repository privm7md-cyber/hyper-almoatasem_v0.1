// BA-4 customer serialization (boundary shapes).
//
// password_hash NEVER leaves the server (no shape carries it — verified by
// construction: the field is omitted from every interface below).
// DateTimes as ISO strings. Phone/email already canonical from the writer.
import type { Customer, CustomerAddress } from "@prisma/client";
import { iso } from "@/lib/api/serialize";

export interface CustomerShape {
  id: string;
  firstName: string;
  lastName: string | null;
  phone: string;
  email: string | null;
  isRegistered: boolean;
  autoAcceptReplacements: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toCustomer(c: Customer): CustomerShape {
  return {
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    phone: c.phone,
    email: c.email,
    isRegistered: c.isRegistered,
    autoAcceptReplacements: c.autoAcceptReplacements,
    isActive: c.isActive,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export interface AddressShape {
  id: string;
  customerId: string;
  label: string | null;
  city: string;
  area: string | null;
  village: string | null;
  street: string | null;
  buildingNumber: string | null;
  landmark: string | null;
  phone: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toAddress(a: CustomerAddress): AddressShape {
  return {
    id: a.id,
    customerId: a.customerId,
    label: a.label,
    city: a.city,
    area: a.area,
    village: a.village,
    street: a.street,
    buildingNumber: a.buildingNumber,
    landmark: a.landmark,
    phone: a.phone,
    isDefault: a.isDefault,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

export { iso };
