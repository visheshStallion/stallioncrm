/**
 * CSV user import – pure planning step (no database access, unit-tested).
 * Columns: name, email, company_codes, role, region. `company_codes` is the legacy comma-separated list
 * from the HR rep file, resolved through BrandCodeAlias.
 */
import { parseCsvObjects } from "@/lib/csv";
import {
  DEFAULT_PROFILE,
  quickAssign,
  roleKind,
  territoryKeyString,
  type RoleKind,
} from "@/server/access/quick-assign";
import { BadRequestError } from "@/server/errors";

export const IMPORT_COLUMNS = ["name", "email", "company_codes", "role", "region"] as const;
const MAX_ROWS = 2000;
const NO_COMPANY = new Set(["", "-", "–", "n/a", "na", "none"]);
const NEEDS_BRANDS: RoleKind[] = ["BRAND_MANAGER", "LAGOS_EXEC", "REGIONAL_EXEC"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ImportLookups {
  /** alias (upper-case) → brand code */
  aliases: Record<string, string>;
  /** brand code → status */
  brands: Record<string, "ACTIVE" | "FUTURE" | "INACTIVE">;
  roles: Array<{ id: string; name: string }>;
  profiles: Array<{ id: string; name: string }>;
  regions: string[];
  existingEmails: Set<string>;
}

export interface PlanRow {
  line: number;
  name: string;
  email: string;
  role: string;
  region: string;
  companyCodes: string;
  kind: RoleKind | null;
  roleId: string | null;
  profileId: string | null;
  brands: string[];
  unknownCodes: string[];
  territories: string[];
  noCompany: boolean;
  action: "create" | "update";
  status: "ok" | "flagged" | "error";
  flags: string[];
  errors: string[];
}

export interface ImportPlan {
  rows: PlanRow[];
  summary: {
    total: number;
    ok: number;
    flagged: number;
    errors: number;
    creates: number;
    updates: number;
    multiBrand: number;
    noCompany: number;
    unknownCodes: string[];
  };
}

const norm = (s: string) => s.trim().toLowerCase();

function resolveRole(lookups: ImportLookups, roleInput: string, kind: RoleKind) {
  const exact = lookups.roles.find((r) => norm(r.name) === norm(roleInput));
  if (exact) return exact;
  const ofKind = lookups.roles.filter((r) => roleKind(r.name) === kind);
  return ofKind.length === 1 ? ofKind[0]! : null;
}

/** Pure planning step – no database access (unit-tested). */
export function planImport(csvText: string, lookups: ImportLookups): ImportPlan {
  const { headers, rows } = parseCsvObjects(csvText);
  const missing = IMPORT_COLUMNS.filter((c) => !headers.includes(c));
  if (missing.length) throw new BadRequestError(`Missing column(s): ${missing.join(", ")}`);
  if (rows.length > MAX_ROWS) throw new BadRequestError(`At most ${MAX_ROWS} rows per import`);

  const allBrandCodes = Object.entries(lookups.brands).filter(([, s]) => s !== "INACTIVE").map(([c]) => c);
  const seenEmails = new Map<string, number>();

  const planned = rows.map((r, i): PlanRow => {
    const row: PlanRow = {
      line: i + 2,
      name: r.name ?? "",
      email: (r.email ?? "").toLowerCase(),
      role: r.role ?? "",
      region: r.region ?? "",
      companyCodes: r.company_codes ?? "",
      kind: null,
      roleId: null,
      profileId: null,
      brands: [],
      unknownCodes: [],
      territories: [],
      noCompany: false,
      action: "create",
      status: "ok",
      flags: [],
      errors: [],
    };

    if (!row.name) row.errors.push("Name is required");
    if (!EMAIL_RE.test(row.email)) row.errors.push("Invalid email");
    const dup = seenEmails.get(row.email);
    if (row.email && dup !== undefined) row.errors.push(`Duplicate email (line ${dup})`);
    else seenEmails.set(row.email, row.line);
    row.action = lookups.existingEmails.has(row.email) ? "update" : "create";

    row.kind = roleKind(row.role, row.region);
    if (!row.kind) {
      row.errors.push(row.role ? `Unknown role "${row.role}"` : "Role is required");
    } else {
      const role = resolveRole(lookups, row.role, row.kind);
      if (!role) row.errors.push(`Role "${row.role}" is ambiguous – use the exact role name`);
      row.roleId = role?.id ?? null;
      row.profileId = lookups.profiles.find((p) => p.name === DEFAULT_PROFILE[row.kind!])?.id ?? null;
      if (!row.profileId) row.errors.push(`Profile "${DEFAULT_PROFILE[row.kind]}" not found`);
    }

    // Company codes → brands (deduplicated) through the alias table.
    const codes = row.companyCodes.split(/[,;/|]/).map((c) => c.trim().toUpperCase()).filter(Boolean);
    row.noCompany = codes.length === 0 || codes.every((c) => NO_COMPANY.has(c.toLowerCase()));
    const brands = new Set<string>();
    for (const code of codes) {
      if (NO_COMPANY.has(code.toLowerCase())) continue;
      const brand = lookups.aliases[code] ?? (lookups.brands[code] ? code : undefined);
      if (!brand) row.unknownCodes.push(code);
      else if (lookups.brands[brand] === "INACTIVE") row.errors.push(`Brand ${brand} is inactive`);
      else brands.add(brand);
    }
    row.brands = [...brands].sort();

    if (row.kind) {
      const needsBrands = NEEDS_BRANDS.includes(row.kind);
      if (needsBrands && row.noCompany) row.flags.push("No company – confirm licence");
      if (row.unknownCodes.length) row.flags.push(`Unknown code(s): ${row.unknownCodes.join(", ")}`);
      if (!needsBrands || row.brands.length > 0) {
        const qa = quickAssign({
          kind: row.kind,
          regionName: row.region,
          brandCodes: row.brands,
          allBrandCodes,
          allRegionNames: lookups.regions,
        });
        row.errors.push(...qa.errors);
        row.territories = qa.territories.map(territoryKeyString);
      } else if (row.kind === "REGIONAL_EXEC" && !lookups.regions.some((r) => norm(r) === norm(row.region))) {
        row.errors.push(row.region ? `Unknown region "${row.region}"` : "Select a region");
      }
    }

    row.status = row.errors.length ? "error" : row.flags.length ? "flagged" : "ok";
    return row;
  });

  const unknown = [...new Set(planned.flatMap((r) => r.unknownCodes))].sort();
  return {
    rows: planned,
    summary: {
      total: planned.length,
      ok: planned.filter((r) => r.status === "ok").length,
      flagged: planned.filter((r) => r.status === "flagged").length,
      errors: planned.filter((r) => r.status === "error").length,
      creates: planned.filter((r) => r.status !== "error" && r.action === "create").length,
      updates: planned.filter((r) => r.status !== "error" && r.action === "update").length,
      multiBrand: planned.filter((r) => r.brands.length >= 2).length,
      noCompany: planned.filter((r) => r.noCompany && r.kind && NEEDS_BRANDS.includes(r.kind)).length,
      unknownCodes: unknown,
    },
  };
}
