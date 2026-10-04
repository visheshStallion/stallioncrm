/**
 * UI filters (brand switcher / region filter). They only ever NARROW results: they are ANDed with
 * the scope enforced by scopedDb, and values outside the user's access are discarded here too.
 */
import type { AccessContext } from "./types";

export interface UiFilters {
  brandId?: string | null;
  regionId?: string | null;
}

/** Region ids the user can see something in (null = every region). */
export function visibleRegionIds(ctx: AccessContext): string[] | null {
  if (ctx.scope === "ALL") return null;
  if (ctx.memberships.some((m) => m.regionId === null)) return null;
  return [...new Set(ctx.memberships.map((m) => m.regionId as string))].sort();
}

/** Drops filter values the user has no access to. */
export function sanitizeFilters(ctx: AccessContext, filters: UiFilters): UiFilters {
  const brandId =
    filters.brandId && ctx.brandIds.includes(filters.brandId) ? filters.brandId : null;
  const regions = visibleRegionIds(ctx);
  const regionId =
    filters.regionId && (regions === null || regions.includes(filters.regionId))
      ? filters.regionId
      : null;
  return { brandId, regionId };
}

/** Prisma `where` fragment for the (sanitized) filters. */
export function filterWhere(
  ctx: AccessContext,
  filters: UiFilters,
): { brandId?: string; regionId?: string } {
  const f = sanitizeFilters(ctx, filters);
  return {
    ...(f.brandId ? { brandId: f.brandId } : {}),
    ...(f.regionId ? { regionId: f.regionId } : {}),
  };
}
