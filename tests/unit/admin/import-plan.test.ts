import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "@/lib/csv";
import { quickAssign, roleKind, territoryKeyString } from "@/server/access/quick-assign";
import { planImport, type ImportLookups } from "@/server/modules/admin/import-plan";
import { BRAND_ALIASES, BRANDS, REGIONS, ROLES } from "../../../prisma/seed-data";

const lookups: ImportLookups = {
  aliases: Object.fromEntries(BRAND_ALIASES.map((a) => [a.alias, a.brand])),
  brands: Object.fromEntries(BRANDS.map((b) => [b.code, b.status])),
  roles: Object.values(ROLES).map((name) => ({ id: `role:${name}`, name })),
  profiles: ["Management", "Administrator", "Brand Manager", "RSM", "Sales Exec"].map((name) => ({ id: `p:${name}`, name })),
  regions: [...REGIONS],
  existingEmails: new Set(["already@stallioncrm.test"]),
};

const HEADER = "name,email,company_codes,role,region\n";
const plan = (rows: string) => planImport(HEADER + rows, lookups);

describe("CSV import planning", () => {
  it('"HMNL, SNML, SNMN" → HMNL + SNMNL (deduplicated) → HMNL – Lagos, SNMNL – Lagos', () => {
    const { rows } = plan('Ada Test,ada@stallioncrm.test,"HMNL, SNML, SNMN",Sales Exec,Lagos\n');
    const r = rows[0]!;
    expect(r.status).toBe("ok");
    expect(r.kind).toBe("LAGOS_EXEC");
    expect(r.brands).toEqual(["HMNL", "SNMNL"]);
    expect(r.territories).toEqual(["HMNL|Lagos", "SNMNL|Lagos"]);
    expect(r.profileId).toBe("p:Sales Exec");
    expect(r.roleId).toBe("role:Lagos Sales Exec");
  });

  it('row with "-" is flagged "confirm licence", not an error', () => {
    const { rows, summary } = plan("No Co,noco@stallioncrm.test,-,Sales Exec,Lagos\n");
    expect(rows[0]!.status).toBe("flagged");
    expect(rows[0]!.flags.join()).toMatch(/confirm licence/i);
    expect(rows[0]!.territories).toEqual([]);
    expect(summary.noCompany).toBe(1);
  });

  it("unknown codes are flagged and reported", () => {
    const { rows, summary } = plan('X,x@stallioncrm.test,"MG, FOO",Sales Exec,Abuja\n');
    expect(rows[0]!.status).toBe("flagged");
    expect(rows[0]!.brands).toEqual(["SMGL"]);
    expect(rows[0]!.territories).toEqual(["SMGL|Abuja"]);
    expect(summary.unknownCodes).toEqual(["FOO"]);
  });

  it("errors: bad email, unknown role, duplicate email, unknown region", () => {
    const { rows } = plan(
      [
        "A,not-an-email,HMNL,Sales Exec,Lagos",
        "B,b@stallioncrm.test,HMNL,Wizard,Lagos",
        "C,c@stallioncrm.test,HMNL,Sales Exec,Lagos",
        "C2,c@stallioncrm.test,HMNL,Sales Exec,Lagos",
        "D,d@stallioncrm.test,HMNL,Regional Sales Exec,Kano",
      ].join("\n"),
    );
    expect(rows.map((r) => r.status)).toEqual(["error", "error", "ok", "error", "error"]);
    expect(rows[3]!.errors.join()).toMatch(/Duplicate email/);
  });

  it("summary counts multi-brand reps and existing users", () => {
    const { summary, rows } = plan(
      ['A,already@stallioncrm.test,"THP, ZAHAV",Sales Exec,Lagos', "B,b2@stallioncrm.test,MG,Sales Exec,Ibadan"].join("\n"),
    );
    expect(summary.multiBrand).toBe(1);
    expect(summary.updates).toBe(1);
    expect(summary.creates).toBe(1);
    expect(rows[0]!.brands).toEqual(["THPL", "ZANL"]);
  });

  it("management roles need no company and get the root territory", () => {
    const { rows } = plan("MD,md2@stallioncrm.test,-,Managing Director,Lagos\n");
    expect(rows[0]!.status).toBe("ok");
    expect(rows[0]!.territories).toEqual(["ROOT"]);
    expect(rows[0]!.profileId).toBe("p:Management");
  });

  it("rejects files without the required columns", () => {
    expect(() => planImport("name,email\nA,a@x.test\n", lookups)).toThrow(/company_codes/);
  });
});

describe("quickAssign (BUSINESS_CONTEXT §6)", () => {
  const base = { allBrandCodes: ["HMNL", "SNMNL", "SMGL", "THPL", "ZANL"], allRegionNames: [...REGIONS] };
  const keys = (r: ReturnType<typeof quickAssign>) => r.territories.map(territoryKeyString);

  it("Lagos Sales Exec + [HMNL, THPL] → HMNL – Lagos, THPL – Lagos", () => {
    expect(keys(quickAssign({ ...base, kind: "LAGOS_EXEC", brandCodes: ["HMNL", "THPL"] }))).toEqual(["HMNL|Lagos", "THPL|Lagos"]);
  });

  it("Regional Exec Abuja + all brands → every X – Abuja", () => {
    expect(keys(quickAssign({ ...base, kind: "REGIONAL_EXEC", regionName: "Abuja", brandCodes: base.allBrandCodes }))).toEqual(
      ["HMNL|Abuja", "SMGL|Abuja", "SNMNL|Abuja", "THPL|Abuja", "ZANL|Abuja"],
    );
  });

  it("Brand Manager → brand-level territory as manager", () => {
    const r = quickAssign({ ...base, kind: "BRAND_MANAGER", brandCodes: ["SMGL"] });
    expect(r.territories).toEqual([{ brandCode: "SMGL", regionName: null, isManager: true }]);
  });

  it("RSM → all non-Lagos brand-region territories", () => {
    const r = quickAssign({ ...base, kind: "RSM", brandCodes: [] });
    expect(r.territories).toHaveLength(15);
    expect(r.territories.every((t) => t.regionName !== "Lagos" && t.isManager)).toBe(true);
  });

  it("regional exec cannot be assigned to Lagos", () => {
    expect(quickAssign({ ...base, kind: "REGIONAL_EXEC", regionName: "Lagos", brandCodes: ["HMNL"] }).errors).not.toHaveLength(0);
  });

  it("generic 'Sales Exec' resolves by region", () => {
    expect(roleKind("Sales Exec", "Lagos")).toBe("LAGOS_EXEC");
    expect(roleKind("sales exec", "Port Harcourt")).toBe("REGIONAL_EXEC");
    expect(roleKind("Head of Sales")).toBe("MANAGEMENT");
    expect(roleKind("nope")).toBeNull();
  });
});

describe("csv", () => {
  it("parses quoted fields, escaped quotes, CRLF and BOM", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
    ]);
  });

  it("writes CSV and neutralises formula injection", () => {
    expect(toCsv(["a"], [["=SUM(1)"], ["x,y"]])).toBe("a\r\n'=SUM(1)\r\n\"x,y\"\r\n");
  });
});
