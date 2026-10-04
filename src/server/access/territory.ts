/**
 * Territory resolution (BUSINESS_CONTEXT §5): brand X + region Y → level-2 territory "X – Y".
 * Functions take a Prisma client explicitly so they work with the system client (seed, admin jobs,
 * scopedDb internals) without importing it here.
 */
import type { Prisma } from "@prisma/client";

type Db = Prisma.TransactionClient;

export const ROOT_TERRITORY_NAME = "Group – All Brands";

export function brandTerritoryName(brandCode: string): string {
  return brandCode;
}

export function brandRegionTerritoryName(brandCode: string, regionName: string): string {
  return `${brandCode} – ${regionName}`;
}

export class TerritoryNotFoundError extends Error {
  constructor(brandId: string, regionId: string) {
    super(`No territory for brand ${brandId} / region ${regionId}`);
    this.name = "TerritoryNotFoundError";
  }
}

/** Returns the level-2 territory id for brand + region. Throws if it does not exist. */
export async function resolveTerritory(db: Db, brandId: string, regionId: string): Promise<string> {
  const t = await db.territory.findUnique({
    where: { brandId_regionId: { brandId, regionId } },
    select: { id: true, level: true },
  });
  if (!t || t.level !== 2) throw new TerritoryNotFoundError(brandId, regionId);
  return t.id;
}

export async function ensureRootTerritory(db: Db): Promise<string> {
  const root = await db.territory.upsert({
    where: { name: ROOT_TERRITORY_NAME },
    update: {},
    create: { name: ROOT_TERRITORY_NAME, level: 0 },
  });
  return root.id;
}

/**
 * Called when a brand is created: brand territory (level 1, manager = brand manager) under the
 * root + one "BRAND – Region" child per active region. Idempotent.
 */
export async function ensureBrandTerritories(db: Db, brandId: string): Promise<void> {
  const rootId = await ensureRootTerritory(db);
  const brand = await db.brand.findUniqueOrThrow({ where: { id: brandId } });
  const existing = await db.territory.findFirst({ where: { brandId, regionId: null, level: 1 } });
  const brandTerritory =
    existing ??
    (await db.territory.create({
      data: {
        name: brandTerritoryName(brand.code),
        level: 1,
        parentId: rootId,
        brandId,
        managerId: brand.brandManagerId,
      },
    }));

  const regions = await db.region.findMany({ where: { active: true } });
  for (const region of regions) {
    await db.territory.upsert({
      where: { brandId_regionId: { brandId, regionId: region.id } },
      update: {},
      create: {
        name: brandRegionTerritoryName(brand.code, region.name),
        level: 2,
        parentId: brandTerritory.id,
        brandId,
        regionId: region.id,
      },
    });
  }
}

/** Called when a region is added: one "BRAND – Region" child under every brand. Idempotent. */
export async function ensureRegionTerritories(db: Db, regionId: string): Promise<void> {
  const region = await db.region.findUniqueOrThrow({ where: { id: regionId } });
  const brandTerritories = await db.territory.findMany({
    where: { level: 1, regionId: null, brandId: { not: null } },
    include: { brand: true },
  });
  for (const bt of brandTerritories) {
    if (!bt.brandId || !bt.brand) continue;
    await db.territory.upsert({
      where: { brandId_regionId: { brandId: bt.brandId, regionId } },
      update: {},
      create: {
        name: brandRegionTerritoryName(bt.brand.code, region.name),
        level: 2,
        parentId: bt.id,
        brandId: bt.brandId,
        regionId,
      },
    });
  }
}
