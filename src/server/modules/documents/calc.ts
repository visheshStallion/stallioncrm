/**
 * Ordered Items calculation (prompt 24) – pure, shared by the browser grid and the server. The server always
 * recomputes at save and its values win; nothing a client sends is trusted except quantities, prices, discount
 * choices and tax choices (all validated).
 *
 * Money is computed in integer kobo (1/100 of the currency unit) – no floating-point drift. Every line is rounded
 * to kobo with the brand's rounding mode.
 *
 *   Amount   = Quantity × List Price
 *   Discount = % of Amount, or a direct amount (never more than the Amount)
 *   Tax      = Σ rates × (Amount − Discount)                      (line-level tax mode)
 *   Total    = Amount − Discount + Tax
 *
 *   Line mode:      Sub Total = Σ line Total;   Discount on Sub Total;   Grand = Sub − Discount + Adjustment
 *   Document mode:  Sub Total = Σ (Amount − Discount);   Discount on Sub Total;
 *                   Tax = Σ document rates × (Sub − Discount);   Grand = Sub − Discount + Tax + Adjustment
 */

export type DiscountType = "PERCENT" | "AMOUNT";
export type RoundingMode = "HALF_UP" | "HALF_EVEN";
export type TaxMode = "LINE" | "DOCUMENT";

export interface TaxRate {
  name: string;
  rate: number;
}
export interface CalcLine {
  qty: number;
  unitPrice: number;
  discountType: DiscountType;
  discountValue: number;
  taxes: TaxRate[];
  /** the price book maximum discount in % of the amount, if any */
  maxDiscountPct?: number | null;
}
export interface CalcHeader {
  discountType: DiscountType;
  discountValue: number;
  /** document-level taxes (document tax mode) */
  taxes: TaxRate[];
  adjustment: number;
  taxMode: TaxMode;
  rounding?: RoundingMode;
}
export interface LineResult {
  amount: number;
  discountAmount: number;
  /** effective discount in % of the amount (for approvals and reports) */
  discountPct: number;
  net: number;
  taxes: Array<TaxRate & { amount: number }>;
  taxAmount: number;
  /** sum of the tax rates (the legacy single "taxRate" column) */
  taxRate: number;
  total: number;
  needsApproval: boolean;
}
export interface DocumentResult {
  lines: LineResult[];
  /** the grid's Sub Total (Σ line totals in line mode, Σ net in document mode) */
  subTotal: number;
  documentDiscount: number;
  documentTaxes: Array<TaxRate & { amount: number }>;
  documentTax: number;
  adjustment: number;
  grandTotal: number;
  // stored header figures (reports, approvals, ERP): gross, all discounts, all taxes, grand total
  gross: number;
  discountTotal: number;
  taxTotal: number;
  /** document discount in % of the sub total */
  headerDiscountPct: number;
}

/** Rounds a value in kobo (possibly fractional) to whole kobo. */
function roundKobo(x: number, mode: RoundingMode): number {
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const f = Math.floor(a);
  const d = a - f;
  const EPS = 1e-9;
  let r: number;
  if (d > 0.5 + EPS) r = f + 1;
  else if (d < 0.5 - EPS) r = f;
  else r = mode === "HALF_EVEN" ? (f % 2 === 0 ? f : f + 1) : f + 1;
  return sign * r;
}
/** money (naira) → kobo, exact to the kobo */
const toKobo = (v: number) => Math.round(v * 100);
const fromKobo = (k: number) => k / 100;

export function calcLine(l: CalcLine, mode: TaxMode, rounding: RoundingMode = "HALF_UP"): LineResult {
  const amountK = roundKobo(l.qty * l.unitPrice * 100, rounding);
  const rawDisc = l.discountType === "AMOUNT" ? toKobo(Math.max(0, l.discountValue)) : roundKobo((amountK * Math.max(0, Math.min(100, l.discountValue))) / 100, rounding);
  const discK = Math.min(rawDisc, amountK);
  const netK = amountK - discK;
  const taxes = mode === "LINE" ? l.taxes.map((t) => ({ ...t, amount: fromKobo(roundKobo((netK * t.rate) / 100, rounding)) })) : [];
  const taxK = taxes.reduce((s, t) => s + toKobo(t.amount), 0);
  const discountPct = amountK > 0 ? Math.round((discK / amountK) * 10000) / 100 : 0;
  return {
    amount: fromKobo(amountK),
    discountAmount: fromKobo(discK),
    discountPct,
    net: fromKobo(netK),
    taxes,
    taxAmount: fromKobo(taxK),
    taxRate: Math.round(l.taxes.reduce((s, t) => s + t.rate, 0) * 100) / 100,
    total: fromKobo(netK + taxK),
    needsApproval: l.maxDiscountPct !== null && l.maxDiscountPct !== undefined && discountPct > l.maxDiscountPct + 1e-9,
  };
}

export function calcDocument(lines: CalcLine[], h: CalcHeader): DocumentResult {
  const rounding = h.rounding ?? "HALF_UP";
  const rs = lines.map((l) => calcLine(l, h.taxMode, rounding));
  const lineTotalK = rs.reduce((s, r) => s + toKobo(r.total), 0);
  const netK = rs.reduce((s, r) => s + toKobo(r.net), 0);
  const subK = h.taxMode === "LINE" ? lineTotalK : netK;
  const rawDoc = h.discountType === "AMOUNT" ? toKobo(Math.max(0, h.discountValue)) : roundKobo((subK * Math.max(0, Math.min(100, h.discountValue))) / 100, rounding);
  const docDiscK = Math.min(rawDoc, Math.max(0, subK));
  const baseK = subK - docDiscK;
  const documentTaxes = h.taxMode === "DOCUMENT" ? h.taxes.map((t) => ({ ...t, amount: fromKobo(roundKobo((baseK * t.rate) / 100, rounding)) })) : [];
  const docTaxK = documentTaxes.reduce((s, t) => s + toKobo(t.amount), 0);
  const adjK = toKobo(h.adjustment || 0);
  const grandK = baseK + docTaxK + adjK;
  const grossK = rs.reduce((s, r) => s + toKobo(r.amount), 0);
  const lineDiscK = rs.reduce((s, r) => s + toKobo(r.discountAmount), 0);
  const lineTaxK = rs.reduce((s, r) => s + toKobo(r.taxAmount), 0);
  return {
    lines: rs,
    subTotal: fromKobo(subK),
    documentDiscount: fromKobo(docDiscK),
    documentTaxes,
    documentTax: fromKobo(docTaxK),
    adjustment: fromKobo(adjK),
    grandTotal: fromKobo(grandK),
    gross: fromKobo(grossK),
    discountTotal: fromKobo(lineDiscK + docDiscK),
    taxTotal: fromKobo(lineTaxK + docTaxK),
    headerDiscountPct: subK > 0 ? Math.round((docDiscK / subK) * 10000) / 100 : 0,
  };
}

/** The default taxes of a brand: VAT 7.5 % unless the brand configures others. */
export const DEFAULT_TAXES: TaxRate[] = [{ name: "VAT", rate: 7.5 }];
