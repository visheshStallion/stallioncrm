/**
 * Role → territory rules (BUSINESS_CONTEXT §6). Pure and isomorphic: used by the admin
 * quick-assign helper (client), user saves and the CSV import (server).
 */

export type RoleKind =
  | "MANAGEMENT"
  | "ADMIN"
  | "BRAND_MANAGER"
  | "LAGOS_EXEC"
  | "RSM"
  | "REGIONAL_EXEC";

/** The head-office region: Lagos execs sell from here; RSM / regional execs cover the others. */
export const HEAD_OFFICE_REGION = "Lagos";

export const ROLE_KIND_LABELS: Record<RoleKind, string> = {
  MANAGEMENT: "Management (MD / Head of Sales)",
  ADMIN: "CRM Administrator",
  BRAND_MANAGER: "Brand Manager",
  LAGOS_EXEC: "Lagos Sales Exec",
  RSM: "Regional Sales Manager",
  REGIONAL_EXEC: "Regional Sales Exec",
};

/** Default profile per role kind (5 profiles serve all brands). */
export const DEFAULT_PROFILE: Record<RoleKind, string> = {
  MANAGEMENT: "Management",
  ADMIN: "Administrator",
  BRAND_MANAGER: "Brand Manager",
  LAGOS_EXEC: "Sales Exec",
  RSM: "RSM",
  REGIONAL_EXEC: "Sales Exec",
};

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_\-–]+/g, " ");

const ROLE_ALIASES: Record<string, RoleKind | "SALES_EXEC"> = {
  "managing director": "MANAGEMENT",
  md: "MANAGEMENT",
  "head of sales": "MANAGEMENT",
  hos: "MANAGEMENT",
  management: "MANAGEMENT",
  "crm administrator": "ADMIN",
  administrator: "ADMIN",
  admin: "ADMIN",
  "brand manager": "BRAND_MANAGER",
  bm: "BRAND_MANAGER",
  "lagos sales exec": "LAGOS_EXEC",
  "lagos exec": "LAGOS_EXEC",
  "regional sales manager": "RSM",
  rsm: "RSM",
  "regional sales exec": "REGIONAL_EXEC",
  "regional exec": "REGIONAL_EXEC",
  "sales exec": "SALES_EXEC",
  "sales executive": "SALES_EXEC",
  rep: "SALES_EXEC",
  "sales rep": "SALES_EXEC",
};

/**
 * Role name (DB role name or common alias) → kind. A generic "Sales Exec" resolves by region:
 * Lagos → LAGOS_EXEC, anything else → REGIONAL_EXEC.
 */
export function roleKind(roleName: string, regionName?: string | null): RoleKind | null {
  const k = ROLE_ALIASES[norm(roleName)];
  if (!k) return null;
  if (k !== "SALES_EXEC") return k;
  if (!regionName) return null;
  return norm(regionName) === norm(HEAD_OFFICE_REGION) ? "LAGOS_EXEC" : "REGIONAL_EXEC";
}

export interface TerritoryKey {
  /** null = the Group root territory */
  brandCode: string | null;
  /** null = brand-level (or root) */
  regionName: string | null;
  isManager: boolean;
}

export const territoryKeyString = (k: Pick<TerritoryKey, "brandCode" | "regionName">) =>
  k.brandCode === null ? "ROOT" : k.regionName === null ? k.brandCode : `${k.brandCode}|${k.regionName}`;

export interface QuickAssignInput {
  kind: RoleKind;
  /** Region of the user (required for regional execs). */
  regionName?: string | null;
  /** Brands the user sells / manages. RSM ignores this and covers every brand. */
  brandCodes: string[];
  /** All brand codes (for RSM) – active + future. */
  allBrandCodes: string[];
  /** All active region names. */
  allRegionNames: string[];
}

export interface QuickAssignResult {
  territories: TerritoryKey[];
  errors: string[];
}

/** Computes territory memberships for a role (BUSINESS_CONTEXT §6). */
export function quickAssign(input: QuickAssignInput): QuickAssignResult {
  const brands = [...new Set(input.brandCodes.map((b) => b.trim().toUpperCase()).filter(Boolean))].sort();
  const errors: string[] = [];
  const findRegion = (name?: string | null) =>
    name ? input.allRegionNames.find((r) => norm(r) === norm(name)) ?? null : null;

  switch (input.kind) {
    case "MANAGEMENT":
    case "ADMIN":
      return { territories: [{ brandCode: null, regionName: null, isManager: false }], errors };

    case "BRAND_MANAGER":
      if (brands.length === 0) errors.push("Select the brand(s) this Brand Manager manages");
      return {
        territories: brands.map((b) => ({ brandCode: b, regionName: null, isManager: true })),
        errors,
      };

    case "LAGOS_EXEC": {
      const lagos = findRegion(HEAD_OFFICE_REGION) ?? HEAD_OFFICE_REGION;
      if (brands.length === 0) errors.push("Select at least one brand");
      return {
        territories: brands.map((b) => ({ brandCode: b, regionName: lagos, isManager: false })),
        errors,
      };
    }

    case "REGIONAL_EXEC": {
      const region = findRegion(input.regionName);
      if (!region) errors.push(input.regionName ? `Unknown region "${input.regionName}"` : "Select a region");
      else if (norm(region) === norm(HEAD_OFFICE_REGION)) errors.push("Regional execs belong to a non-Lagos region");
      if (brands.length === 0) errors.push("Select at least one brand");
      if (errors.length) return { territories: [], errors };
      return {
        territories: brands.map((b) => ({ brandCode: b, regionName: region, isManager: false })),
        errors,
      };
    }

    case "RSM": {
      const regions = input.allRegionNames.filter((r) => norm(r) !== norm(HEAD_OFFICE_REGION)).sort();
      const all = [...new Set(input.allBrandCodes.map((b) => b.toUpperCase()))].sort();
      return {
        territories: all.flatMap((b) => regions.map((r) => ({ brandCode: b, regionName: r, isManager: true }))),
        errors,
      };
    }
  }
}
