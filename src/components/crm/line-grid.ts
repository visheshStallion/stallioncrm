/**
 * Grid rows and their conversion to / from stored document lines (prompt 24). Plain module – usable on the server
 * (record pages build the grid value) and in the browser (the grid component).
 */
import type { DiscountType, TaxRate } from "@/server/modules/documents/calc";

/** One row of the grid. `key` is the client's row id; `id` the stored line (kept across saves for its history). */
export interface GridLine {
  key: string;
  id?: string;
  productId: string;
  description: string;
  details: string;
  itemCode: string;
  uom: string;
  qty: string;
  unitPrice: string;
  discountType: DiscountType;
  discountValue: string;
  taxes: TaxRate[];
  vins: string[];
  isStockItem: boolean;
  /** stored lines: needs a discount approval (server decision) */
  needsApproval?: boolean;
  /** invoices: the sales-order line this line invoices (partial invoicing) */
  sourceLineId?: string | null;
}
export interface GridHeader {
  discountType: DiscountType;
  discountValue: string;
  taxes: TaxRate[];
  adjustment: string;
}
export interface GridValue {
  lines: GridLine[];
  header: GridHeader;
}

let seq = 0;
export const newLine = (patch: Partial<GridLine> = {}, taxes: TaxRate[] = []): GridLine => ({ key: `g${Date.now().toString(36)}${++seq}`, productId: "", description: "", details: "", itemCode: "", uom: "", qty: "1", unitPrice: "", discountType: "PERCENT", discountValue: "0", taxes, vins: [], isStockItem: false, ...patch });

/** Grid lines from stored document lines (detail pages, edit). */
export function gridFromLines(
  lines: Array<{ id: string; productId: string | null; description: string; details: string | null; itemCode: string | null; uom: string | null; qty: number; unitPrice: number; discountType: DiscountType; discountValue: number; taxes: Array<{ name: string; rate: number }>; vins: string[]; isStockItem: boolean; needsApproval: boolean }>,
  header: { headerDiscountType: DiscountType; headerDiscountValue: number; documentTaxes: Array<{ name: string; rate: number }>; adjustment: number },
): GridValue {
  return {
    lines: lines.map((l) => ({ key: l.id, id: l.id, productId: l.productId ?? "", description: l.description, details: l.details ?? "", itemCode: l.itemCode ?? "", uom: l.uom ?? "", qty: String(l.qty), unitPrice: String(l.unitPrice), discountType: l.discountType, discountValue: String(l.discountValue), taxes: l.taxes.map(({ name, rate }) => ({ name, rate })), vins: l.vins, isStockItem: l.isStockItem, needsApproval: l.needsApproval, sourceLineId: (l as { sourceLineId?: string | null }).sourceLineId ?? null })),
    header: { discountType: header.headerDiscountType, discountValue: String(header.headerDiscountValue), taxes: header.documentTaxes.map(({ name, rate }) => ({ name, rate })), adjustment: String(header.adjustment) },
  };
}

/** What the server receives for the grid (lines + header). */
export function gridPayload(v: GridValue) {
  return {
    lines: v.lines
      .filter((l) => l.description.trim() || l.productId)
      .map((l) => ({ id: l.id, productId: l.productId, description: l.description, details: l.details, itemCode: l.itemCode, uom: l.uom, qty: l.qty, unitPrice: l.unitPrice, discountType: l.discountType, discountValue: l.discountValue, taxes: l.taxes, vins: l.vins, isStockItem: l.isStockItem, ...(l.sourceLineId ? { sourceLineId: l.sourceLineId } : {}) })),
    headerDiscountType: v.header.discountType,
    headerDiscountValue: v.header.discountValue,
    documentTaxes: v.header.taxes,
    adjustment: v.header.adjustment,
  };
}
