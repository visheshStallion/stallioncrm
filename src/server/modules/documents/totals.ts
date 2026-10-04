/**
 * Document money rules (prompt 06) – pure functions, unit-tested. Totals are ALWAYS computed here on the
 * server; nothing sent by a client is trusted except quantities, prices and percentages (which are validated).
 *
 *   gross        = qty × unitPrice
 *   lineTotal    = gross − line discount                       (stored per line)
 *   header disc. = Σ lineTotal × headerDiscountPct
 *   tax          = (lineTotal − its share of the header discount) × taxRate
 *   total        = subtotal − discountTotal + taxTotal
 */

export interface LineInput {
  qty: number;
  unitPrice: number;
  discountPct: number;
  taxRate: number;
}

export interface Totals {
  lineTotals: number[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function computeTotals(lines: LineInput[], headerDiscountPct = 0): Totals {
  let subtotal = 0;
  let lineDiscounts = 0;
  let headerDiscount = 0;
  let tax = 0;
  const lineTotals = lines.map((l) => {
    const gross = l.qty * l.unitPrice;
    const disc = (gross * l.discountPct) / 100;
    const net = gross - disc;
    const header = (net * headerDiscountPct) / 100;
    subtotal += gross;
    lineDiscounts += disc;
    headerDiscount += header;
    tax += ((net - header) * l.taxRate) / 100;
    return round2(net);
  });
  const discountTotal = round2(lineDiscounts + headerDiscount);
  const taxTotal = round2(tax);
  return { lineTotals, subtotal: round2(subtotal), discountTotal, taxTotal, total: round2(round2(subtotal) - discountTotal + taxTotal) };
}

export interface ApprovalInput {
  lines: Array<{ discountPct: number; maxDiscountPct: number | null; label: string }>;
  headerDiscountPct: number;
  /** overall discount as % of the subtotal */
  overallDiscountPct: number;
  /** Brand thresholds: above approvalPct → Brand Manager; above escalationPct → Head of Sales. */
  approvalPct: number;
  escalationPct: number;
}

export interface ApprovalDecision {
  needed: boolean;
  /** 1 = Brand Manager, 2 = Head of Sales */
  level: 1 | 2;
  effectivePct: number;
  reasons: string[];
}

/**
 * Discount approval rule (BUSINESS_CONTEXT §10, prompt 06 rule 4): a line discount above the price book's
 * max discount, or any discount (line, header or overall) above the brand's threshold, needs approval.
 */
export function discountApproval(input: ApprovalInput): ApprovalDecision {
  const reasons: string[] = [];
  const effectivePct = round2(Math.max(0, input.headerDiscountPct, input.overallDiscountPct, ...input.lines.map((l) => l.discountPct)));
  for (const l of input.lines) {
    if (l.maxDiscountPct !== null && l.discountPct > l.maxDiscountPct) {
      reasons.push(`${l.label}: ${l.discountPct}% is above the price book maximum of ${l.maxDiscountPct}%`);
    }
  }
  if (effectivePct > input.approvalPct) reasons.push(`Discount of ${effectivePct}% is above the brand threshold of ${input.approvalPct}%`);
  return { needed: reasons.length > 0, level: effectivePct > input.escalationPct ? 2 : 1, effectivePct, reasons };
}

/** Invoice status from what has been paid. */
export function paymentStatus(total: number, paid: number): "ISSUED" | "PART_PAID" | "PAID" {
  if (paid <= 0) return "ISSUED";
  return paid + 0.005 >= total ? "PAID" : "PART_PAID";
}
