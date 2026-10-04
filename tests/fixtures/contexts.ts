/**
 * In-memory AccessContexts for every role in BUSINESS_CONTEXT §6 (unit tests – no database).
 * Ids are readable fakes: brand "b:HMNL", region "r:Lagos", user "u:<key>".
 */
import type { AccessContext, Membership, PermissionMap } from "@/server/access/types";
import { PROFILE_DEFS, PROFILES } from "../../prisma/seed-data";

export const B = (code: string) => `b:${code}`;
export const R = (region: string) => `r:${region}`;

export const ALL_BRANDS = ["HMNL", "SNMNL", "SMGL", "THPL", "ZANL"];
export const ALL_REGIONS = ["Lagos", "Abuja", "Port Harcourt", "Ibadan"];

function profile(name: string) {
  const def = PROFILE_DEFS.find((p) => p.name === name)!;
  return {
    id: `p:${name}`,
    name,
    permissions: def.permissions as PermissionMap,
    fieldPermissions: def.fieldPermissions as AccessContext["profile"]["fieldPermissions"],
  };
}

export function makeCtx(opts: {
  key: string;
  profile: string;
  memberships?: Array<[brand: string, region: string | null]>;
}): AccessContext {
  const p = profile(opts.profile);
  const scope = PROFILE_DEFS.find((d) => d.name === opts.profile)!.scope;
  const memberships: Membership[] = (opts.memberships ?? []).map(([b, r]) => ({
    territoryId: `t:${b}|${r ?? "*"}`,
    brandId: B(b),
    regionId: r ? R(r) : null,
    isManager: false,
  }));
  return {
    userId: `u:${opts.key}`,
    user: { name: opts.key, email: `${opts.key}@stallioncrm.test`, roleName: opts.profile },
    scope,
    profile: p,
    memberships,
    brandIds: scope === "ALL" ? ALL_BRANDS.map(B) : [...new Set(memberships.map((m) => m.brandId))].sort(),
    isAdmin: p.permissions.admin?.edit === true,
  };
}

const regional = (region: string, brands = ALL_BRANDS) =>
  brands.map((b) => [b, region] as [string, string]);

export const CTX = {
  md: makeCtx({ key: "md", profile: PROFILES.MANAGEMENT }),
  hos: makeCtx({ key: "hos", profile: PROFILES.MANAGEMENT }),
  admin: makeCtx({ key: "admin", profile: PROFILES.ADMIN }),
  bmHmnl: makeCtx({ key: "bm.hmnl", profile: PROFILES.BM, memberships: [["HMNL", null]] }),
  lagosHmnl: makeCtx({ key: "exec.hmnl.1", profile: PROFILES.EXEC, memberships: [["HMNL", "Lagos"]] }),
  lagosMulti: makeCtx({
    key: "exec.multi.1",
    profile: PROFILES.EXEC,
    memberships: [["HMNL", "Lagos"], ["SNMNL", "Lagos"]],
  }),
  rsm: makeCtx({
    key: "rsm",
    profile: PROFILES.RSM,
    memberships: [...regional("Abuja"), ...regional("Port Harcourt"), ...regional("Ibadan")],
  }),
  abujaExec: makeCtx({ key: "exec.abuja", profile: PROFILES.EXEC, memberships: regional("Abuja") }),
  noTerritory: makeCtx({ key: "orphan", profile: PROFILES.EXEC }),
};

/** Every brand × region combination with a neutral owner. */
export function allRecords(owner = "u:someone-else") {
  return ALL_BRANDS.flatMap((b) =>
    ALL_REGIONS.map((r) => ({ brandId: B(b), regionId: R(r), ownerId: owner, label: `${b}|${r}` })),
  );
}
