// BA-4 customer write domain.
//
// Identity rule: the UNIQUE(phone) constraint arbitrates concurrent
// creates — never application memory. identifyCustomer converges: fast-path
// SELECT → INSERT → on unique violation reselect (NOT blind
// ON CONFLICT DO NOTHING: the row itself is the required outcome).
// Prisma owns every write here (all behavior is representable: plain UQs,
// FK, CHECKs); the single exception is upgradeToRegistered's
// rowcount-checked guard UPDATE, which needs raw SQL for its
// WHERE is_registered = FALSE predicate (documented below).
// IDs are app-generated UUIDv7 (DB gen_random_uuid() is backstop only).
// Passwords never log, never persist except as Argon2id hashes.
import "server-only";
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError, businessRule, conflict } from "@/lib/api/errors";
import { auditInTx } from "@/lib/api/audit";
import { normalizeIdentityPhone, normalizeContactPhone } from "@/lib/customers/phone";
import { checkPasswordPolicy, hashPassword } from "@/lib/auth/password";

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

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003";
}

function isNotFound(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";
}

function phoneError(): ApiError {
  return businessRule("Invalid phone number.", null);
}

export interface IdentifyArgs {
  phoneRaw: string;
  firstName: string;
  lastName: string | null;
}

/**
 * Guest get-or-create by canonical phone (public guest flow + BA-6
 * checkout foundation). No transaction spans multiple statements here on
 * purpose: each statement is atomic and the UNIQUE backstop converges
 * concurrent creators onto one row (SELECT → INSERT → reselect-on-409).
 * Returns the customer plus whether this call created it.
 */
export async function identifyCustomer(args: IdentifyArgs) {
  let canonical: string;
  try {
    canonical = normalizeIdentityPhone(args.phoneRaw);
  } catch {
    throw phoneError();
  }
  const existing = await prisma.customer.findUnique({ where: { phone: canonical } });
  if (existing) return { customer: existing, created: false };
  try {
    const created = await prisma.customer.create({
      data: {
        id: newUuidV7(),
        firstName: args.firstName,
        lastName: args.lastName,
        phone: canonical,
      },
    });
    return { customer: created, created: true };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // Lost the create race: the winner's row is the canonical customer.
    const winner = await prisma.customer.findUnique({ where: { phone: canonical } });
    if (!winner) throw error;
    return { customer: winner, created: false };
  }
}

/**
 * Staff-assisted guest → registered upgrade. Policy + Argon2id via the
 * existing auth infrastructure (never plaintext at rest). The single
 * conditional UPDATE is raw SQL for its rowcount-checked guard
 * (Prisma.update cannot express WHERE is_registered = FALSE): already
 * registered (or lost race) → 409; inactive → 422 before any hashing.
 */
export async function upgradeToRegistered(customerId: string, password: string, actorId: string) {
  const current = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!current) return null;
  if (!current.isActive || current.deletedAt !== null) {
    throw businessRule("Inactive customers cannot be registered.", null);
  }
  if (current.isRegistered || current.passwordHash !== null) {
    throw conflict("Customer is already registered.", null);
  }
  const policyError = checkPasswordPolicy(password);
  if (policyError) throw businessRule("Password does not meet policy.", null);
  const hash = await hashPassword(password);
  // Guard UPDATE + audit in ONE tx (the hash itself is never audited —
  // only the registration fact; frozen audit sanitization rule).
  return prisma.$transaction(async (tx) => {
    const n = await tx.$executeRaw`
      UPDATE customers SET password_hash = ${hash}, is_registered = TRUE, updated_at = now()
       WHERE id = ${customerId}::uuid AND is_registered = FALSE`;
    if (Number(n) === 0) {
      throw conflict("Customer is already registered.", null);
    }
    await auditInTx(tx, {
      action: "customers.register",
      userId: actorId,
      entityType: "customers",
      entityId: customerId,
      oldValues: { isRegistered: false },
      newValues: { isRegistered: true },
    });
    return tx.customer.findUnique({ where: { id: customerId } });
  });
}

export interface CustomerPatch {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  autoAcceptReplacements?: boolean | null;
  isActive?: boolean | null;
}

/** Admin customer edit. Phone is immutable (identity stability — a new
 * number is a new customer); registration state changes only via
 * upgradeToRegistered. Email duplicates (partial UQ) → 409. */
export async function patchCustomer(id: string, patch: CustomerPatch, actorId: string) {
  const data: Record<string, unknown> = {};
  if (patch.firstName !== undefined && patch.firstName !== null) data.firstName = patch.firstName;
  if (patch.lastName !== undefined) data.lastName = patch.lastName;
  if (patch.email !== undefined) data.email = patch.email;
  if (patch.autoAcceptReplacements !== undefined && patch.autoAcceptReplacements !== null) {
    data.autoAcceptReplacements = patch.autoAcceptReplacements;
  }
  if (patch.isActive !== undefined && patch.isActive !== null) data.isActive = patch.isActive;
  try {
    return await prisma.$transaction(async (tx) => {
      const updated = await tx.customer.update({ where: { id }, data });
      const newValues: Record<string, unknown> = {};
      if (data.firstName !== undefined) newValues.firstName = data.firstName;
      if (data.lastName !== undefined) newValues.lastName = data.lastName ?? null;
      if (data.email !== undefined) newValues.email = data.email ?? null;
      if (data.autoAcceptReplacements !== undefined) {
        newValues.autoAcceptReplacements = data.autoAcceptReplacements;
      }
      if (data.isActive !== undefined) newValues.isActive = data.isActive;
      await auditInTx(tx, {
        action: "customers.update",
        userId: actorId,
        entityType: "customers",
        entityId: id,
        oldValues: null,
        newValues,
      });
      return updated;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict("Email is already in use.", null);
    if (isForeignKeyViolation(error)) throw businessRule("Referenced customer does not exist.", null);
    if (isNotFound(error)) return null;
    throw error;
  }
}

export interface AddressInput {
  label?: string | null;
  city: string;
  area?: string | null;
  village?: string | null;
  street?: string | null;
  buildingNumber?: string | null;
  landmark?: string | null;
  phoneRaw: string;
  isDefault?: boolean | null;
}

/**
 * Address create under one customer. Default switch (unset old + set new)
 * runs in ONE explicit transaction; the partial-UQ backstop turns a lost
 * default race into 409 (never two defaults). Contact phone canonicalizes
 * when mobile, passes landlines through (frozen address rule).
 */
export async function createAddress(customerId: string, input: AddressInput, actorId: string) {
  let phone: string;
  try {
    phone = normalizeContactPhone(input.phoneRaw);
  } catch {
    throw phoneError();
  }
  const owner = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
  if (!owner) return null;
  try {
    return await prisma.$transaction(async (tx) => {
      if (input.isDefault === true) {
        await tx.customerAddress.updateMany({ where: { customerId }, data: { isDefault: false } });
      }
      const created = await tx.customerAddress.create({
        data: {
          id: newUuidV7(),
          customerId,
          label: input.label ?? null,
          city: input.city,
          area: input.area ?? null,
          village: input.village ?? null,
          street: input.street ?? null,
          buildingNumber: input.buildingNumber ?? null,
          landmark: input.landmark ?? null,
          phone,
          isDefault: input.isDefault ?? false,
        },
      });
      await auditInTx(tx, {
        action: "addresses.create",
        userId: actorId,
        entityType: "customer_addresses",
        entityId: created.id,
        oldValues: null,
        newValues: { customerId, city: created.city, isDefault: created.isDefault },
      });
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict("A default address already exists for this customer.", null);
    }
    if (isForeignKeyViolation(error)) throw businessRule("Referenced customer does not exist.", null);
    if (error instanceof ApiError) throw error;
    throw error;
  }
}

export interface AddressPatch {
  label?: string | null;
  city?: string | null;
  area?: string | null;
  village?: string | null;
  street?: string | null;
  buildingNumber?: string | null;
  landmark?: string | null;
  phoneRaw?: string | null;
  isDefault?: boolean | null;
}

/** Address update scoped to its owner (cross-customer → null → 404). */
export async function patchAddress(customerId: string, addressId: string, patch: AddressPatch, actorId: string) {
  const scoped = await prisma.customerAddress.findFirst({
    where: { id: addressId, customerId },
    select: { id: true },
  });
  if (!scoped) return null;
  let phone: string | undefined;
  if (patch.phoneRaw !== undefined && patch.phoneRaw !== null) {
    try {
      phone = normalizeContactPhone(patch.phoneRaw);
    } catch {
      throw phoneError();
    }
  }
  try {
    return await prisma.$transaction(async (tx) => {
      if (patch.isDefault === true) {
        await tx.customerAddress.updateMany({
          where: { customerId, id: { not: addressId } },
          data: { isDefault: false },
        });
      }
      const updated = await tx.customerAddress.update({
        where: { id: addressId },
        data: {
          ...(patch.label !== undefined ? { label: patch.label } : {}),
          ...(patch.city !== undefined && patch.city !== null ? { city: patch.city } : {}),
          ...(patch.area !== undefined ? { area: patch.area } : {}),
          ...(patch.village !== undefined ? { village: patch.village } : {}),
          ...(patch.street !== undefined ? { street: patch.street } : {}),
          ...(patch.buildingNumber !== undefined ? { buildingNumber: patch.buildingNumber } : {}),
          ...(patch.landmark !== undefined ? { landmark: patch.landmark } : {}),
          ...(phone !== undefined ? { phone } : {}),
          ...(patch.isDefault !== undefined && patch.isDefault !== null ? { isDefault: patch.isDefault } : {}),
        },
      });
      await auditInTx(tx, {
        action: "addresses.update",
        userId: actorId,
        entityType: "customer_addresses",
        entityId: addressId,
        oldValues: null,
        newValues: { customerId, city: updated.city },
      });
      return updated;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict("A default address already exists for this customer.", null);
    }
    if (isNotFound(error)) return null;
    if (error instanceof ApiError) throw error;
    throw error;
  }
}

/** Hard delete scoped to the owner (frozen: addresses carry no deleted_at;
 * orders keep snapshots, never FKs here). Returns false when missing. */
export async function deleteAddress(customerId: string, addressId: string, actorId: string): Promise<boolean> {
  const scoped = await prisma.customerAddress.findFirst({
    where: { id: addressId, customerId },
    select: { id: true, city: true },
  });
  if (!scoped) return false;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.customerAddress.delete({ where: { id: addressId } });
      await auditInTx(tx, {
        action: "addresses.delete",
        userId: actorId,
        entityType: "customer_addresses",
        entityId: addressId,
        oldValues: { customerId, city: scoped.city },
        newValues: null,
      });
    });
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}
