import { describe, expect, it } from "vitest";
import { filterWhere, sanitizeFilters, visibleRegionIds } from "@/server/access/filters";
import { B, CTX, R } from "../../fixtures/contexts";

describe("brand switcher / region filter – narrow, never widen", () => {
  it("keeps a brand the user has", () => {
    expect(filterWhere(CTX.lagosMulti, { brandId: B("SNMNL") })).toEqual({ brandId: B("SNMNL") });
  });

  it("drops a brand the user does not have", () => {
    expect(sanitizeFilters(CTX.lagosHmnl, { brandId: B("SNMNL") }).brandId).toBeNull();
    expect(filterWhere(CTX.lagosHmnl, { brandId: B("SNMNL") })).toEqual({});
  });

  it("drops a region outside the user's territories", () => {
    expect(filterWhere(CTX.abujaExec, { regionId: R("Lagos") })).toEqual({});
    expect(filterWhere(CTX.abujaExec, { regionId: R("Abuja") })).toEqual({ regionId: R("Abuja") });
  });

  it("brand-level and ALL users can filter every region", () => {
    expect(visibleRegionIds(CTX.bmHmnl)).toBeNull();
    expect(visibleRegionIds(CTX.md)).toBeNull();
    expect(visibleRegionIds(CTX.rsm)).toEqual([R("Abuja"), R("Ibadan"), R("Port Harcourt")]);
  });
});
