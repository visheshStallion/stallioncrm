import { describe, expect, it } from "vitest";
import { applyRules, computeFormulas, fieldsFor, layoutSchema, pickLayout, ruleValues, validateCustomFields, type CustomFieldDef } from "@/server/modules/customization/engine";

const def = (over: Partial<CustomFieldDef>): CustomFieldDef => ({ id: over.apiName ?? "x", module: "deals", apiName: "x", label: "X", type: "TEXT", options: [], lookupTarget: null, formula: null, brandId: null, required: false, active: true, position: 0, ...over });
const defs: CustomFieldDef[] = [
  def({ apiName: "insurer", label: "Insurer", type: "PICKLIST", options: ["AXA", "Leadway"], position: 2 }),
  def({ apiName: "fleetSize", label: "Fleet size", type: "NUMBER", required: true, position: 1 }),
  def({ apiName: "extras", label: "Extras", type: "MULTI_PICKLIST", options: ["Tint", "Mats", "Tracker"] }),
  def({ apiName: "handover", label: "Handover date", type: "DATE" }),
  def({ apiName: "vip", label: "VIP", type: "BOOLEAN" }),
  def({ apiName: "perUnit", label: "Per unit", type: "FORMULA", formula: "ROUND(amount / fleetSize, 2)" }),
  def({ apiName: "hmnlOnly", label: "HMNL warranty pack", type: "TEXT", brandId: "b-hmnl" }),
  def({ apiName: "retired", label: "Retired", active: false }),
  def({ apiName: "leadField", label: "Lead field", module: "leads" }),
];

describe("custom fields", () => {
  it("apply per module and brand, in layout order", () => {
    expect(fieldsFor(defs, "deals", "b-hmnl").map((d) => d.apiName)).toEqual(["extras", "handover", "hmnlOnly", "perUnit", "vip", "fleetSize", "insurer"]);
    expect(fieldsFor(defs, "deals", "b-snmnl").map((d) => d.apiName)).not.toContain("hmnlOnly"); // brand-specific field hidden for other brands
    expect(fieldsFor(defs, "leads", null).map((d) => d.apiName)).toEqual(["leadField"]);
  });

  it("validate against the generated schema and drop what does not belong to the record", () => {
    const snmnl = fieldsFor(defs, "deals", "b-snmnl");
    const ok = validateCustomFields(snmnl, { insurer: "AXA", fleetSize: "12", extras: "Tint, Tracker", handover: "2026-11-01", vip: "on", hmnlOnly: "smuggled", perUnit: 999, unknown: "x" });
    expect(ok.errors).toEqual([]);
    expect(ok.values).toEqual({ insurer: "AXA", fleetSize: 12, extras: ["Tint", "Tracker"], handover: "2026-11-01", vip: true });
    const bad = validateCustomFields(snmnl, { insurer: "Nobody", fleetSize: "", extras: ["Tint", "Spoiler"], handover: "next week" });
    expect(bad.errors).toEqual(expect.arrayContaining([expect.stringContaining("Insurer: one of: AXA, Leadway"), "Fleet size is required", expect.stringContaining("Extras"), expect.stringContaining("Handover date")]));
    // partial updates only touch what was sent
    expect(validateCustomFields(snmnl, { insurer: "Leadway" }, { partial: true })).toEqual({ values: { insurer: "Leadway" }, errors: [] });
    // the brand's own field is accepted on its records
    expect(validateCustomFields(fieldsFor(defs, "deals", "b-hmnl"), { fleetSize: 1, hmnlOnly: "Gold" }).values.hmnlOnly).toBe("Gold");
  });

  it("formula fields are computed from the record and its custom values", () => {
    const applicable = fieldsFor(defs, "deals", null);
    expect(computeFormulas(applicable, { amount: 100 }, { fleetSize: 3 })).toEqual({ perUnit: 33.33 });
    expect(computeFormulas(applicable, { amount: 100 }, { fleetSize: 0 })).toEqual({ perUnit: null });
    expect(computeFormulas([def({ apiName: "broken", type: "FORMULA", formula: "amount +" })], { amount: 1 }, {})).toEqual({ broken: null });
  });
});

describe("layout rules", () => {
  const layout = layoutSchema.parse({
    sections: [{ title: "Finance", fields: ["cf_insurer"] }],
    required: ["closeDate"],
    rules: [
      { when: { field: "paymentType", op: "eq", value: "BANK_FINANCE" }, action: "SHOW", fields: ["financeBank"] },
      { when: { field: "paymentType", op: "eq", value: "BANK_FINANCE" }, action: "REQUIRE", fields: ["financeBank", "cf_insurer"] },
      { when: { field: "cf_vip", op: "eq", value: true }, action: "HIDE", fields: ["discountPct", "closeDate"] },
      { when: { field: "amount", op: "gt", value: 100 }, action: "REQUIRE", fields: ["cf_fleetSize"] },
    ],
  });

  it("show / hide / require depending on values; hidden wins over required", () => {
    const cash = applyRules(layout, ruleValues({ paymentType: "CASH", amount: 50 }, {}));
    expect([...cash.hidden]).toEqual(["financeBank"]);
    expect([...cash.required]).toEqual(["closeDate"]);
    const finance = applyRules(layout, ruleValues({ paymentType: "BANK_FINANCE", amount: 500 }, { vip: true }));
    expect([...finance.hidden].sort()).toEqual(["closeDate", "discountPct"]);
    expect([...finance.required].sort()).toEqual(["cf_fleetSize", "cf_insurer", "financeBank"]); // closeDate is hidden → not required
  });

  it("feed validation: a rule can require a custom field, a hidden one is never required", () => {
    const fields = fieldsFor(defs, "deals", null);
    const { hidden, required } = applyRules(layout, ruleValues({ paymentType: "BANK_FINANCE" }, {}));
    expect(validateCustomFields(fields, { fleetSize: 2 }, { hidden, extraRequired: required }).errors).toEqual(["Insurer is required"]);
    expect(validateCustomFields(fields, {}, { hidden: new Set(["cf_fleetSize"]) }).errors).toEqual([]);
  });

  it("the brand's layout variant wins over the default; invalid layouts are rejected", () => {
    const layouts = [{ id: "default", brandId: null }, { id: "hmnl", brandId: "b-hmnl" }];
    expect(pickLayout(layouts, "b-hmnl")?.id).toBe("hmnl");
    expect(pickLayout(layouts, "b-snmnl")?.id).toBe("default");
    expect(pickLayout([], "b-hmnl")).toBeNull();
    expect(layoutSchema.safeParse({ rules: [{ when: { field: "a", op: "regex", value: "x" }, action: "SHOW", fields: ["b"] }] }).success).toBe(false);
    expect(layoutSchema.safeParse({ rules: [{ when: { field: "a", op: "eq" }, action: "DELETE", fields: ["b"] }] }).success).toBe(false);
    expect(layoutSchema.parse({})).toEqual({ sections: [], required: [], rules: [] });
  });
});
