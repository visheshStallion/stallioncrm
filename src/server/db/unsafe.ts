/**
 * ⚠️  RAW, UNSCOPED Prisma client. Bypasses brand isolation (and RLS – it connects as the table owner).
 * ESLint forbids importing this file outside src/server/db (plus seed, scripts and tests).
 * Application code uses scopedDb(ctx) from "@/server/db".
 */
import "server-only";
import { PrismaClient } from "@prisma/client";

export function createPrismaClient() {
  return new PrismaClient({
    // Vercel's Neon integration, connected with the prefix DATABASE_URL, only provides DATABASE_URL_UNPOOLED
    datasourceUrl: process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED,
    // Never return password hashes unless a query opts in explicitly (login only).
    omit: { user: { passwordHash: true, totpSecret: true } },
    log: process.env.PRISMA_LOG_QUERIES ? ["query", "warn", "error"] : ["warn", "error"],
  });
}

export type UnsafeDb = ReturnType<typeof createPrismaClient>;

const globalForPrisma = globalThis as unknown as { __stallionPrisma?: UnsafeDb };

export const unsafeDb: UnsafeDb = globalForPrisma.__stallionPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.__stallionPrisma = unsafeDb;
