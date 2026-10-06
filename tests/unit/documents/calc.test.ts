import { describe, expect, it } from "vitest";
import { calcDocument, calcLine } from "@/server/modules/documents/calc";
import { amountInWords } from "@/server/modules/messaging/merge";

/** Ordered Items calculation (prompt 24 §3): line and document figures in integer kobo. */
const VAT = [{ name: "VAT", rate: 7.5 }];
const line = (o: Partial<Parameters<typeof calcLine>[0]> = {}) => ({ qty: 1, unitPrice: 25_000_000, discountType: "PERCENT" as const, discountValue: 0, taxes: VAT, ...o });

describe("line", () => {
  it("amount, % discount, tax on (amount − discount), total – as in the reference row", () => {
    const r = calcLine(line({ discountValue: 2 }), "LINE");
    expect(r).toMatchObject({ amount: 25_000_000, discountAmount: 500_000, net: 24_500_000, taxAmount: 1_837_500, total: 26_337_500, discountPct: 2, taxRate: 7.5 });
  });

  it("a direct amount discount, never more than the amount", () => {
    expect(calcLine(line({ discountType: "AMOUNT", discountValue: 750_000 }), "LINE")).toMatchObject({ discountAmount: 750_000, discountPct: 3, total: 26_068_750 });
    expect(calcLine(line({ qty: 1, unitPrice: 100, discountType: "AMOUNT", discountValue: 500 }), "LINE")).toMatchObject({ discountAmount: 100, total: 0 });
  });

  it("several taxes on one line; no tax in document mode", () => {
    const r = calcLine(line({ qty: 2, unitPrice: 1_000, taxes: [{ name: "VAT", rate: 7.5 }, { name: "Levy", rate: 2 }] }), "LINE");
    expect(r.taxes).toEqual([{ name: "VAT", rate: 7.5, amount: 150 }, { name: "Levy", rate: 2, amount: 40 }]);
    expect(r).toMatchObject({ taxAmount: 190, taxRate: 9.5, total: 2_190 });
    expect(calcLine(line({ qty: 2, unitPrice: 1_000 }), "DOCUMENT")).toMatchObject({ taxAmount: 0, total: 2_000 });
  });

  it("no floating-point drift; rounding per line, half-up or half-even", () => {
    // 0.1 + 0.2 style values: 3 × 33.335 = 100.005 → 100.01 (half-up) / 100.00 (half-even)
    expect(calcLine(line({ qty: 3, unitPrice: 33.335, taxes: [] }), "LINE", "HALF_UP").amount).toBe(100.01);
    expect(calcLine(line({ qty: 3, unitPrice: 33.335, taxes: [] }), "LINE", "HALF_EVEN").amount).toBe(100);
    expect(calcLine(line({ qty: 10, unitPrice: 0.1, taxes: [] }), "LINE").amount).toBe(1);
  });

  it("a discount above the price book maximum needs approval", () => {
    expect(calcLine(line({ discountValue: 6, maxDiscountPct: 5 }), "LINE").needsApproval).toBe(true);
    expect(calcLine(line({ discountValue: 5, maxDiscountPct: 5 }), "LINE").needsApproval).toBe(false);
    expect(calcLine(line({ discountType: "AMOUNT", discountValue: 2_000_000, maxDiscountPct: 5 }), "LINE").needsApproval).toBe(true); // 8 %
    expect(calcLine(line({ discountValue: 50, maxDiscountPct: null }), "LINE").needsApproval).toBe(false);
  });
});

describe("document", () => {
  const three = [line({ discountValue: 2 }), line({ discountValue: 2 }), line({ discountValue: 2 })];

  it("line-tax mode: Sub Total = Σ line totals; document discount; adjustment; grand total", () => {
    const d = calcDocument(three, { discountType: "PERCENT", discountValue: 0, taxes: [], adjustment: 0, taxMode: "LINE" });
    expect(d).toMatchObject({ subTotal: 79_012_500, documentDiscount: 0, grandTotal: 79_012_500, gross: 75_000_000, discountTotal: 1_500_000, taxTotal: 5_512_500 });
    const withDoc = calcDocument(three, { discountType: "AMOUNT", discountValue: 12_500, taxes: [], adjustment: -0.5, taxMode: "LINE" });
    expect(withDoc).toMatchObject({ documentDiscount: 12_500, adjustment: -0.5, grandTotal: 78_999_999.5, discountTotal: 1_512_500 });
    expect(calcDocument(three, { discountType: "PERCENT", discountValue: 1, taxes: [], adjustment: 0, taxMode: "LINE" }).documentDiscount).toBe(790_125);
    expect(amountInWords(d.grandTotal)).toBe("Seventy-Nine Million, Twelve Thousand, Five Hundred Naira Only");
  });

  it("document-tax mode: Sub Total = Σ (amount − discount); tax once on (sub − discount)", () => {
    const d = calcDocument(three, { discountType: "PERCENT", discountValue: 0, taxes: VAT, adjustment: 100, taxMode: "DOCUMENT" });
    expect(d).toMatchObject({ subTotal: 73_500_000, documentTax: 5_512_500, grandTotal: 79_012_600, taxTotal: 5_512_500 });
    const disc = calcDocument(three, { discountType: "PERCENT", discountValue: 10, taxes: VAT, adjustment: 0, taxMode: "DOCUMENT" });
    expect(disc).toMatchObject({ documentDiscount: 7_350_000, documentTax: 4_961_250, grandTotal: 71_111_250, headerDiscountPct: 10 });
  });

  it("an empty document is zero; a document discount never exceeds the sub total", () => {
    expect(calcDocument([], { discountType: "PERCENT", discountValue: 5, taxes: [], adjustment: 0, taxMode: "LINE" }).grandTotal).toBe(0);
    expect(calcDocument([line({ unitPrice: 100, taxes: [] })], { discountType: "AMOUNT", discountValue: 1_000, taxes: [], adjustment: 0, taxMode: "LINE" }).grandTotal).toBe(0);
  });
});
