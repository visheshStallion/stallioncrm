/**
 * Who may open which Setup function (prompt 19 §1). Pure: decided from the access context and the catalogue.
 *
 *   Super Admin   everything
 *   Administrator every function that is not Super-Admin-only
 *   Brand Admin   the functions marked `brandAdminReady`, for the own brand(s) only
 *   other profile the delegable functions ticked under "Setup permissions" of the profile
 *   everyone      the functions open to ALL (personal settings)
 *
 * A function the user may not open answers 404 – Setup does not reveal what exists.
 */
import { NotFoundError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { SETUP_CATALOGUE, SETUP_CATEGORY_DEFS, findEntry, hrefOf, type SetupEntry, type SetupTier } from "./catalogue";

export type EffectiveTier = "SA" | "ADMIN" | "BRAND_ADMIN" | "LIMITED" | "USER";

export function tierOf(ctx: AccessContext): EffectiveTier {
  if (ctx.system) return "USER";
  if (ctx.isSuperAdmin) return "SA";
  if (ctx.isAdmin) return "ADMIN";
  if (ctx.brandAdminOf?.length) return "BRAND_ADMIN";
  if (ctx.setupSections?.length) return "LIMITED";
  return "USER";
}

const has = (entry: SetupEntry, tier: SetupTier) => entry.tiers.includes(tier);

/** May this user open the function at all? (For a Brand Admin: for the own brands – see `setupBrandIds`.) */
export function setupAccess(ctx: AccessContext, entry: SetupEntry): boolean {
  if (ctx.system) return false;
  if (has(entry, "ALL")) return true;
  if (ctx.isSuperAdmin) return true;
  if (has(entry, "SA") && !has(entry, "ADMIN")) return false;
  if (ctx.isAdmin) return has(entry, "ADMIN");
  if (ctx.brandAdminOf?.length && has(entry, "BRAND_ADMIN") && entry.brandAdminReady) return true;
  if (ctx.setupSections?.includes(entry.key) && has(entry, "ADMIN") && entry.delegable) return true;
  return false;
}

/** The catalogue entry, or 404 when it does not exist or is not for this user. Every Setup page and action starts here. */
export function assertSetup(ctx: AccessContext, key: string): SetupEntry {
  const entry = findEntry(key);
  if (!entry || !setupAccess(ctx, entry)) throw new NotFoundError();
  return entry;
}

export function assertSuperAdmin(ctx: AccessContext): void {
  if (!ctx.isSuperAdmin) throw new NotFoundError();
}

/**
 * Brands a brand-scoped Setup function covers for this user: null = every brand (Administrator and above),
 * otherwise the brands the user administers as Brand Admin.
 */
export function setupBrandIds(ctx: AccessContext): string[] | null {
  if (ctx.isAdmin) return null;
  return ctx.brandAdminOf ?? [];
}

/** 404 unless the brand is inside the user's Setup scope. */
export function assertSetupBrand(ctx: AccessContext, brandId: string): void {
  const brands = setupBrandIds(ctx);
  if (brands !== null && !brands.includes(brandId)) throw new NotFoundError();
}

/** Does the user see Setup beyond the personal settings (→ the gear in the header)? */
export function hasSetupArea(ctx: AccessContext): boolean {
  return tierOf(ctx) !== "USER";
}

export interface VisibleCategory {
  key: string;
  title: string;
  description: string;
  items: Array<{ key: string; href: string; label: string; description: string; status: SetupEntry["status"]; priority: SetupEntry["priority"]; superAdminOnly: boolean }>;
}

/** The catalogue as this user sees it (categories without any accessible function are left out). */
export function visibleCatalogue(ctx: AccessContext): VisibleCategory[] {
  return SETUP_CATEGORY_DEFS.map((c) => ({
    ...c,
    items: SETUP_CATALOGUE.filter((x) => x.category === c.key && setupAccess(ctx, x)).map((x) => ({
      key: x.key,
      href: hrefOf(x),
      label: x.label,
      description: x.description,
      status: x.status,
      priority: x.priority,
      superAdminOnly: x.tiers.length === 1 && x.tiers[0] === "SA",
    })),
  })).filter((c) => c.items.length > 0);
}
