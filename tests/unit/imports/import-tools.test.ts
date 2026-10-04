import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { toXlsx, zipStore } from "@/lib/xlsx";
import { excelSerialToDate, readXlsx } from "@/lib/xlsx-read";
import { evaluateFormula, parseFormula } from "@/server/automation/formula";
import { autoMapColumns, importModule, planImport, type ImportLookups, type ImportMapping } from "@/server/modules/imports/plan";

describe("xlsx reader", () => {
  it("reads what the xlsx writer wrote (inline strings, numbers, empty cells)", () => {
    const rows = readXlsx(toXlsx("Deals", ["Deal Name", "Amount", "Stage"], [["Fleet & Co <10>", 1500000.5, "Closed Won"], ["Second", null, "Qualification"]]));
    expect(rows).toEqual([["Deal Name", "Amount", "Stage"], ["Fleet & Co <10>", "1500000.5", "Closed Won"], ["Second", "", "Qualification"]]);
  });

  it("reads shared strings and deflated parts (as written by Excel)", () => {
    const enc = new TextEncoder();
    const sheet = `<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>42</v></c><c r="C2" t="b"><v>1</v></c></row><row r="3"></row></sheetData></worksheet>`;
    const shared = `<sst><si><t>Name</t></si><si><t>Active</t></si><si><r><t>Ada </t></r><r><t>Okafor &amp; Sons</t></r></si></sst>`;
    // a zip with one stored and one deflated entry
    const stored = zipStore([{ name: "xl/sharedStrings.xml", data: enc.encode(shared) }, { name: "xl/worksheets/sheet1.xml", data: enc.encode(sheet) }]);
    expect(readXlsx(stored)).toEqual([["Name", "", "Active"], ["Ada Okafor & Sons", "42", "TRUE"]]);
    const deflated = deflateRawSync(Buffer.from(sheet));
    expect(deflated.length).toBeLessThan(sheet.length);
    expect(() => readXlsx(new Uint8Array([1, 2, 3, 4]))).toThrow(/Not an \.xlsx/);
  });

  it("converts Excel serial dates", () => {
    expect(excelSerialToDate("46300")).toBe("2026-10-05");
    expect(excelSerialToDate("12")).toBeNull();
    expect(excelSerialToDate("2026-10-05")).toBeNull();
  });
});

describe("formula engine", () => {
  const run = (src: string, record: Record<string, unknown> = {}) => evaluateFormula(parseFormula(src), record);
  it("arithmetic with precedence, parentheses and fields", () => {
    expect(run("1 + 2 * 3")).toBe(7);
    expect(run("(1 + 2) * 3")).toBe(9);
    expect(run("amount * (1 - discountPct / 100)", { amount: 1000, discountPct: 5 })).toBe(950);
    expect(run("-amount % 7", { amount: 10 })).toBe(-3);
    expect(run("amount / 0", { amount: 10 })).toBeNull();
    expect(run("amount + 1", {})).toBeNull();
  });
  it("comparisons, logic and functions", () => {
    expect(run('IF(paymentType = "CASH", "Cash sale", "Financed")', { paymentType: "cash" })).toBe("Cash sale");
    expect(run("IF(amount >= 1000 AND NOT ISBLANK(model), 1, 0)", { amount: 1000, model: "SUV" })).toBe(1);
    expect(run("amount > 5 OR missing = 1", { amount: 1 })).toBe(false);
    expect(run("ROUND(amount / quantity, 2)", { amount: 10, quantity: 3 })).toBe(3.33);
    expect(run('CONCAT(firstName, " ", UPPER(lastName))', { firstName: "Ada", lastName: "okafor" })).toBe("Ada OKAFOR");
    expect(run("MAX(a, b, 3) - MIN(a, b)", { a: 10, b: 4 })).toBe(6);
    expect(run('DAYS("2026-10-01", closeDate)', { closeDate: "2026-10-11" })).toBe(10);
    expect(run("COALESCE(nickname, firstName)", { firstName: "Ada" })).toBe("Ada");
    expect(run("LEN(name) != 3", { name: "abc" })).toBe(false);
  });
  it("lists the fields it reads", () => {
    expect(parseFormula("ROUND(amount * rate, 2) + bonus").fields).toEqual(["amount", "rate", "bonus"]);
  });
  it("rejects everything outside the grammar", () => {
    for (const bad of ["", "1 +", "amount ** 2", "process.exit(1)", "a; b", "FOO(1)", "IF(1, 2)", '"open', "a[0]", "constructor", "__proto__", "x => x", "{}", "`a`", "1 = = 2"]) {
      expect(() => parseFormula(bad), bad).toThrow();
    }
    expect(() => parseFormula("1".repeat(600))).toThrow(/at most/);
    expect(() => parseFormula("(".repeat(30) + "1" + ")".repeat(30))).toThrow(/nested/);
  });
  it("only reads own properties and plain values", () => {
    expect(run("toString", {})).toBeNull();
    expect(run("nested + 1", { nested: { a: 1 } })).toBeNull();
    expect(run("amount", { amount: { toNumber: () => 12.5 } })).toBe(12.5);
  });
});

describe("import planning", () => {
  const deals = importModule("deals")!;
  const lookups: ImportLookups = {
    brandAliases: { HMNL: "HMNL", HYU: "HMNL", "HYUNDAI MOTORS": "HMNL", SNMNL: "SNMNL", NIS: "SNMNL", OLD: "OLD" },
    brands: { HMNL: { id: "b-h", status: "ACTIVE" }, SNMNL: { id: "b-s", status: "ACTIVE" }, OLD: { id: "b-o", status: "INACTIVE" } },
    allowedBrands: new Set(["HMNL"]),
    regions: { lagos: "r-l", abuja: "r-a" },
    users: { "ada@example.test": "u-ada" },
    stages: { HMNL: { ENQUIRY: "s1", TEST_DRIVE: "s2", QUOTATION: "s3", BOOKING: "s4", CLOSED_WON: "s7", CLOSED_LOST: "s8" } },
    products: { HMNL: { "SUV-20": "p1", "SUV 2.0": "p1" } },
    existing: { "HMNL|name|existing deal": "d-1" },
  };
  // a Zoho "Potentials" export
  const zoho = [
    ["Potential Name", "Stage", "Amount", "Closing Date", "Account Name", "Company Code", "Region", "Deal Owner", "Product", "Internal Id"],
    ["Fleet of 5 SUVs", "Negotiation/Review", "₦ 250,000,000", "31/12/2026", "Fleet Co", "HYU", "Lagos", "ada@example.test", "SUV 2.0", "zcrm_1"],
    ["Walk-in buyer", "Closed Won", "45000000", "2026-09-30", "", "Hyundai Motors", "Abuja", "nobody@example.test", "Unknown car", "zcrm_2"],
    ["Other brand deal", "Qualification", "1", "2026-10-01", "", "NIS", "Lagos", "", "", "zcrm_3"],
    ["Existing deal", "Custom Zoho Stage", "x", "soon", "", "HMNL", "Mars", "", "", "zcrm_4"],
    ["Old brand", "Qualification", "", "", "", "OLD", "Lagos", "", "", "zcrm_5"],
    ["Fleet of 5 SUVs", "Qualification", "", "", "", "HMNL", "Lagos", "", "", "zcrm_6"],
    ["", "Qualification", "", "", "", "XXX", "Lagos", "", "", "zcrm_7"],
  ];
  const columns = autoMapColumns(deals, zoho[0]!);
  const mapping: ImportMapping = { columns, values: {}, dedupe: "skip" };

  it("auto-maps Zoho column names", () => {
    expect(columns).toMatchObject({ "Potential Name": "name", Stage: "stage", Amount: "amount", "Closing Date": "closeDate", "Account Name": "accountName", "Company Code": "brand", Region: "region", "Deal Owner": "owner", Product: "model", "Internal Id": "" });
  });

  it("maps stages and legacy company codes, resolves the brand per row and reports problems", () => {
    const plan = planImport(deals, zoho, mapping, lookups);
    const [fleet, walkIn, other, existing, old, dup, blank] = plan.rows;
    expect(fleet).toMatchObject({ line: 2, brand: "HMNL", action: "create", errors: [], warnings: [], ids: { brandId: "b-h", regionId: "r-l", ownerId: "u-ada", stageId: "s4", productId: "p1" }, values: { name: "Fleet of 5 SUVs", amount: 250_000_000, closeDate: "2026-12-31", stage: "BOOKING" } });
    expect(walkIn).toMatchObject({ brand: "HMNL", action: "create", ids: { regionId: "r-a", stageId: "s7" }, values: { closeDate: "2026-09-30" } });
    expect(walkIn!.warnings).toHaveLength(2); // unknown owner, unknown model
    // a Brand Manager importing into another brand: row error
    expect(other).toMatchObject({ action: "skip", brand: null, errors: ["You cannot import into brand SNMNL"] });
    expect(existing!.errors).toEqual(expect.arrayContaining(['Stage "Custom Zoho Stage" is not mapped to a stage of HMNL', 'Amount: "x" is not a number', 'Expected close: "soon" is not a date', 'Unknown region "Mars"']));
    expect(old!.errors).toContain("Brand OLD is inactive");
    expect(dup).toMatchObject({ action: "skip", warnings: ["Same name as line 2"] });
    expect(blank!.errors).toEqual(expect.arrayContaining(["Deal name is missing", 'Unknown brand "XXX"']));
    expect(plan.summary).toEqual({ total: 7, create: 2, update: 0, skip: 1, warnings: 3, errors: 4, byBrand: { HMNL: 2 } });
    expect(plan.unmappedColumns).toEqual(["Internal Id"]);
    expect(plan.missingRequired).toEqual([]);
  });

  it("value mapping, dedupe modes and defaults", () => {
    const custom: ImportMapping = { ...mapping, values: { stage: { "custom zoho stage": "QUOTATION" } }, dedupe: "update" };
    const rows = [zoho[0]!, ["Existing deal", "Custom Zoho Stage", "5", "2026-10-01", "", "HMNL", "Lagos", "", "", ""]];
    expect(planImport(deals, rows, custom, lookups).rows[0]).toMatchObject({ action: "update", existingId: "d-1", ids: { stageId: "s3" }, errors: [] });
    expect(planImport(deals, rows, { ...custom, dedupe: "skip" }, lookups).rows[0]).toMatchObject({ action: "skip", warnings: ["Already exists (same name) – skipped"] });
    expect(planImport(deals, rows, { ...custom, dedupe: "create" }, lookups).rows[0]).toMatchObject({ action: "create" });
    // no brand / region column → defaults; an administrator may write to every brand
    const bare = [["Deal Name"], ["Only a name"]];
    const plan = planImport(deals, bare, { columns: { "Deal Name": "name" }, values: {}, dedupe: "skip", defaultBrand: "NIS", defaultRegion: "Lagos" }, { ...lookups, allowedBrands: new Set(["HMNL", "SNMNL"]) });
    expect(plan.rows[0]).toMatchObject({ brand: "SNMNL", action: "create", ids: { brandId: "b-s", regionId: "r-l" } });
    expect(planImport(deals, bare, { columns: { "Deal Name": "name" }, values: {}, dedupe: "skip" }, lookups).missingRequired).toEqual(["Brand", "Region"]);
  });

  it("leads: phone normalisation, enum cleaning, dedupe by mobile within the brand", () => {
    const leads = importModule("leads")!;
    const rows = [["Last Name", "Phone", "Lead Source", "Brand", "Region", "Rating"], ["Okafor", "0803 123 4521", "walk in", "HMNL", "Lagos", "Hot"], ["Bello", "+234 803 123 4521", "Referral", "HMNL", "Lagos", ""], ["Eze", "abc", "Billboard", "HMNL", "Lagos", ""]];
    const plan = planImport(leads, rows, { columns: autoMapColumns(leads, rows[0]!), values: {}, dedupe: "skip" }, lookups);
    expect(plan.rows[0]).toMatchObject({ action: "create", values: { mobile: "+2348031234521", source: "WALK_IN", rating: "HOT" } });
    expect(plan.rows[1]).toMatchObject({ action: "skip", warnings: ["Same mobile as line 2"] });
    expect(plan.rows[2]!.errors).toEqual(expect.arrayContaining(['Mobile: "abc" is not a phone number', expect.stringContaining('Lead source: "Billboard"'), "Mobile or email is required"]));
  });
});
