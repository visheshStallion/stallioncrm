/**
 * Document dependency rules per brand (prompt 23 §7, Setup → Modules and Fields → Dependencies): everything is
 * optional by default; a brand can make links mandatory. Changes apply to NEW documents only – the page shows how
 * many open documents would not meet a rule. Administrators for every brand, Brand Admins for their own.
 */
import "server-only";
import type { AccessContext } from "@/server/access/types";
import { audit } from "@/server/db";
import { unsafeDb } from "@/server/db/unsafe";
import { assertSetup, assertSetupBrand, setupBrandIds } from "@/server/modules/setup/access";
import { DOCUMENT_RULES, documentRulesSchema, parseRules, type DocumentRules } from "./config";
import { ruleViolations } from "./service";

export async function rulesBrands(ctx: AccessContext) {
  assertSetup(ctx, "document-dependencies");
  const scope = setupBrandIds(ctx);
  return unsafeDb.brand.findMany({ where: { status: { not: "INACTIVE" }, ...(scope === null ? {} : { id: { in: scope } }) }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } });
}

export async function rulesFor(ctx: AccessContext, brandId: string): Promise<{ rules: DocumentRules; violations: Record<string, number> }> {
  assertSetup(ctx, "document-dependencies");
  assertSetupBrand(ctx, brandId);
  const b = await unsafeDb.brand.findUniqueOrThrow({ where: { id: brandId }, select: { documentRules: true } });
  return { rules: parseRules(b.documentRules), violations: await ruleViolations(ctx, brandId) };
}

export async function saveRules(ctx: AccessContext, brandId: string, input: unknown) {
  assertSetup(ctx, "document-dependencies");
  assertSetupBrand(ctx, brandId);
  const rules = documentRulesSchema.parse(input);
  const before = await unsafeDb.brand.findUniqueOrThrow({ where: { id: brandId }, select: { documentRules: true } });
  await unsafeDb.brand.update({ where: { id: brandId }, data: { documentRules: rules } });
  await audit({ ctx, action: "UPDATE", entity: "Brand", entityId: brandId, brandId, before: { documentRules: before.documentRules }, after: { documentRules: rules } });
}

export { DOCUMENT_RULES };
