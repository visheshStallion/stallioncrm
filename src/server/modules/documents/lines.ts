/**
 * Server side of the Ordered Items grid (prompt 24): normalises the lines a client sends, computes every figure with
 * the shared calculation (calc.ts), checks VINs, and writes lines + header totals. Lines keep their id across saves,
 * so each line has a change history (who changed quantity, price or discount: old → new).
 */
import "server-only";
import type { AccessContext } from "@/server/access/types";
import { audit, scopedDb } from "@/server/db";
import { BadRequestError } from "@/server/errors";
import { defaultBookFor } from "@/server/modules/catalogue/pricing";
import { calcDocument, type CalcLine, type DocumentResult, type TaxRate } from "./calc";
import { DOCS, MAX_LINES, type DocType, type DocumentRules, type LineData } from "./config";

/* eslint-disable @typescript-eslint/no-explicit-any -- the three document models share one implementation */

export interface HeaderInput {
  headerDiscountPct?: number;
  headerDiscountType?: "PERCENT" | "AMOUNT";
  headerDiscountValue?: number;
  documentTaxes?: TaxRate[];
  adjustment?: number;
}

export interface NormalLine extends LineData {
  discountType: "PERCENT" | "AMOUNT";
  discountValue: number;
  taxes: TaxRate[];
  vins: string[];
}

/** Fills the grid fields from the legacy ones (discountPct, taxRate, vin) when a client sends only those. */
export function normaliseLine(l: LineData, rules: DocumentRules): NormalLine {
  const vins = [...new Set((l.vins ?? (l.vin ? [l.vin] : [])).map((v) => v.trim().toUpperCase()).filter(Boolean))];
  const taxName = rules.taxes[0]?.name ?? "VAT";
  return {
    ...l,
    discountType: l.discountType ?? "PERCENT",
    discountValue: l.discountValue ?? l.discountPct ?? 0,
    taxes: l.taxes ?? (l.taxRate > 0 ? [{ name: taxName, rate: l.taxRate }] : []),
    vins,
    vin: vins[0] ?? null,
  };
}

/** The price book maximum discount (%) of each product line – lines above it are marked "Needs approval". */
async function maxima(ctx: AccessContext, brandId: string, priceBookId: string | null, productIds: string[], on: Date): Promise<Map<string, number | null>> {
  if (!productIds.length) return new Map();
  const db = scopedDb(ctx);
  let bookId = priceBookId;
  if (!bookId) bookId = defaultBookFor(await db.priceBook.findMany({ where: { brandId, active: true } }), brandId, on)?.id ?? null;
  if (!bookId) return new Map();
  const entries = await db.priceBookEntry.findMany({ where: { priceBookId: bookId, productId: { in: productIds } }, select: { productId: true, maxDiscountPct: true } });
  return new Map(entries.map((e) => [e.productId, e.maxDiscountPct === null ? null : Number(e.maxDiscountPct.toString())]));
}

export async function computeLines(ctx: AccessContext, brandId: string, priceBookId: string | null, lines: NormalLine[], header: HeaderInput, rules: DocumentRules, on = new Date()): Promise<DocumentResult> {
  if (lines.length > MAX_LINES) throw new BadRequestError(`At most ${MAX_LINES} lines per document`);
  const max = await maxima(ctx, brandId, priceBookId, [...new Set(lines.map((l) => l.productId).filter((x): x is string => !!x))], on);
  const calc: CalcLine[] = lines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice, discountType: l.discountType, discountValue: l.discountValue, taxes: l.taxes, maxDiscountPct: l.productId ? (max.get(l.productId) ?? null) : null }));
  for (const [i, l] of lines.entries()) {
    if (l.discountType === "AMOUNT" && l.discountValue > l.qty * l.unitPrice + 0.005) throw new BadRequestError(`Line ${i + 1}: the discount is larger than the amount`);
  }
  const hType = header.headerDiscountType ?? "PERCENT";
  const hValue = header.headerDiscountValue ?? header.headerDiscountPct ?? 0;
  return calcDocument(calc, { discountType: hType, discountValue: hValue, taxes: header.documentTaxes ?? (rules.taxMode === "DOCUMENT" ? rules.taxes.slice(0, 1) : []), adjustment: header.adjustment ?? 0, taxMode: rules.taxMode, rounding: rules.roundingMode });
}

/**
 * VINs: a vehicle line has at most one VIN per unit, no VIN twice on the document, and no VIN that is already on an
 * open sales order of the brand (another order would sell the same vehicle).
 */
export async function assertVins(ctx: AccessContext, type: DocType, docId: string | null, brandId: string, lines: NormalLine[]) {
  const all = lines.flatMap((l) => l.vins);
  const dup = all.find((v, i) => all.indexOf(v) !== i);
  if (dup) throw new BadRequestError(`VIN ${dup} appears twice on this document`);
  for (const [i, l] of lines.entries()) if (l.vins.length > Math.ceil(l.qty)) throw new BadRequestError(`Line ${i + 1}: more VINs than units`);
  if (type !== "salesOrder" || !all.length) return;
  const others = await scopedDb(ctx).documentLine.findMany({ where: { salesOrder: { brandId, status: { in: ["DRAFT", "CONFIRMED", "ALLOCATED"] }, deletedAt: null, ...(docId ? { id: { not: docId } } : {}) }, OR: [{ vin: { in: all } }, ...all.map((v) => ({ vins: { array_contains: [v] } }))] }, select: { vin: true, vins: true, salesOrder: { select: { number: true } } } });
  for (const o of others) {
    const taken = [o.vin, ...((o.vins as string[] | null) ?? [])].find((v) => v && all.includes(v));
    if (taken) throw new BadRequestError(`VIN ${taken} is already on the open sales order ${o.salesOrder?.number}`);
  }
}

const TRACKED: Array<keyof NormalLine> = ["description", "details", "qty", "unitPrice", "discountType", "discountValue", "productId"];

/**
 * Writes the lines (kept by id, new ones created, removed ones deleted; order = position) and the header totals in one
 * go. Changes to existing lines are audited per line (entity DocumentLine: old → new).
 */
export async function persistLines(ctx: AccessContext, type: DocType, docId: string, brandId: string, lines: NormalLine[], r: DocumentResult, header: HeaderInput, extra: Record<string, unknown> = {}, opts: { history?: boolean } = {}) {
  const cfg = DOCS[type];
  const db = scopedDb(ctx);
  const existing = await db.documentLine.findMany({ where: { [cfg.lineKey]: docId } as any });
  const keep = new Set(lines.map((l) => l.id).filter((x): x is string => !!x && existing.some((e) => e.id === x)));
  const removed = existing.filter((e) => !keep.has(e.id));
  if (removed.length) await db.documentLine.deleteMany({ where: { id: { in: removed.map((e) => e.id) } } });
  for (const [i, l] of lines.entries()) {
    const c = r.lines[i]!;
    const data = {
      position: i + 1,
      productId: l.productId,
      description: l.description,
      itemCode: l.itemCode ?? null,
      details: l.details ?? null,
      uom: l.uom ?? null,
      isStockItem: l.isStockItem || l.vins.length > 0,
      qty: l.qty,
      unitPrice: l.unitPrice,
      amount: c.amount,
      discountType: l.discountType,
      discountValue: l.discountValue,
      discountAmount: c.discountAmount,
      discountPct: Math.min(100, c.discountPct),
      taxes: c.taxes as object,
      taxAmount: c.taxAmount,
      taxRate: Math.min(100, c.taxRate),
      lineTotal: c.net,
      total: c.total,
      vin: l.vins[0] ?? null,
      vins: l.vins,
      needsApproval: c.needsApproval,
    };
    const before = l.id ? existing.find((e) => e.id === l.id) : undefined;
    if (before) {
      await db.documentLine.update({ where: { id: before.id }, data });
      if (opts.history !== false) {
        const changed = TRACKED.filter((k) => String((before as any)[k] ?? "") !== String((l as any)[k] ?? "") && !(typeof (l as any)[k] === "number" && Number((before as any)[k]?.toString()) === (l as any)[k]));
        if (changed.length) await audit({ ctx, action: "UPDATE", entity: "DocumentLine", entityId: before.id, brandId, before: Object.fromEntries(changed.map((k) => [k, (before as any)[k]?.toString?.() ?? (before as any)[k]])), after: { ...Object.fromEntries(changed.map((k) => [k, (l as any)[k]])), document: `${cfg.model}:${docId}`, row: i + 1 } });
      }
    } else {
      await db.documentLine.create({ data: { ...data, [cfg.lineKey]: docId, ...(l as { sourceLineId?: string }).sourceLineId ? { sourceLineId: (l as { sourceLineId?: string }).sourceLineId } : {} } as any });
    }
  }
  await (db as any)[type].update({
    where: { id: docId },
    data: {
      subtotal: r.gross,
      discountTotal: r.discountTotal,
      taxTotal: r.taxTotal,
      total: r.grandTotal,
      headerDiscountPct: Math.min(100, r.headerDiscountPct),
      headerDiscountType: header.headerDiscountType ?? "PERCENT",
      headerDiscountValue: header.headerDiscountValue ?? header.headerDiscountPct ?? 0,
      documentTaxes: r.documentTaxes as object,
      adjustment: r.adjustment,
      ...extra,
    },
    select: { id: true },
  });
}
