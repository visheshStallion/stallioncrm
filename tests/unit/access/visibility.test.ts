import { describe, expect, it } from "vitest";
import {
  brandScopeWhere,
  canWriteTo,
  isVisible,
  type BrandScopeWhere,
} from "@/server/access/visibility";
import type { AccessContext } from "@/server/access/types";
import { ALL_BRANDS, ALL_REGIONS, B, CTX, R, allRecords } from "../../fixtures/contexts";

/** Evaluates the Prisma where fragment in memory – proves where-shape and isVisible agree. */
function matches(where: BrandScopeWhere, rec: { brandId: string; regionId: string; ownerId: string }) {
  if (!("OR" in where)) return true;
  return where.OR.some((c) => {
    if ("ownerId" in c) return c.ownerId === rec.ownerId;
    if ("regionId" in c) return c.brandId === rec.brandId && c.regionId.in.includes(rec.regionId);
    return c.brandId === rec.brandId;
  });
}

const all = (brands: string[], regions: string[]) =>
  brands.flatMap((b) => regions.map((r) => `${b}|${r}`)).sort();

// BUSINESS_CONTEXT §6 / §7 – who sees which brand × region.
const cases: Array<{ role: string; ctx: AccessContext; visible: string[]; where: BrandScopeWhere }> = [
  { role: "Managing Director", ctx: CTX.md, visible: all(ALL_BRANDS, ALL_REGIONS), where: {} },
  { role: "Head of Sales", ctx: CTX.hos, visible: all(ALL_BRANDS, ALL_REGIONS), where: {} },
  { role: "CRM Administrator", ctx: CTX.admin, visible: all(ALL_BRANDS, ALL_REGIONS), where: {} },
  {
    role: "Brand Manager (HMNL)",
    ctx: CTX.bmHmnl,
    visible: all(["HMNL"], ALL_REGIONS),
    where: { OR: [{ ownerId: "u:bm.hmnl" }, { brandId: B("HMNL") }] },
  },
  {
    role: "Lagos Sales Exec (HMNL)",
    ctx: CTX.lagosHmnl,
    visible: all(["HMNL"], ["Lagos"]),
    where: { OR: [{ ownerId: "u:exec.hmnl.1" }, { brandId: B("HMNL"), regionId: { in: [R("Lagos")] } }] },
  },
  {
    role: "Lagos Sales Exec (multi-brand HMNL + SNMNL)",
    ctx: CTX.lagosMulti,
    visible: all(["HMNL", "SNMNL"], ["Lagos"]),
    where: {
      OR: [
        { ownerId: "u:exec.multi.1" },
        { brandId: B("HMNL"), regionId: { in: [R("Lagos")] } },
        { brandId: B("SNMNL"), regionId: { in: [R("Lagos")] } },
      ],
    },
  },
  {
    role: "Regional Sales Manager",
    ctx: CTX.rsm,
    visible: all(ALL_BRANDS, ["Abuja", "Port Harcourt", "Ibadan"]),
    where: {
      OR: [
        { ownerId: "u:rsm" },
        ...[...ALL_BRANDS].sort().map((b) => ({
          brandId: B(b),
          regionId: { in: [R("Abuja"), R("Ibadan"), R("Port Harcourt")] },
        })),
      ],
    },
  },
  {
    role: "Regional Sales Exec (Abuja)",
    ctx: CTX.abujaExec,
    visible: all(ALL_BRANDS, ["Abuja"]),
    where: {
      OR: [
        { ownerId: "u:exec.abuja" },
        ...[...ALL_BRANDS].sort().map((b) => ({ brandId: B(b), regionId: { in: [R("Abuja")] } })),
      ],
    },
  },
  {
    role: "User without territories",
    ctx: CTX.noTerritory,
    visible: [],
    where: { OR: [{ ownerId: "u:orphan" }] },
  },
];

describe("brandScopeWhere – visibility rule per role (BUSINESS_CONTEXT §6)", () => {
  it.each(cases)("$role → expected where fragment", ({ ctx, where }) => {
    expect(brandScopeWhere(ctx)).toEqual(where);
  });

  it.each(cases)("$role → sees exactly the expected brand × region cells", ({ ctx, visible }) => {
    const records = allRecords();
    const viaWhere = records.filter((r) => matches(brandScopeWhere(ctx), r)).map((r) => r.label).sort();
    const viaIsVisible = records.filter((r) => isVisible(ctx, r)).map((r) => r.label).sort();
    expect(viaWhere).toEqual(visible);
    expect(viaIsVisible).toEqual(visible);
  });

  it.each(cases)("$role → always sees records they own", ({ ctx }) => {
    for (const rec of allRecords(ctx.userId)) {
      expect(isVisible(ctx, rec)).toBe(true);
      expect(matches(brandScopeWhere(ctx), rec)).toBe(true);
    }
  });
});

describe("brandScopeWhere – membership compaction", () => {
  it("brand-level membership subsumes regional memberships of the same brand", () => {
    const ctx: AccessContext = {
      ...CTX.lagosHmnl,
      memberships: [
        ...CTX.lagosHmnl.memberships,
        { territoryId: "t:HMNL", brandId: B("HMNL"), regionId: null, isManager: true },
      ],
    };
    expect(brandScopeWhere(ctx)).toEqual({ OR: [{ ownerId: ctx.userId }, { brandId: B("HMNL") }] });
  });
});

describe("canWriteTo – creating/moving records", () => {
  it("ownership never grants a new territory", () => {
    expect(canWriteTo(CTX.lagosHmnl, B("SNMNL"), R("Lagos"))).toBe(false);
    expect(canWriteTo(CTX.lagosHmnl, B("HMNL"), R("Abuja"))).toBe(false);
    expect(canWriteTo(CTX.lagosHmnl, B("HMNL"), R("Lagos"))).toBe(true);
  });

  it("brand manager can write anywhere in own brand only", () => {
    for (const r of ALL_REGIONS) expect(canWriteTo(CTX.bmHmnl, B("HMNL"), R(r))).toBe(true);
    expect(canWriteTo(CTX.bmHmnl, B("SMGL"), R("Lagos"))).toBe(false);
  });

  it("scope ALL can write anywhere", () => {
    expect(canWriteTo(CTX.md, B("ZANL"), R("Ibadan"))).toBe(true);
  });

  it("RSM cannot write to Lagos", () => {
    expect(canWriteTo(CTX.rsm, B("HMNL"), R("Lagos"))).toBe(false);
  });
});
