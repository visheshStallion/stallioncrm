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
