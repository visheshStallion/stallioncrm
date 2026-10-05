import "server-only";
import { cache } from "react";
import { visibleRegionIds } from "@/server/access/filters";
import type { AccessContext } from "@/server/access/types";
import { scopedDb } from "@/server/db";

export interface BrandInfo {
  id: string;
  code: string;
  name: string;
  color: string | null;
  status: string;
  /** an uploaded logo exists (served by /api/v1/brands/[id]/logo) */
  hasLogo: boolean;
}
export interface RegionInfo {
  id: string;
  name: string;
}

/** Brands + regions for badges and filters (request-cached). */
export const getDirectory = cache(async (ctx: AccessContext) => {
  const db = scopedDb(ctx);
  const [brandRows, regions] = await Promise.all([
    db.brand.findMany({
      select: { id: true, code: true, name: true, color: true, status: true, logoMimeType: true },
      orderBy: { code: "asc" },
    }),
    db.region.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const brands = brandRows.map(({ logoMimeType, ...b }) => ({ ...b, hasLogo: !!logoMimeType }));
  const allowedRegions = visibleRegionIds(ctx);
  return {
    brands: brands as BrandInfo[],
    regions: regions as RegionInfo[],
    myBrands: brands.filter((b) => ctx.brandIds.includes(b.id) && b.status !== "INACTIVE") as BrandInfo[],
    myRegions: (allowedRegions === null
      ? regions
      : regions.filter((r) => allowedRegions.includes(r.id))) as RegionInfo[],
  };
});
