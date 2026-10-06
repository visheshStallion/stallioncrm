/**
 * Brand document rules (prompt 23) – system client. NOTHING here checks access: the caller (documents/rules.ts) has
 * checked the Setup tier and the brand scope.
 */
import "server-only";
import type { Prisma } from "@prisma/client";
import { unsafeDb } from "./unsafe";

export const activeBrands = (ids: string[] | null) => unsafeDb.brand.findMany({ where: { status: { not: "INACTIVE" }, ...(ids === null ? {} : { id: { in: ids } }) }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } });
export const brandRules = (brandId: string) => unsafeDb.brand.findUniqueOrThrow({ where: { id: brandId }, select: { documentRules: true } });
export const writeBrandRules = (brandId: string, rules: Prisma.InputJsonValue) => unsafeDb.brand.update({ where: { id: brandId }, data: { documentRules: rules }, select: { id: true } });

/** Nightly overdue flag (prompt 26): issued / sent / partially paid invoices past their due date with a balance. */
export async function markOverdue(today: Date): Promise<number> {
  return unsafeDb.$executeRaw`UPDATE "Invoice" SET "status" = 'OVERDUE', "updatedAt" = now()
    WHERE "status" IN ('ISSUED', 'SENT', 'PART_PAID') AND "deletedAt" IS NULL AND "dueDate" < ${today}::date
      AND "total" - "amountPaid" - "creditedAmount" > 0.005`;
}
