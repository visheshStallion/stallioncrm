/**
 * THE visibility rule (docs/BUSINESS_CONTEXT.md §5). Implemented here once, mirrored in SQL by
 * prisma/rls/001_access_functions.sql. Keep the two in sync – tests compare them on seed data.
 *
 * A user can READ a brand-owned record if ANY of:
 *   1. scope = ALL
 *   2. the user owns the record
 *   3. a membership with brandId = record.brandId AND (membership.regionId IS NULL OR = record.regionId)
 * A user can CREATE a record (or move one) into brand/region only via 1 or 3 – ownership alone never
 * grants a new territory.
 */
import type { AccessContext, BrandOwnedRef } from "./types";

/** Prisma `where` fragment for brand-owned models. `{}` means unrestricted. */
export type BrandScopeWhere =
  | Record<string, never>
  | {
      OR: Array<
        | { ownerId: string }
        | { brandId: string }
        | { brandId: string; regionId: { in: string[] } }
      >;
    };

/**
 * Builds the Prisma filter for the visibility rule. Memberships are compacted per brand:
 * a brand-level membership subsumes every regional membership of the same brand.
 */
export function brandScopeWhere(ctx: AccessContext): BrandScopeWhere {
  if (ctx.scope === "ALL") return {};

  const byBrand = new Map<string, Set<string> | "ALL_REGIONS">();
  for (const m of ctx.memberships) {
    const current = byBrand.get(m.brandId);
    if (m.regionId === null) {
      byBrand.set(m.brandId, "ALL_REGIONS");
    } else if (current !== "ALL_REGIONS") {
      const set = current ?? new Set<string>();
      set.add(m.regionId);
      byBrand.set(m.brandId, set);
    }
  }

  const territoryClauses = [...byBrand.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([brandId, regions]) =>
      regions === "ALL_REGIONS"
        ? { brandId }
        : { brandId, regionId: { in: [...regions].sort() } },
    );

  return { OR: [{ ownerId: ctx.userId }, ...territoryClauses] };
}

/** True if a membership (scope ALL or territory) covers brand/region – ownership NOT considered. */
export function hasTerritoryAccess(
  ctx: AccessContext,
  brandId: string,
  regionId: string,
): boolean {
  if (ctx.scope === "ALL") return true;
  return ctx.memberships.some(
    (m) => m.brandId === brandId && (m.regionId === null || m.regionId === regionId),
  );
}

/** In-memory visibility check – same rule as brandScopeWhere. */
export function isVisible(ctx: AccessContext, record: BrandOwnedRef): boolean {
  if (ctx.scope === "ALL") return true;
  if (record.ownerId && record.ownerId === ctx.userId) return true;
  return hasTerritoryAccess(ctx, record.brandId, record.regionId);
}

/** May the user place a record in this brand/region (create, or move via update)? */
export function canWriteTo(ctx: AccessContext, brandId: string, regionId: string): boolean {
  return hasTerritoryAccess(ctx, brandId, regionId);
}

/** Session payload for Postgres RLS (`app.memberships`). */
export function rlsMemberships(ctx: AccessContext): Array<{ brandId: string; regionId: string | null }> {
  return ctx.memberships.map((m) => ({ brandId: m.brandId, regionId: m.regionId }));
}

/**
 * "Brand Manager+" for a record: scope ALL (Management / Administrator), or a MANAGER membership that covers
 * the record's brand and region (Brand Manager: whole brand; RSM: their regions).
 */
export function isManagerOf(ctx: AccessContext, brandId: string, regionId: string): boolean {
  if (ctx.scope === "ALL") return true;
  return ctx.memberships.some((m) => m.isManager && m.brandId === brandId && (m.regionId === null || m.regionId === regionId));
}
