// Opportunistic TTL housekeeping for ephemeral database tables (GAP-05 remediation).
//
// Safely deletes ONLY expired rows from ephemeral tables:
//   - customer_sessions (WHERE expires_at < now())
//   - admin_sessions (WHERE expires_at < now())
//   - idempotency_keys (WHERE expires_at < now())
//   - guest ACTIVE carts (WHERE status = 'ACTIVE' AND customer_id IS NULL AND expires_at < now())
//
// NEVER touches orders, order_items, audit_logs, inventory_movements, or
// guest_order_credentials (evidentiary and order-access records are preserved).
import "server-only";
import { prisma } from "@/lib/db";

export interface HousekeepingReport {
  expiredCustomerSessions: number;
  expiredAdminSessions: number;
  expiredIdempotencyKeys: number;
  expiredGuestCarts: number;
}

export async function pruneExpiredEphemeralRows(): Promise<HousekeepingReport> {
  const [
    expiredCustomerSessions,
    expiredAdminSessions,
    expiredIdempotencyKeys,
    expiredGuestCarts,
  ] = await Promise.all([
    prisma.$executeRaw`
      DELETE FROM customer_sessions
       WHERE expires_at < now()
    `.catch(() => 0),
    prisma.$executeRaw`
      DELETE FROM admin_sessions
       WHERE expires_at < now()
    `.catch(() => 0),
    prisma.$executeRaw`
      DELETE FROM idempotency_keys
       WHERE expires_at < now()
    `.catch(() => 0),
    prisma.$executeRaw`
      DELETE FROM carts
       WHERE status = 'ACTIVE'
         AND customer_id IS NULL
         AND expires_at IS NOT NULL
         AND expires_at < now()
    `.catch(() => 0),
  ]);
  return {
    expiredCustomerSessions: Number(expiredCustomerSessions),
    expiredAdminSessions: Number(expiredAdminSessions),
    expiredIdempotencyKeys: Number(expiredIdempotencyKeys),
    expiredGuestCarts: Number(expiredGuestCarts),
  };
}
