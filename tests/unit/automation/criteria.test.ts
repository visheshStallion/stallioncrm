import { describe, expect, it } from "vitest";
import { criteriaFields, criteriaSchema, evaluate, renderTemplate, toWhere, type Criteria } from "@/server/automation/criteria";
import { fieldMap, wfModule } from "@/server/modules/workflow/modules";
import { ruleSchema } from "@/server/modules/workflow/schema";

const now = new Date("2026-10-04T12:00:00Z");

describe("criteria – evaluate", () => {
  it("empty criteria match everything; all = AND, any = OR, nested groups", () => {
    expect(evaluate({}, {})).toBe(true);
    expect(evaluate(null, {})).toBe(true);
    const c: Criteria = { all: [{ field: "rating", op: "eq", value: "HOT" }, { any: [{ field: "city", op: "eq", value: "Lagos" }, { field: "budget", op: "gte", value: 50 }] }] };
    expect(evaluate(c, { rating: "HOT", city: "Abuja", budget: 60 })).toBe(true);
    expect(evaluate(c, { rating: "HOT", city: "Abuja", budget: 10 })).toBe(false);
    expect(evaluate(c, { rating: "COLD", city: "Lagos" })).toBe(false);
    expect(evaluate({ any: [{ field: "a", op: "eq", value: 1 }], all: [{ field: "b", op: "eq", value: 2 }] }, { a: 1, b: 3 })).toBe(false);
  });

  it("supports the operators, including references to other facts and relative dates", () => {
    const f = { discountPct: 8, escalationPct: 7, name: "Ada Okafor", tags: null, on: true, createdAt: new Date("2026-10-04T09:00:00Z"), closeDate: "2026-10-06T00:00:00Z" };
    const t = (field: string, op: string, value?: unknown) => evaluate({ all: [{ field, op: op as never, value }] }, f, now);
    expect(t("discountPct", "gt", "$escalationPct")).toBe(true);
    expect(t("discountPct", "lte", 7)).toBe(false);
    expect(t("name", "contains", "okaf")).toBe(true);
    expect(t("name", "in", "X, ada okafor")).toBe(true);
    expect(t("name", "neq", "Ada Okafor")).toBe(false);
    expect(t("tags", "isEmpty")).toBe(true);
    expect(t("name", "notEmpty")).toBe(true);
    expect(t("on", "eq", "true")).toBe(true);
    expect(t("createdAt", "olderThanHours", 2)).toBe(true);
    expect(t("createdAt", "olderThanHours", 4)).toBe(false);
    expect(t("createdAt", "olderThanDays", 1)).toBe(false);
    expect(t("closeDate", "withinDays", 3)).toBe(true);
    expect(t("closeDate", "withinDays", 1)).toBe(false);
    expect(t("missing", "gt", 1)).toBe(false);
  });
});

describe("criteria – toWhere", () => {
  const deals = fieldMap(wfModule("deals")!);
  it("translates the stale-deal criteria, including virtual fields", () => {
    const where = toWhere({ all: [{ field: "isOpen", op: "eq", value: true }, { field: "updatedAt", op: "olderThanDays", value: 7 }] }, deals, now);
    expect(where).toEqual({ AND: [{ stage: { type: "OPEN" } }, { updatedAt: { lte: new Date("2026-09-27T12:00:00Z") } }] });
    expect(toWhere({ any: [{ field: "amount", op: "gt", value: "5" }, { field: "stageType", op: "neq", value: "LOST" }] }, deals, now)).toEqual({
      AND: [{ OR: [{ amount: { gt: 5 } }, { NOT: { stage: { type: "LOST" } } }] }],
    });
    expect(toWhere({}, deals)).toEqual({});
  });
  it("rejects unknown fields, unsupported operators and fact references", () => {
    expect(() => toWhere({ all: [{ field: "passwordHash", op: "eq", value: "x" }] }, deals)).toThrow(/Unknown field/);
    expect(() => toWhere({ all: [{ field: "isOpen", op: "gt", value: 1 }] }, deals)).toThrow(/not supported/);
    expect(() => toWhere({ all: [{ field: "amount", op: "gt", value: "$other" }] }, deals)).toThrow(/references/);
  });
});

describe("criteria – validation and templates", () => {
  it("accepts bounded trees only", () => {
    expect(criteriaSchema.safeParse({ all: [{ field: "a", op: "eq", value: 1 }, { any: [{ field: "b", op: "isEmpty" }] }] }).success).toBe(true);
    expect(criteriaSchema.safeParse({ all: [{ field: "a", op: "regex", value: 1 }] }).success).toBe(false);
    expect(criteriaSchema.safeParse({ all: [], $where: "1=1" }).success).toBe(false);
    const deep = { all: [{ all: [{ all: [{ all: [{ all: [{ field: "a", op: "eq", value: 1 }] }] }] }] }] };
    expect(criteriaSchema.safeParse(deep).success).toBe(false);
    expect(criteriaFields({ all: [{ field: "a", op: "eq" }, { any: [{ field: "b", op: "eq" }, { field: "a", op: "eq" }] }] })).toEqual(["a", "b"]);
  });
  it("renders {{placeholders}}", () => {
    expect(renderTemplate("Deal {{name}} – {{ missing }} {{closeDate}}", { name: "Fleet", closeDate: new Date("2026-10-06T10:00:00Z") })).toBe("Deal Fleet –  2026-10-06");
  });
});

describe("rule schema", () => {
  const base = { name: "r", module: "deals", trigger: "ON_CREATE", actions: [{ type: "CREATE_TASK", subject: "x" }] };
  it("validates against the module schema", () => {
    expect(ruleSchema.safeParse(base).success).toBe(true);
    expect(ruleSchema.safeParse({ ...base, actions: [] }).success).toBe(false);
    expect(ruleSchema.safeParse({ ...base, criteria: { all: [{ field: "nope", op: "eq", value: 1 }] } }).success).toBe(false);
    expect(ruleSchema.safeParse({ ...base, trigger: "FIELD_CHANGE", triggerConfig: {} }).success).toBe(false);
    expect(ruleSchema.safeParse({ ...base, trigger: "FIELD_CHANGE", triggerConfig: { field: "stageId" } }).success).toBe(true);
    expect(ruleSchema.safeParse({ ...base, trigger: "SCHEDULED" }).success).toBe(false); // needs criteria
    expect(ruleSchema.safeParse({ ...base, trigger: "DATE_BASED", triggerConfig: { dateField: "amount" } }).success).toBe(false);
    // only whitelisted fields can be updated; brand / owner / stage cannot
    expect(ruleSchema.safeParse({ ...base, actions: [{ type: "FIELD_UPDATE", field: "brandId", value: "x" }] }).success).toBe(false);
    expect(ruleSchema.safeParse({ ...base, actions: [{ type: "FIELD_UPDATE", field: "closeDate", value: "2026-12-01" }] }).success).toBe(true);
    expect(ruleSchema.safeParse({ ...base, actions: [{ type: "CALL_FUNCTION", name: "copyBrandFromDeal" }] }).success).toBe(false); // deals module
    expect(ruleSchema.safeParse({ ...base, actions: [{ type: "DROP_TABLE" }] }).success).toBe(false);
  });
});
