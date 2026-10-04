import { describe, expect, it } from "vitest";
import { formatDate, formatMoney, initials } from "@/lib/format";
import { conditionsToWhere, encodeCondition, parseConditions, parsePaging, systemFilterWhere, type FieldDef } from "@/server/list/filters";
import { schemaForKey } from "@/server/modules/preferences/schema";

const defs: FieldDef[] = [
  { key: "name", label: "Name", type: "text", nullable: false },
  { key: "stage", label: "Stage", type: "enum", nullable: false, options: [{ value: "A", label: "A" }, { value: "B", label: "B" }] },
  { key: "amount", label: "Amount", type: "number" },
  { key: "closeDate", label: "Close", type: "date" },
  { key: "tradeIn", label: "Trade-in", type: "boolean", nullable: false },
];
const now = new Date("2026-10-04T12:00:00Z");

describe("list filter engine", () => {
  it("only accepts whitelisted fields, valid operators and valid values", () => {
    const parsed = parseConditions(
      ["name~contains~acme", "passwordHash~is~x", "stage~is~A,B", "stage~is~ZZZ", "amount~gt~abc", "amount~between~1~5", "name~between~a~b", "closeDate~lastNDays~7"],
      defs,
    );
    expect(parsed.map((c) => c.field + ":" + c.op)).toEqual(["name:contains", "stage:is", "amount:between", "closeDate:lastNDays"]);
  });

  it("builds Prisma where fragments per operator", () => {
    const where = conditionsToWhere(
      parseConditions(["name~startsWith~Ac", "stage~is~A,B", "amount~between~10~20", "closeDate~between~2026-10-01~2026-10-31", "tradeIn~is~true", "closeDate~lastNDays~7"], defs),
      defs,
      now,
    );
    expect(where).toEqual({
      AND: [
        { name: { startsWith: "Ac", mode: "insensitive" } },
        { stage: { in: ["A", "B"] } },
        { amount: { gte: 10, lte: 20 } },
        { closeDate: { gte: new Date("2026-10-01T00:00:00.000Z"), lte: new Date("2026-10-31T23:59:59.999Z") } },
        { tradeIn: true },
        { closeDate: { gte: new Date("2026-09-27T12:00:00.000Z") } },
      ],
    });
    expect(conditionsToWhere([], defs)).toEqual({});
  });

  it("isEmpty is rejected on non-nullable fields; round-trips through encode", () => {
    expect(parseConditions("name~isEmpty", defs)).toEqual([]);
    expect(parseConditions("amount~isEmpty", defs)).toHaveLength(1);
    const c = { field: "amount", op: "between" as const, value: "1", value2: "5" };
    expect(parseConditions(encodeCondition(c), defs)).toEqual([c]);
  });

  it("system filters and paging", () => {
    expect(systemFilterWhere("touched", now)).toEqual({ updatedAt: { gte: new Date("2026-09-27T12:00:00.000Z") } });
    expect(systemFilterWhere("bogus", now)).toEqual({});
    expect(parsePaging({ page: "3", per: "50" })).toEqual({ page: 3, per: 50, skip: 100 });
    expect(parsePaging({ page: "-1", per: "7" })).toEqual({ page: 1, per: 20, skip: 0 });
  });
});

describe("formats & preferences", () => {
  it("₦ 12,500,000.00 and DD/MM/YYYY in Africa/Lagos", () => {
    expect(formatMoney(12_500_000)).toBe("₦ 12,500,000.00");
    expect(formatMoney(null)).toBe("—");
    // 23:30 UTC is already the next day in Lagos (UTC+1)
    expect(formatDate("2026-10-04T23:30:00Z")).toBe("05/10/2026");
    expect(formatDate("2026-10-04T10:00:00Z", "YYYY-MM-DD")).toBe("2026-10-04");
    expect(formatDate("2026-10-04T10:00:00Z", "MM/DD/YYYY")).toBe("10/04/2026");
    expect(initials("Ada Okafor")).toBe("AO");
  });

  it("preference keys are whitelisted", () => {
    expect(schemaForKey("theme")).toBeDefined();
    expect(schemaForKey("columns:leads")).toBeDefined();
    expect(schemaForKey("columns:../x")).toBeUndefined();
    expect(schemaForKey("isAdmin")).toBeUndefined();
    expect(schemaForKey("theme")!.safeParse("neon").success).toBe(false);
  });
});
