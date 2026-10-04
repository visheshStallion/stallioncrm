import { describe, expect, it } from "vitest";
import { loadAccessContext } from "@/server/access/context";
import {
  ensureBrandTerritories,
  ensureRegionTerritories,
  resolveTerritory,
  TerritoryNotFoundError,
} from "@/server/access/territory";
import { ACTIVE_BRANDS, REGIONS } from "../../prisma/seed-data";
import type { Prisma } from "@prisma/client";
import { ctxFor, ids, unsafeDb, userId } from "./helpers";

const sys = unsafeDb as unknown as Prisma.TransactionClient;

describe("territory tree & resolution", () => {
  it("seed has 1 root + 10 brand + 40 brand-region territories", async () => {
    expect(await unsafeDb.territory.count({ where: { level: 0 } })).toBe(1);
    expect(await unsafeDb.territory.count({ where: { level: 1 } })).toBe(10);
    expect(await unsafeDb.territory.count({ where: { level: 2 } })).toBe(40);
  });

  it("resolveTerritory(brand, region) → 'BRAND – Region'", async () => {
    const I = await ids();
    for (const b of ACTIVE_BRANDS) {
      for (const r of REGIONS) {
        const id = await resolveTerritory(sys, I.brand(b), I.region(r));
        const t = await unsafeDb.territory.findUniqueOrThrow({ where: { id } });
        expect(t.name).toBe(`${b} – ${r}`);
      }
    }
    await expect(resolveTerritory(sys, "nope", I.region("Lagos"))).rejects.toBeInstanceOf(
      TerritoryNotFoundError,
    );
  });

  it("new brand → brand territory + one child per active region; new region → child under every brand", async () => {
    const brand = await unsafeDb.brand.create({ data: { code: "TESTBRAND", name: "Test brand", status: "FUTURE" } });
    let regionId: string | undefined;
    try {
      await ensureBrandTerritories(sys, brand.id);
      await ensureBrandTerritories(sys, brand.id); // idempotent
      const own = await unsafeDb.territory.findMany({ where: { brandId: brand.id }, orderBy: { level: "asc" } });
      expect(own.map((t) => t.name)).toEqual(
        expect.arrayContaining(["TESTBRAND", ...REGIONS.map((r) => `TESTBRAND – ${r}`)]),
      );
      expect(own).toHaveLength(1 + REGIONS.length);

      const region = await unsafeDb.region.create({ data: { name: "Kano (test)" } });
      regionId = region.id;
      await ensureRegionTerritories(sys, region.id);
      const brandCount = await unsafeDb.territory.count({ where: { level: 1 } });
      expect(await unsafeDb.territory.count({ where: { regionId: region.id } })).toBe(brandCount);
    } finally {
      await unsafeDb.territory.deleteMany({ where: { OR: [{ regionId }, { brandId: brand.id }], level: 2 } });
      await unsafeDb.territory.deleteMany({ where: { brandId: brand.id } });
      if (regionId) await unsafeDb.region.delete({ where: { id: regionId } });
      await unsafeDb.pipeline.deleteMany({ where: { brandId: brand.id } }); // default pipeline created with the brand
      await unsafeDb.brand.delete({ where: { id: brand.id } });
    }
  });
});

describe("getAccessContext", () => {
  it("multi-brand Lagos rep has two Lagos memberships", async () => {
    const ctx = await ctxFor("exec.multi.1");
    const I = await ids();
    expect(ctx.scope).toBe("TERRITORY");
    expect(ctx.memberships.map((m) => `${I.brandCode(m.brandId)}|${I.regionName(m.regionId!)}`).sort()).toEqual([
      "HMNL|Lagos",
      "SNMNL|Lagos",
    ]);
    expect(ctx.brandIds).toHaveLength(2);
    expect(ctx.isAdmin).toBe(false);
  });

  it("brand manager has a brand-level membership", async () => {
    const ctx = await ctxFor("bm.hmnl");
    expect(ctx.memberships).toHaveLength(1);
    expect(ctx.memberships[0]!.regionId).toBeNull();
    expect(ctx.memberships[0]!.isManager).toBe(true);
  });

  it("management: scope ALL, sees all non-inactive brands; admin isAdmin", async () => {
    const md = await ctxFor("md");
    expect(md.scope).toBe("ALL");
    expect(md.brandIds).toHaveLength(10);
    expect((await ctxFor("admin")).isAdmin).toBe(true);
  });

  it("inactive users get no context", async () => {
    const id = await userId("exec.ph");
    await unsafeDb.user.update({ where: { id }, data: { active: false } });
    try {
      expect(await loadAccessContext(id)).toBeNull();
    } finally {
      await unsafeDb.user.update({ where: { id }, data: { active: true } });
    }
  });
});
