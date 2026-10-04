/**
 * Brand-TAGGED master data (products, price books, stock references): not owned by a territory, but visible
 * only to users of that brand and editable by the brand's manager or an administrator.
 *  - scopedDb injects `brandTagWhere` into every read / bulk operation on these models (layer 1);
 *  - RLS policy `brand_tag` enforces the same in Postgres (layer 2, app_enable_brand_tag_rls).
 */
import { hasPermission } from "./can";
import { ForbiddenError } from "./errors";
import type { ModuleKey } from "./modules";
import type { AccessContext } from "./types";

/** Models with a `brandId` that are filtered to the user's brands. New ones need app_enable_brand_tag_rls(). */
export const BRAND_TAGGED_MODELS: ReadonlySet<string> = new Set(["Product", "PriceBook", "VehicleStockRef", "Campaign"]);

export function isBrandTaggedModel(model: string | undefined): boolean {
  return !!model && BRAND_TAGGED_MODELS.has(model);
}

/** Prisma `where` fragment: `{}` for scope ALL, otherwise the user's brands. */
export function brandTagWhere(ctx: AccessContext): { brandId?: { in: string[] } } {
  return ctx.scope === "ALL" ? {} : { brandId: { in: ctx.brandIds } };
}

/**
 * Lookup-filter enforcement (server-side): a record of brand X may only reference products, price books or
 * stock of brand X. `refBrandId` is null/undefined when the referenced row does not exist or is not visible.
 */
export function assertSameBrand(recordBrandId: string, refBrandId: string | null | undefined, what = "The product"): void {
  if (!refBrandId || refBrandId !== recordBrandId) {
    throw new ForbiddenError(`${what} must belong to the record's brand`);
  }
}

/** Brands whose master data the user manages: brand-level manager memberships (the Brand Manager). */
export function managedBrands(ctx: AccessContext): string[] {
  return ctx.memberships.filter((m) => m.regionId === null && m.isManager).map((m) => m.brandId);
}

/** May the user create / edit master data of this brand? Administrators: any brand; Brand Managers: their own. */
export function canManageBrandData(ctx: AccessContext, module: ModuleKey, action: "create" | "edit" | "delete", brandId: string): boolean {
  if (!hasPermission(ctx, module, action)) return false;
  return ctx.scope === "ALL" || managedBrands(ctx).includes(brandId);
}

export function assertCanManageBrandData(ctx: AccessContext, module: ModuleKey, action: "create" | "edit" | "delete", brandId: string): void {
  if (!canManageBrandData(ctx, module, action, brandId)) {
    throw new ForbiddenError("Only the Brand Manager of this brand or an administrator can change its catalogue");
  }
}
