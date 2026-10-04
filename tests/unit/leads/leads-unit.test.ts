import { describe, expect, it } from "vitest";
import { normalizePhone } from "@/lib/phone";
import { decideAssignment, pickRule, roundRobin, ruleMatches, type RuleLike } from "@/server/modules/leads/assignment-engine";
import { classifyDuplicates, hasDuplicates } from "@/server/modules/leads/duplicates";
import { intakeSchema, parseLeadFilters } from "@/server/modules/leads/schema";
import { rateLimit, resetRateLimits } from "@/server/rate-limit";

const rule = (over: Partial<RuleLike>): RuleLike => ({
  id: "r",
  position: 10,
  active: true,
  brandId: null,
  regionId: null,
  source: null,
  productId: null,
  action: "ROUND_ROBIN",
  userId: null,
  rrPointer: 0,
  ...over,
});
const lead = { brandId: "HMNL", regionId: "Abuja", source: "WEBSITE", modelOfInterestId: "suv" };

describe("assignment rule engine", () => {
  it("criteria: null matches anything; all set criteria must match", () => {
    expect(ruleMatches(rule({}), lead)).toBe(true);
    expect(ruleMatches(rule({ brandId: "HMNL", source: "WEBSITE" }), lead)).toBe(true);
    expect(ruleMatches(rule({ brandId: "SNMNL" }), lead)).toBe(false);
    expect(ruleMatches(rule({ productId: "sedan" }), lead)).toBe(false);
    expect(ruleMatches(rule({ active: false }), lead)).toBe(false);
  });

  it("first active match by position wins", () => {
    const rules = [
      rule({ id: "catch-all", position: 100 }),
      rule({ id: "hmnl-web", position: 20, brandId: "HMNL", source: "WEBSITE" }),
      rule({ id: "inactive", position: 1, active: false }),
    ];
    expect(pickRule(rules, lead)?.id).toBe("hmnl-web");
    expect(pickRule(rules, { ...lead, source: "PHONE" })?.id).toBe("catch-all");
    expect(pickRule([], lead)).toBeNull();
  });

  it("round-robin rotates over active users only, in stable order", () => {
    const c = [
      { id: "b", active: true },
      { id: "a", active: true },
      { id: "x", active: false },
      { id: "c", active: true },
    ];
    const picks: string[] = [];
    let p = 0;
    for (let i = 0; i < 6; i++) {
      const r = roundRobin(c, p);
      picks.push(r.userId!);
      p = r.nextPointer;
    }
    expect(picks).toEqual(["a", "b", "c", "a", "b", "c"]);
    expect(roundRobin([{ id: "x", active: false }], 3)).toEqual({ userId: null, nextPointer: 3 });
  });

  it("falls back: rule yields nobody → territory round-robin → territory manager → brand manager", () => {
    const none = { territoryMembers: [], territoryManager: null, brandManager: null, specificUser: null };
    expect(decideAssignment(rule({ action: "SPECIFIC_USER", userId: "u" }), { ...none, specificUser: { id: "u", active: false, hasAccess: true } }, 0).via).toBe("none");
    expect(
      decideAssignment(rule({ action: "SPECIFIC_USER" }), { ...none, specificUser: { id: "u", active: true, hasAccess: false }, territoryMembers: [{ id: "m", active: true }] }, 0),
    ).toMatchObject({ userId: "m", via: "fallback-round-robin" });
    expect(decideAssignment(null, { ...none, territoryManager: { id: "tm", active: true } }, 0)).toMatchObject({ userId: "tm", via: "territory-manager" });
    expect(decideAssignment(null, { ...none, territoryManager: { id: "tm", active: false }, brandManager: { id: "bm", active: true } }, 0)).toMatchObject({
      userId: "bm",
      via: "brand-manager",
    });
  });

  it("specific user and territory manager actions", () => {
    const base = { territoryMembers: [{ id: "m", active: true }], territoryManager: { id: "tm", active: true }, brandManager: null };
    expect(decideAssignment(rule({ action: "SPECIFIC_USER", userId: "u" }), { ...base, specificUser: { id: "u", active: true, hasAccess: true } }, 0)).toMatchObject({ userId: "u", via: "rule" });
    expect(decideAssignment(rule({ action: "TERRITORY_MANAGER" }), { ...base, specificUser: null }, 0)).toMatchObject({ userId: "tm", via: "rule" });
    expect(decideAssignment(rule({ action: "ROUND_ROBIN", rrPointer: 7 }), { ...base, specificUser: null }, 0)).toMatchObject({ userId: "m", nextPointer: 8 });
  });
});

describe("duplicate check", () => {
  const visible = [
    { id: "1", brandId: "HMNL", name: "Ada A", status: "NEW", ownerName: "Ada" },
    { id: "2", brandId: "SNMNL", name: "Ada A", status: "NEW", ownerName: "Segun" },
  ];

  it("same brand → warn with details; other brand → inform without details", () => {
    const r = classifyDuplicates("HMNL", visible, 0, []);
    expect(r.sameBrand).toEqual([{ id: "1", name: "Ada A", status: "NEW", ownerName: "Ada" }]);
    expect(r.existsElsewhere).toBe(true);
    expect(JSON.stringify(r)).not.toContain("Segun");
  });

  it("hidden matches only set the existsElsewhere flag", () => {
    const r = classifyDuplicates("HMNL", [], 3, []);
    expect(r).toEqual({ sameBrand: [], existsElsewhere: true, contacts: [] });
    expect(hasDuplicates(classifyDuplicates("HMNL", [], 0, []))).toBe(false);
  });
});

describe("phone normalisation (E.164, +234 default)", () => {
  it.each([
    ["08031234521", "+2348031234521"],
    ["0803 123 4521", "+2348031234521"],
    ["8031234521", "+2348031234521"],
    ["2348031234521", "+2348031234521"],
    ["+234 803 123 4521", "+2348031234521"],
    ["+44 20 7946 0958", "+442079460958"],
    ["0044 20 7946 0958", "+442079460958"],
  ])("%s → %s", (input, out) => expect(normalizePhone(input)).toBe(out));

  it("rejects junk", () => {
    expect(normalizePhone("abc")).toBeNull();
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });
});

describe("web-to-lead payload", () => {
  it("strips any brand fields from the payload", () => {
    const parsed = intakeSchema.parse({ lastName: "X", mobile: "08031234521", region: "Lagos", brandId: "SNMNL", brandCode: "SNMNL" });
    expect(parsed).not.toHaveProperty("brandId");
    expect(parsed).not.toHaveProperty("brandCode");
    expect(parsed.mobile).toBe("+2348031234521");
  });

  it("requires mobile or email", () => {
    expect(() => intakeSchema.parse({ lastName: "X", region: "Lagos" })).toThrow();
  });
});

describe("filters & rate limit", () => {
  it("parses URL filters leniently", () => {
    expect(parseLeadFilters({ status: "NEW", source: "BOGUS", mine: "true", from: "2026-01-01", to: "nope" })).toEqual({
      status: "NEW",
      mine: true,
      from: "2026-01-01",
    });
  });

  it("rate limit blocks after the limit within the window", () => {
    resetRateLimits();
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) expect(rateLimit("ip", 3, 60_000, now + i).ok).toBe(true);
    expect(rateLimit("ip", 3, 60_000, now + 10).ok).toBe(false);
    expect(rateLimit("ip", 3, 60_000, now + 61_000).ok).toBe(true);
  });
});
