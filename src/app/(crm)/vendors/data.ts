import "server-only";
import { forbidden } from "next/navigation";
import { hasPermission } from "@/server/access/can";
import type { AccessContext } from "@/server/access/types";
import { productFormLookups } from "@/server/modules/catalogue/queries";
import { GL_ACCOUNTS } from "@/server/modules/inventory/config";
import { canSeeCost } from "@/server/modules/inventory/queries";
import { getDirectory } from "@/server/modules/org/queries";

/** Who works with vendors: inventory staff (create) and inventory finance. Sales users see no vendors. */
export const canUseVendors = (ctx: AccessContext) => hasPermission(ctx, "inventory", "create") || hasPermission(ctx, "inventoryFinance", "read");

/** Brands, owners and picklists of the vendor form. */
export async function vendorFormProps(ctx: AccessContext) {
  if (!hasPermission(ctx, "inventory", "create")) forbidden();
  const dir = await getDirectory(ctx);
  const brands = dir.myBrands.filter((b) => b.status !== "INACTIVE").map((b) => ({ id: b.id, code: b.code, name: b.name }));
  const lookups = await productFormLookups(ctx, brands.map((b) => b.id));
  return { brands, owners: lookups.owners, glAccounts: GL_ACCOUNTS, finance: canSeeCost(ctx), userId: ctx.userId };
}
