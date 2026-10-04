import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { allocateLandedCost, fifoIssue, fifoLayers, weightedAverageIssue } from "@/server/modules/inventory/costing";
import { DEFAULT_ACCOUNTS, accountMap, adjustmentJournal, billJournal, interBrandInJournal, interBrandOutJournal, isBalanced, landedCostJournal, receiptJournal, returnJournal, saleIssueJournal } from "@/server/modules/inventory/journal";
import { VEHICLE_STATUSES, ageingBucket, ageingDays, assertTransition, canTransition } from "@/server/modules/inventory/status";
import { isValidVin, makeVin, maskVin, normalizeVin, vinCheckDigit, vinProblem } from "@/server/modules/inventory/vin";

describe("VIN validation", () => {
  it("accepts well-known valid VINs and computes the check digit", () => {
    // published examples of the check-digit algorithm
    expect(vinCheckDigit("1M8GDM9AXKP042788")).toBe("X");
    expect(isValidVin("1M8GDM9AXKP042788")).toBe(true);
    expect(isValidVin("11111111111111111")).toBe(true);
    expect(isValidVin(" 1m8gdm9a-xkp042788 ")).toBe(true); // spaces, dashes and case are normalised
    expect(normalizeVin("1m8gdm9a xkp042788")).toBe("1M8GDM9AXKP042788");
  });

  it("explains what is wrong", () => {
    expect(vinProblem("1M8GDM9AXKP04278")).toMatch(/17 characters/);
    expect(vinProblem("1M8GDM9AXKP04278O")).toMatch(/I, O and Q/);
    expect(vinProblem("1M8GDM9A1KP042788")).toMatch(/check digit/); // one mistyped character
    expect(vinProblem("1M8GDM9AXKP042789")).toMatch(/check digit/);
  });

  it("generates fictitious VINs that pass, and masks all but the last six", () => {
    const vins = Array.from({ length: 200 }, (_, i) => makeVin(`HMNLMD01RA${String(i).padStart(6, "0")}`));
    expect(vins.every(isValidVin)).toBe(true);
    expect(new Set(vins).size).toBe(200);
    expect(isValidVin(makeVin("SOQIMD01RA000001"))).toBe(true); // I, O, Q are replaced
    expect(maskVin("1M8GDM9AXKP042788")).toBe("•••••••••••042788");
  });
});

describe("vehicle status machine", () => {
  it("follows the lifecycle and refuses shortcuts", () => {
    const path = ["ON_ORDER", "IN_TRANSIT", "AT_PORT", "IN_CLEARING", "PDI_PENDING", "AVAILABLE", "RESERVED", "ALLOCATED", "INVOICED", "DELIVERED"] as const;
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i]!, path[i + 1]!), `${path[i]} → ${path[i + 1]}`).toBe(true);
    expect(canTransition("ON_ORDER", "AVAILABLE")).toBe(false); // not without receipt and PDI
    expect(canTransition("IN_CLEARING", "AVAILABLE")).toBe(false);
    expect(canTransition("AVAILABLE", "ALLOCATED")).toBe(false); // reservation first
    expect(canTransition("AVAILABLE", "DELIVERED")).toBe(false);
    expect(canTransition("RESERVED", "WRITTEN_OFF")).toBe(false);
    expect(() => assertTransition("DELIVERED", "AVAILABLE")).toThrow(/cannot go from "Delivered"/);
    for (const end of ["DELIVERED", "TRANSFERRED", "RETURNED", "WRITTEN_OFF"] as const) expect(VEHICLE_STATUSES.some((s) => canTransition(end, s))).toBe(false);
  });

  it("ageing buckets", () => {
    const now = new Date("2026-10-01T00:00:00Z");
    const days = (n: number) => ageingBucket(ageingDays(new Date(now.getTime() - n * 86_400_000), now));
    expect([0, 30, 31, 60, 61, 90, 91, 180, 181, 400].map(days)).toEqual(["0-30", "0-30", "31-60", "31-60", "61-90", "61-90", "91-180", "91-180", "180+", "180+"]);
    expect(ageingBucket(ageingDays(null, now))).toBeNull();
  });
});

describe("landed cost allocation", () => {
  const targets = [
    { id: "a", value: 30_000_000, weight: 1500 },
    { id: "b", value: 20_000_000, weight: 1500 },
    { id: "c", value: 10_000_000, weight: 3000 },
  ];
  const sum = (m: Map<string, number>) => Math.round([...m.values()].reduce((s, v) => s + v, 0) * 100) / 100;

  it("by value, quantity and weight – the shares always add up to the total", () => {
    const byValue = allocateLandedCost(1_000_000, targets, "VALUE");
    expect([...byValue.values()]).toEqual([500_000, 333_333.33, 166_666.67]);
    expect(sum(byValue)).toBe(1_000_000);
    const byQty = allocateLandedCost(1_000_000, targets, "QUANTITY");
    expect([...byQty.values()]).toEqual([333_333.33, 333_333.33, 333_333.34]);
    expect(sum(byQty)).toBe(1_000_000);
    expect([...allocateLandedCost(1_000_000, targets, "WEIGHT").values()]).toEqual([250_000, 250_000, 500_000]);
    for (const total of [0.01, 0.07, 999.99, 123_456.78]) expect(sum(allocateLandedCost(total, targets, "VALUE"))).toBe(total);
  });

  it("manual amounts must match the total; bad input is refused", () => {
    expect([...allocateLandedCost(600, targets.map((t, i) => ({ ...t, manual: (i + 1) * 100 })), "MANUAL").values()]).toEqual([100, 200, 300]);
    expect(() => allocateLandedCost(700, targets.map((t, i) => ({ ...t, manual: (i + 1) * 100 })), "MANUAL")).toThrow(/add up to 600.00, not 700.00/);
    expect(() => allocateLandedCost(100, [], "VALUE")).toThrow(/at least one vehicle/);
    expect(() => allocateLandedCost(0, targets, "VALUE")).toThrow(/nothing to allocate/);
    expect(() => allocateLandedCost(100, [{ id: "x", value: 0 }], "VALUE")).toThrow(/no value/);
    expect(() => allocateLandedCost(100, [{ id: "x", value: 5 }], "WEIGHT")).toThrow(/needs a weight/);
  });
});

describe("valuation of quantity stock", () => {
  it("FIFO consumes the oldest layers first", () => {
    const layers = [
      { qty: 10, unitCost: 100 },
      { qty: 10, unitCost: 120 },
    ];
    const first = fifoIssue(layers, 4);
    expect(first).toEqual({ cost: 400, remaining: [{ qty: 6, unitCost: 100 }, { qty: 10, unitCost: 120 }] });
    const second = fifoIssue(first.remaining, 8);
    expect(second.cost).toBe(6 * 100 + 2 * 120);
    expect(second.remaining).toEqual([{ qty: 8, unitCost: 120 }]);
    expect(() => fifoIssue(second.remaining, 9)).toThrow(/Only 8 in stock/);
    expect(fifoLayers([{ qtyIn: 10, qtyOut: 0, unitCost: 100 }, { qtyIn: 0, qtyOut: 4, unitCost: 100 }, { qtyIn: 10, qtyOut: 0, unitCost: 120 }])).toEqual(first.remaining);
  });

  it("weighted average uses stock value ÷ quantity; the last issue empties the value", () => {
    const balance = { qty: 20, value: 10 * 100 + 10 * 120 };
    expect(weightedAverageIssue(balance, 4)).toBe(440);
    expect(weightedAverageIssue({ qty: 3, value: 100 }, 1)).toBe(33.33);
    expect(weightedAverageIssue({ qty: 1, value: 33.34 }, 1)).toBe(33.34); // no rounding remainder left behind
    expect(() => weightedAverageIssue(balance, 21)).toThrow(/Only 20 in stock/);
  });
});

describe("journals", () => {
  const a = DEFAULT_ACCOUNTS;
  it("every posting balances and uses the brand's accounts", () => {
    const drafts = [receiptJournal(a, "GRN-1", 60_000_000), billJournal(a, "BILL-1", 61_000_000, 60_000_000), billJournal(a, "BILL-2", 59_500_000, 60_000_000), billJournal(a, "BILL-3", 60_000_000, 60_000_000), landedCostJournal(a, "LC-1", 12_490_000), saleIssueJournal(a, "INV-1", 36_245_000.55), adjustmentJournal(a, "ADJ-1", -1_000_000), adjustmentJournal(a, "ADJ-2", 250_000), returnJournal(a, "VC-1", 30_000_000), interBrandOutJournal(a, "IBT-1", 30_000_000, 31_000_000), interBrandOutJournal(a, "IBT-2", 30_000_000, 29_000_000), interBrandInJournal(a, "IBT-1", 31_000_000)];
    for (const d of drafts) {
      expect(d, "a posting with an amount has a journal").not.toBeNull();
      expect(isBalanced(d!.lines), d!.memo).toBe(true);
      expect(d!.lines.every((l) => l.debit >= 0 && l.credit >= 0)).toBe(true);
    }
    expect(receiptJournal(a, "GRN-1", 100)!.lines).toEqual([
      { account: a.inventory, debit: 100, credit: 0, memo: undefined },
      { account: a.grni, debit: 0, credit: 100, memo: undefined },
    ]);
    // a bill above the receipt books the difference as purchase price variance
    expect(billJournal(a, "B", 110, 100)!.lines.map((l) => [l.account, l.debit, l.credit])).toEqual([[a.grni, 100, 0], [a.ppv, 10, 0], [a.ap, 0, 110]]);
    expect(saleIssueJournal(a, "INV", 500)!.lines.map((l) => l.account)).toEqual([a.cogs, a.inventory]);
    expect(adjustmentJournal(a, "ADJ", 0)).toBeNull(); // status-only adjustments post nothing
  });

  it("a brand's own mapping overrides the defaults per account", () => {
    const own = accountMap({ inventory: "120000 Vehicle stock", cogs: " ", bogus: "x" });
    expect(own.inventory).toBe("120000 Vehicle stock");
    expect(own.cogs).toBe(DEFAULT_ACCOUNTS.cogs);
    expect(Object.keys(own)).toHaveLength(9);
  });
});
