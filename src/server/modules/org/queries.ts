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
}
export interface RegionInfo {
  id: string;
  name: string;
}

/** Brands + regions for badges and filters (request-cached). */
export const getDirectory = cache(async (ctx: AccessContext) => {
  const db = scopedDb(ctx);
  const [brands, regions] = await Promise.all([
    db.brand.findMany({
      select: { id: true, code: true, name: true, color: true, status: true },
      orderBy: { code: "asc" },
    }),
    db.region.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
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
