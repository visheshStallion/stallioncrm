import { describe, expect, it } from "vitest";
import { computeTotals, discountApproval, paymentStatus } from "@/server/modules/documents/totals";

describe("document totals (server-side)", () => {
  it("line discount, header discount and VAT", () => {
    const t = computeTotals(
      [
        { qty: 1, unitPrice: 40_000_000, discountPct: 5, taxRate: 7.5 },
        { qty: 2, unitPrice: 500_000, discountPct: 0, taxRate: 7.5 },
      ],
      2,
    );
    // gross 41,000,000; line discounts 2,000,000 → net 39,000,000; header 2 % = 780,000; tax = 38,220,000 × 7.5 %
    expect(t.lineTotals).toEqual([38_000_000, 1_000_000]);
    expect(t.subtotal).toBe(41_000_000);
    expect(t.discountTotal).toBe(2_780_000);
    expect(t.taxTotal).toBe(2_866_500);
    expect(t.total).toBe(41_086_500);
  });

  it("rounds to kobo and handles an empty document", () => {
    expect(computeTotals([{ qty: 3, unitPrice: 33.335, discountPct: 0, taxRate: 7.5 }]).total).toBe(107.51);
    expect(computeTotals([])).toEqual({ lineTotals: [], subtotal: 0, discountTotal: 0, taxTotal: 0, total: 0 });
  });

  it("tax per line follows the product's tax rate", () => {
    const t = computeTotals([
      { qty: 1, unitPrice: 100, discountPct: 0, taxRate: 7.5 },
      { qty: 1, unitPrice: 100, discountPct: 0, taxRate: 0 },
    ]);
    expect(t.taxTotal).toBe(7.5);
    expect(t.total).toBe(207.5);
  });
});

describe("discount approval rule", () => {
  const base = { headerDiscountPct: 0, overallDiscountPct: 0, approvalPct: 3, escalationPct: 7 };
  const line = (discountPct: number, maxDiscountPct: number | null = null) => ({ discountPct, maxDiscountPct, label: "SUV" });

  it("within the threshold → no approval", () => {
    expect(discountApproval({ ...base, lines: [line(3)], overallDiscountPct: 3 })).toMatchObject({ needed: false, level: 1 });
  });
  it("5 % with a 3 % threshold → Brand Manager (level 1)", () => {
    const d = discountApproval({ ...base, lines: [line(5)], overallDiscountPct: 5 });
    expect(d).toMatchObject({ needed: true, level: 1, effectivePct: 5 });
    expect(d.reasons.join()).toMatch(/above the brand threshold of 3%/);
  });
  it("above 7 % → Head of Sales (level 2); header discount counts too", () => {
    expect(discountApproval({ ...base, lines: [line(8)] })).toMatchObject({ needed: true, level: 2 });
    expect(discountApproval({ ...base, lines: [line(0)], headerDiscountPct: 7.5 })).toMatchObject({ needed: true, level: 2 });
  });
  it("a line above the price book maximum needs approval even below the brand threshold", () => {
    const d = discountApproval({ ...base, lines: [line(2.5, 2)] });
    expect(d).toMatchObject({ needed: true, level: 1 });
    expect(d.reasons[0]).toMatch(/price book maximum of 2%/);
  });
});

describe("invoice payment status", () => {
  it("issued → part-paid → paid", () => {
    expect(paymentStatus(100, 0)).toBe("ISSUED");
    expect(paymentStatus(100, 40)).toBe("PART_PAID");
    expect(paymentStatus(100, 100)).toBe("PAID");
    expect(paymentStatus(100.01, 100.009)).toBe("PAID");
  });
});
