import "server-only";
// Central Prisma Client singleton (Next.js server runtime only).
// Prisma 7 requires an explicit driver adapter: @prisma/adapter-pg over the
// existing `pg` driver. The connection string always comes from
// process.env.DATABASE_URL at first use (never hard-coded, never logged).
// This module performs no queries on import.
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function createClient(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  const adapter = new PrismaPg({ connectionString: url });
  return new PrismaClient({ adapter });
}

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
